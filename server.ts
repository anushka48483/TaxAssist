import 'dotenv/config';
import express from 'express';
import http from 'http';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import {
  DocumentCategory,
  ReturnFinancialInputs,
  SecurityGatewayConfig,
  TaxRegime,
  UploadedDocument,
  UserProfile,
} from './src/shared/types.js';
import { workspaceStore } from './server/store.js';
import { extractFinancialDocument } from './server/documentExtractor.js';
import { calculateTaxComparison, getRuleVerificationMetadata } from './server/taxEngine.js';
import { retrieveTaxRules } from './server/ragKnowledgeBase.js';
import {
  executeThroughSecurityGateway,
  maskSensitivePii,
  resolveApprovalRequest,
} from './server/securityGateway.js';
import {
  resumeOrchestratorAfterApprovalDecision,
  runTaxAssistantTurn,
} from './server/agentOrchestrator.js';
import { MCP_TOOL_DEFINITIONS } from './server/mcpServer.js';
import { SYNTHETIC_DEMO_FILES } from './server/syntheticDemo.js';
import { buildSampleDocumentsZip } from './server/samplePdfPack.js';
import { getLlmRuntimeStatus } from './server/llmAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

const sseClients = new Set<express.Response>();

function broadcastLiveEvent(ev: import('./src/shared/types.js').LiveFilingEvent): void {
  if (sseClients.size === 0) return;
  const payload = JSON.stringify(ev);
  for (const client of sseClients) {
    try {
      client.write(`id: ${ev.seq}\nevent: live_event\ndata: ${payload}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

workspaceStore.onLiveEvent((ev) => {
  broadcastLiveEvent(ev);
});

function broadcastWorkspaceUpdate(reason: string): void {
  if (sseClients.size === 0) return;
  const session = workspaceStore.getActiveSession();
  const payload = JSON.stringify({
    reason,
    sessionId: session.id,
    agentState: session.agentState,
    draftVersion: session.activeDraftVersion,
    timestamp: new Date().toISOString(),
  });
  for (const client of sseClients) {
    try {
      client.write(`event: workspace_updated\ndata: ${payload}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

async function buildFullSnapshot(notifyReason?: string) {
  const llmStatus = await getLlmRuntimeStatus();
  const snap = workspaceStore.getSnapshot(llmStatus);
  if (notifyReason) {
    broadcastWorkspaceUpdate(notifyReason);
  }
  return snap;
}

const FACT_TO_ITR1_MAP: Record<
  string,
  { fieldKey: string; sectionCode: string; label: string }
> = {
  employeeName: { fieldKey: 'fullName', sectionCode: 'A', label: 'Full Name (as per PAN)' },
  employeePan: { fieldKey: 'pan', sectionCode: 'A', label: 'PAN' },
  dateOfBirth: { fieldKey: 'dateOfBirth', sectionCode: 'A', label: 'Date of Birth' },
  aadhaarLast4: { fieldKey: 'aadhaarLast4', sectionCode: 'A', label: 'Aadhaar (Last 4 Digits)' },
  email: { fieldKey: 'email', sectionCode: 'A', label: 'Email Address' },
  phone: { fieldKey: 'phone', sectionCode: 'A', label: 'Mobile Number' },
  address: { fieldKey: 'address', sectionCode: 'A', label: 'Residential Address' },
  employerName: { fieldKey: 'employerName', sectionCode: 'C', label: 'Employer Name' },
  employerTan: { fieldKey: 'employerTan', sectionCode: 'C', label: 'Employer TAN' },
  grossSalary: { fieldKey: 'grossSalary', sectionCode: 'C', label: 'Gross Salary' },
  basicSalary: { fieldKey: 'basicSalary', sectionCode: 'C', label: 'Basic Salary' },
  hraExemption: { fieldKey: 'hraExemption', sectionCode: 'C', label: 'Exempt Allowances / HRA' },
  professionalTax: { fieldKey: 'professionalTax', sectionCode: 'C', label: 'Professional Tax' },
  tdsOnSalary: { fieldKey: 'tdsClaimed', sectionCode: 'H', label: 'TDS on Salary' },
  totalTdsCredited26AS: { fieldKey: 'tdsClaimed', sectionCode: 'H', label: 'Total TDS Credit (26AS)' },
  savingsBankInterest: { fieldKey: 'savingsInterest', sectionCode: 'D', label: 'Savings Bank Interest' },
  aisReportedSavingsInterest: { fieldKey: 'savingsInterest', sectionCode: 'D', label: 'Savings Bank Interest (AIS)' },
  fdInterest: { fieldKey: 'fdInterest', sectionCode: 'D', label: 'Fixed Deposit Interest' },
  aisReportedFdInterest: { fieldKey: 'fdInterest', sectionCode: 'D', label: 'FD Interest (AIS)' },
  tdsOnInterest: { fieldKey: 'tdsOnInterest', sectionCode: 'H', label: 'TDS on Interest' },
  section80CDeclared: { fieldKey: 'section80C', sectionCode: 'E', label: 'Section 80C Investments' },
  section80CProofTotal: { fieldKey: 'section80C', sectionCode: 'E', label: 'Section 80C Proofs' },
  section80CCD1B: { fieldKey: 'section80CCD1B', sectionCode: 'E', label: 'Section 80CCD(1B) NPS' },
  section80DDeclared: { fieldKey: 'section80D', sectionCode: 'E', label: 'Section 80D Health Insurance' },
  section80DProofTotal: { fieldKey: 'section80D', sectionCode: 'E', label: 'Section 80D Proofs' },
  bankName: { fieldKey: 'bankName', sectionCode: 'J', label: 'Bank Name' },
  bankAccountNumber: { fieldKey: 'bankAccountNumber', sectionCode: 'J', label: 'Account Number' },
  bankIfsc: { fieldKey: 'bankIfsc', sectionCode: 'J', label: 'IFSC Code' },
  verificationPlace: { fieldKey: 'verificationPlace', sectionCode: 'K', label: 'Verification Place' },
};

function yieldStep(ms = 65): Promise<void> {
  if (process.env.NODE_ENV === 'test' || sseClients.size === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processSingleUploadedBuffer(params: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  category?: DocumentCategory;
}): Promise<UploadedDocument> {
  const activeSessionId = workspaceStore.getActiveSessionId();
  const category =
    params.category || workspaceStore.findCategoryByName(params.originalName);
  const existingDoc = workspaceStore
    .getDocuments()
    .find((d) => d.fileName === params.originalName);
  const docId =
    existingDoc?.id ?? `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const pendingDoc: UploadedDocument = {
    id: docId,
    sessionId: activeSessionId,
    category,
    fileName: params.originalName,
    mimeType: params.mimeType || 'application/pdf',
    fileSize: params.buffer.length,
    isSynthetic: params.originalName.toUpperCase().includes('SYNTHETIC'),
    uploadedAt: new Date().toISOString(),
    processingStatus: 'parsing',
    extractionMethod: 'pdf_text_ai',
    pageCount: 1,
    rawTextPreview: 'Running Document Intelligence Pipeline...',
    extractedFacts: [],
    structuredData: {},
    missingExpectedFields: [],
    needsUserReview: false,
    validationErrors: [],
    agentAccessAllowed: true,
  };
  workspaceStore.upsertDocument(pendingDoc);

  workspaceStore.emitLiveEvent({
    sessionId: activeSessionId,
    type: 'document_uploaded',
    stage: 'upload',
    title: `Uploaded ${params.originalName}`,
    message: `Received ${params.originalName} (${(params.buffer.length / 1024).toFixed(1)} KB).`,
    documentId: docId,
    documentName: params.originalName,
    status: 'completed',
  });

  workspaceStore.emitLiveEvent({
    sessionId: activeSessionId,
    type: 'extraction_started',
    stage: 'extraction',
    title: `Reading ${params.originalName}`,
    message: `Extracting financial fields and verifying document structure...`,
    documentId: docId,
    documentName: params.originalName,
    status: 'active',
  });

  try {
    const extraction = await extractFinancialDocument({
      buffer: params.buffer,
      mimeType: params.mimeType || 'application/pdf',
      fileName: params.originalName,
      category,
    });

    const completedDoc: UploadedDocument = {
      ...pendingDoc,
      isSynthetic: extraction.isSynthetic,
      processingStatus: 'extracted',
      extractionMethod: extraction.extractionMethod,
      pageCount: extraction.pageCount,
      rawTextPreview: extraction.rawTextPreview,
      extractedFacts: extraction.extractedFacts,
      structuredData: extraction.structuredData,
      missingExpectedFields: extraction.missingExpectedFields,
      needsUserReview: extraction.needsUserReview,
      validationErrors: extraction.validationErrors,
    };
    const saved = workspaceStore.upsertDocument(completedDoc);

    workspaceStore.emitLiveEvent({
      sessionId: activeSessionId,
      type: 'extraction_completed',
      stage: 'extraction',
      title: `Finished Reading ${params.originalName}`,
      message: `Found ${saved.extractedFacts.length} financial detail(s) across ${saved.pageCount} page(s).`,
      documentId: saved.id,
      documentName: saved.fileName,
      status: saved.needsUserReview ? 'warning' : 'completed',
    });

    const latestDraft = workspaceStore.getActiveDraft(activeSessionId);
    const currentFieldStates = workspaceStore.getFieldStates(activeSessionId);

    for (const fact of saved.extractedFacts) {
      const mapping = FACT_TO_ITR1_MAP[fact.field];
      workspaceStore.emitLiveEvent({
        sessionId: activeSessionId,
        type: 'field_extracted',
        stage: 'extraction',
        title: `Extracted ${fact.label}`,
        message: `${fact.label}: ${fact.formattedValue} (Page ${fact.pageNumber})`,
        documentId: saved.id,
        documentName: saved.fileName,
        fieldKey: mapping?.fieldKey || fact.field,
        fieldLabel: mapping?.label || fact.label,
        sectionCode: mapping?.sectionCode,
        safeValue: fact.formattedValue,
        numericValue: fact.numericValue,
        pageNumber: fact.pageNumber,
        confidence: fact.confidence,
        status: fact.validationStatus === 'needs_review' ? 'warning' : 'completed',
      });

      if (mapping) {
        await yieldStep(55);
        const fState = currentFieldStates[mapping.fieldKey];
        if (fState?.editedByUser) {
          continue;
        }
        const isProfileField = ['A', 'J', 'K'].includes(mapping.sectionCode) || ['employerName', 'employerTan'].includes(mapping.fieldKey);
        const isAutoVerified = (saved.category === 'form_16' || isProfileField) && !saved.needsUserReview;
        workspaceStore.emitLiveEvent({
          sessionId: activeSessionId,
          type: 'form_field_update_started',
          stage: 'form_filling',
          title: `Mapping to Section ${mapping.sectionCode}`,
          message: `Mapping ${mapping.label} (${fact.formattedValue}) to ITR-1 Section ${mapping.sectionCode}...`,
          documentId: saved.id,
          documentName: saved.fileName,
          fieldKey: mapping.fieldKey,
          fieldLabel: mapping.label,
          sectionCode: mapping.sectionCode,
          safeValue: fact.formattedValue,
          numericValue: fact.numericValue,
          pageNumber: fact.pageNumber,
          confidence: fact.confidence,
          status: 'active',
        });

        await yieldStep(65);
        workspaceStore.emitLiveEvent({
          sessionId: activeSessionId,
          type: 'form_field_updated',
          stage: 'form_filling',
          title: isAutoVerified
            ? `Added ${mapping.label} from ${saved.fileName}`
            : `Extracted ${mapping.label} — Confirm to Include`,
          message: isAutoVerified
            ? `Filled ${mapping.label} = ${fact.formattedValue} (Source: ${saved.fileName})`
            : `Found ${mapping.label} = ${fact.formattedValue} in ${saved.fileName}. Confirm or edit in the form.`,
          documentId: saved.id,
          documentName: saved.fileName,
          fieldKey: mapping.fieldKey,
          fieldLabel: mapping.label,
          sectionCode: mapping.sectionCode,
          safeValue: fact.formattedValue,
          numericValue: fact.numericValue,
          pageNumber: fact.pageNumber,
          confidence: fact.confidence,
          verificationStatus: saved.needsUserReview
            ? 'needs_review'
            : isAutoVerified
              ? 'verified'
              : 'pending_confirmation',
          status: isAutoVerified ? 'completed' : 'warning',
        });
      }
    }

    if (saved.category === 'form_16' && latestDraft.inputs.grossSalary > 0) {
      const reg =
        latestDraft.selectedRegime === 'new'
          ? latestDraft.taxSummary.newRegime
          : latestDraft.taxSummary.oldRegime;
      workspaceStore.emitLiveEvent({
        sessionId: activeSessionId,
        type: 'tax_computation_completed',
        stage: 'tax_calculation',
        title: 'Initial Tax Estimate Updated',
        message: `${latestDraft.selectedRegime.toUpperCase()} Regime estimated tax: ₹${reg.totalTaxLiability.toLocaleString('en-IN')}.`,
        sectionCode: 'G',
        safeValue: `₹${reg.totalTaxLiability.toLocaleString('en-IN')}`,
        numericValue: reg.totalTaxLiability,
        verificationStatus: 'calculated',
        status: 'completed',
      });
    }

    workspaceStore.emitLiveEvent({
      sessionId: activeSessionId,
      type: 'validation_completed',
      stage: 'validation',
      title: 'Return Checks Updated',
      message: `${latestDraft.validation.passCount} passed · ${latestDraft.validation.warningCount} item(s) to confirm.`,
      sectionCode: 'K',
      status: latestDraft.validation.errorCount > 0 ? 'error' : 'completed',
    });

    return saved;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Extraction failed.';
    const failedDoc: UploadedDocument = {
      ...pendingDoc,
      processingStatus: 'error',
      errorMessage: errMsg,
      validationErrors: [errMsg],
    };
    workspaceStore.upsertDocument(failedDoc);
    throw err;
  }
}

async function seedSyntheticDemoIntoActiveSession(): Promise<UploadedDocument[]> {
  const results: UploadedDocument[] = [];
  for (const syn of SYNTHETIC_DEMO_FILES) {
    const doc = await processSingleUploadedBuffer({
      buffer: Buffer.from(syn.content, 'utf-8'),
      originalName: syn.fileName,
      mimeType: syn.mimeType,
      category: syn.category,
    });
    results.push(doc);
  }
  return results;
}

function parseCliArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === flag && args[i + 1]) {
      return args[i + 1];
    }
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return undefined;
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = Number(parseCliArg('--port') || process.env.PORT || 3000);
  const HOST = parseCliArg('--host') || process.env.HOST || '0.0.0.0';

  app.use(express.json({ limit: '15mb' }));

  // 1. Full Workspace Snapshot
  app.get('/api/workspace', async (_req, res) => {
    res.json(await buildFullSnapshot());
  });

  // 1b. Live Server-Sent Events (SSE) Stream for Real-Time Activity & ITR-1 Synchronization
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const active = workspaceStore.getActiveSession();
    const lastIdHeader = req.headers['last-event-id'];
    const sinceSeq = Number(req.query.sinceSeq ?? (typeof lastIdHeader === 'string' ? lastIdHeader : 0)) || 0;

    res.write(
      `event: connected\ndata: ${JSON.stringify({
        sessionId: active.id,
        agentState: active.agentState,
        timestamp: new Date().toISOString(),
      })}\n\n`
    );

    if (sinceSeq > 0) {
      const missed = workspaceStore.getLiveEvents(active.id, sinceSeq);
      for (const ev of missed) {
        res.write(`id: ${ev.seq}\nevent: live_event\ndata: ${JSON.stringify(ev)}\n\n`);
      }
    }

    sseClients.add(res);
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 20_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  app.get('/api/events/history', (_req, res) => {
    const activeId = workspaceStore.getActiveSessionId();
    res.json({
      sessionId: activeId,
      events: workspaceStore.getLiveEvents(activeId),
    });
  });

  // 1c. Field-Level Confirm / Manual Edit / Reject Controls (Protected against silent overwrite)
  app.post('/api/fields/:fieldKey/action', async (req, res) => {
    try {
      const { action, numericValue, stringValue, reason } = req.body as {
        action: 'confirm' | 'edit' | 'reject';
        numericValue?: number;
        stringValue?: string;
        reason?: string;
      };
      const result = workspaceStore.confirmOrEditField({
        fieldKey: req.params.fieldKey,
        action,
        numericValue,
        stringValue,
        reason,
      });
      res.json({
        fieldState: result.fieldState,
        snapshot: await buildFullSnapshot(`field_${action}`),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to update field.',
      });
    }
  });

  // 2. MCP Registered Tools (All 22 Controlled Tools) + YAML Rule Verification Metadata
  app.get('/api/mcp/tools', (_req, res) => {
    res.json({
      count: MCP_TOOL_DEFINITIONS.length,
      tools: MCP_TOOL_DEFINITIONS,
      ruleVerification: getRuleVerificationMetadata(),
    });
  });

  // 3. Synthetic Demo Mode (Isolated Start / Reset + Realistic PDF Sample Pack ZIP)
  app.get('/api/demo/synthetic-files', (_req, res) => {
    res.json({ files: SYNTHETIC_DEMO_FILES });
  });

  app.get('/api/demo/sample-documents.zip', (_req, res) => {
    const zipBuffer = buildSampleDocumentsZip();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="TaxShield_Sample_Documents_AY2026_27.zip"'
    );
    res.setHeader('Content-Length', String(zipBuffer.length));
    res.send(zipBuffer);
  });

  app.post('/api/demo/start', async (_req, res) => {
    try {
      const demoSession = workspaceStore.resetIsolatedDemoSession();
      const documents = await seedSyntheticDemoIntoActiveSession();
      res.json({
        session: demoSession,
        uploadedCount: documents.length,
        documents,
        snapshot: await buildFullSnapshot('demo_started'),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to start interactive demo.',
      });
    }
  });

  app.post('/api/demo/reset', async (_req, res) => {
    try {
      const demoSession = workspaceStore.resetIsolatedDemoSession();
      const documents = await seedSyntheticDemoIntoActiveSession();
      res.json({
        session: demoSession,
        uploadedCount: documents.length,
        documents,
        snapshot: await buildFullSnapshot('demo_reset'),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to reset interactive demo.',
      });
    }
  });

  app.post('/api/demo/upload-synthetic-pack', async (_req, res) => {
    try {
      const processed = await seedSyntheticDemoIntoActiveSession();
      res.json({
        uploadedCount: processed.length,
        documents: processed,
        snapshot: await buildFullSnapshot('synthetic_pack_uploaded'),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Synthetic pack ingestion failed.',
      });
    }
  });

  // 4. Taxpayer Profile
  app.put('/api/profile', async (req, res) => {
    try {
      const updated = workspaceStore.updateProfile(req.body as Partial<UserProfile>);
      res.json({ profile: updated, snapshot: await buildFullSnapshot() });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to update profile',
      });
    }
  });

  // 5. Filing Sessions
  app.post('/api/sessions', async (req, res) => {
    const { title, preloadSyntheticDemo } = req.body as {
      title?: string;
      preloadSyntheticDemo?: boolean;
    };
    const session = workspaceStore.createNewSession({
      title,
      isDemoSession: Boolean(preloadSyntheticDemo),
    });
    if (preloadSyntheticDemo) {
      await seedSyntheticDemoIntoActiveSession();
    }
    res.json({ session, snapshot: await buildFullSnapshot() });
  });

  app.post('/api/sessions/:sessionId/activate', async (req, res) => {
    try {
      const session = workspaceStore.switchSession(req.params.sessionId);
      res.json({ session, snapshot: await buildFullSnapshot() });
    } catch (err) {
      res.status(404).json({
        error: err instanceof Error ? err.message : 'Session not found',
      });
    }
  });

  app.post('/api/sessions/clear-unsupported', async (_req, res) => {
    workspaceStore.clearUnsupportedScenarioFlags();
    res.json({ snapshot: await buildFullSnapshot() });
  });

  // 6. Single & Multi-Document Upload Pipeline (Deduplicated within Batch)
  app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No document file uploaded.' });
        return;
      }
      const explicitCat = req.body.category as DocumentCategory | undefined;
      const doc = await processSingleUploadedBuffer({
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        category: explicitCat,
      });
      res.json({ document: doc, snapshot: await buildFullSnapshot('document_uploaded') });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Document extraction failed.',
      });
    }
  });

  app.post('/api/documents/upload-batch', upload.array('files', 10), async (req, res) => {
    try {
      const files = (req.files as Express.Multer.File[]) ?? [];
      if (files.length === 0) {
        res.status(400).json({ error: 'No files provided in batch upload.' });
        return;
      }
      const explicitCat = req.body.category as DocumentCategory | undefined;
      const seenNames = new Set<string>();
      const uniqueFiles = files.filter((file) => {
        if (seenNames.has(file.originalname)) return false;
        seenNames.add(file.originalname);
        return true;
      });
      const processed: UploadedDocument[] = [];
      for (const file of uniqueFiles) {
        const doc = await processSingleUploadedBuffer({
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType: file.mimetype,
          category: explicitCat,
        });
        processed.push(doc);
      }
      res.json({
        uploadedCount: processed.length,
        documents: processed,
        snapshot: await buildFullSnapshot('documents_uploaded'),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Batch upload failed.',
      });
    }
  });

  // 7. Document ACL & Deletion
  app.patch('/api/documents/:docId/acl', async (req, res) => {
    try {
      const { agentAccessAllowed } = req.body as { agentAccessAllowed: boolean };
      const doc = workspaceStore.toggleDocumentAcl(
        req.params.docId,
        Boolean(agentAccessAllowed)
      );
      res.json({ document: doc, snapshot: await buildFullSnapshot('document_acl_updated') });
    } catch (err) {
      res.status(404).json({
        error: err instanceof Error ? err.message : 'Document not found',
      });
    }
  });

  app.delete('/api/documents/:docId', async (req, res) => {
    workspaceStore.deleteDocument(req.params.docId);
    res.json({ snapshot: await buildFullSnapshot('document_deleted') });
  });

  app.post('/api/documents/:docId/reextract', async (req, res) => {
    try {
      const existing = workspaceStore
        .getDocuments()
        .find((d) => d.id === req.params.docId);
      if (!existing) {
        res.status(404).json({ error: 'Document not found in active session.' });
        return;
      }
      const syntheticMatch = SYNTHETIC_DEMO_FILES.find(
        (s) => s.fileName === existing.fileName
      );
      const sourceText = syntheticMatch?.content || existing.rawTextPreview || '';
      const doc = await processSingleUploadedBuffer({
        buffer: Buffer.from(sourceText, 'utf-8'),
        originalName: existing.fileName,
        mimeType: syntheticMatch?.mimeType || 'text/plain',
        category: existing.category,
      });
      res.json({ document: doc, snapshot: await buildFullSnapshot('document_reextracted') });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Document re-extraction failed.',
      });
    }
  });

  // 8. Deterministic Tax Calculator Preview
  app.post('/api/tax/calculate', (req, res) => {
    const inputs = req.body as ReturnFinancialInputs;
    const summary = calculateTaxComparison(inputs);
    res.json({ summary });
  });

  // 9. Stage Return Update or Draft Finalization via SecurityGateway
  app.post('/api/gateway/stage-update', async (req, res) => {
    try {
      const { inputs, selectedRegime, reason } = req.body as {
        inputs?: Partial<ReturnFinancialInputs>;
        selectedRegime?: TaxRegime;
        reason?: string;
      };
      const outcome = await executeThroughSecurityGateway({
        toolName: 'update_return_information',
        args: {
          ...(inputs ?? {}),
          ...(selectedRegime ? { selectedRegime } : {}),
          reason: reason || 'Taxpayer staged update from workspace.',
        },
        requestedBy: 'user_staged',
      });
      res.json({ outcome, snapshot: await buildFullSnapshot('update_staged') });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to stage update',
      });
    }
  });

  app.post('/api/gateway/stage-generate', async (req, res) => {
    try {
      const { selectedRegime, releaseNote } = req.body as {
        selectedRegime?: TaxRegime;
        releaseNote?: string;
      };
      const outcome = await executeThroughSecurityGateway({
        toolName: 'generate_return_draft',
        args: {
          selectedRegime,
          releaseNote: releaseNote || 'Validated ITR-1 Sahaj draft finalized.',
        },
        requestedBy: 'user_staged',
      });
      res.json({ outcome, snapshot: await buildFullSnapshot('draft_staged') });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to stage ITR generation',
      });
    }
  });

  // 10. Resolve Pending Approval (Approve / Reject / Cancel) + Automatic Orchestrator Resume!
  app.post('/api/approvals/:approvalId/decision', async (req, res) => {
    try {
      const { action, decisionNote } = req.body as {
        action: 'approve' | 'reject' | 'cancel';
        decisionNote?: string;
      };
      const resolved = await resolveApprovalRequest({
        approvalId: req.params.approvalId,
        action,
        decisionNote,
      });
      const autoResumeMessage = await resumeOrchestratorAfterApprovalDecision({
        resolvedApproval: resolved,
        action,
      });
      res.json({
        approval: resolved,
        autoResumeMessage,
        snapshot: await buildFullSnapshot(`approval_${action}`),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to resolve approval',
      });
    }
  });

  // 11. SecurityGateway Policy & Live PII Masking Test
  app.put('/api/gateway/config', async (req, res) => {
    const config = workspaceStore.updateGatewayConfig(
      req.body as Partial<SecurityGatewayConfig>
    );
    res.json({ gatewayConfig: config, snapshot: await buildFullSnapshot() });
  });

  app.post('/api/gateway/mask-preview', (req, res) => {
    const { text } = req.body as { text: string };
    res.json(maskSensitivePii(String(text || '')));
  });

  // 12. RAG Statutory Knowledge Base Search
  app.get('/api/rag/search', (req, res) => {
    const q = String(req.query.q || 'Section 115BAC slabs 80C 87A');
    const citations = retrieveTaxRules(q, 5);
    res.json({ query: q, citations });
  });

  // 13. Autonomous AI Tax Assistant Turn (Supports Optional Attached Files)
  app.post('/api/assistant/chat', upload.array('files', 10), async (req, res) => {
    try {
      const files = (req.files as Express.Multer.File[]) ?? [];
      const message = String(req.body.message || '').trim();

      if (!message && files.length === 0) {
        res.status(400).json({ error: 'Provide a message or attach documents.' });
        return;
      }

      const attachedNames: string[] = [];
      for (const file of files) {
        const doc = await processSingleUploadedBuffer({
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType: file.mimetype,
        });
        attachedNames.push(doc.fileName);
      }

      const effectivePrompt =
        message ||
        `I have just uploaded ${attachedNames.join(', ')}. Please analyze them, extract my financial details, check for discrepancies, and tell me what needs confirmation.`;

      const reply = await runTaxAssistantTurn({
        message: effectivePrompt,
        attachedDocNames: attachedNames.length > 0 ? attachedNames : undefined,
      });

      res.json({ reply, snapshot: await buildFullSnapshot('assistant_turn') });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Autonomous Agent encountered an error.',
      });
    }
  });

  let viteServer: ViteDevServer | null = null;

  if (process.env.NODE_ENV !== 'production') {
    const hmrEnabled = process.env.DISABLE_HMR !== 'true';
    const vitePromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrEnabled,
        ws: hmrEnabled ? { server: httpServer } : false,
      },
      appType: 'spa',
    }).then((vite) => {
      viteServer = vite;
      return vite;
    });

    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      httpServer.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      httpServer.off('error', onError);
      console.log(`TaxShield MCP Server listening on http://${HOST}:${PORT}`);
      resolve();
    };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(PORT, HOST);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const client of sseClients) {
      try {
        client.end();
      } catch {
        // Ignore closed SSE stream
      }
    }
    sseClients.clear();
    if (viteServer) {
      await viteServer.close().catch(() => {});
    }
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
      setTimeout(resolve, 1500).unref();
    });
    console.log(`TaxShield MCP Server stopped cleanly (${signal}).`);
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

startServer().catch((err) => {
  console.error('Failed to start TaxShield MCP Server:', err);
  process.exit(1);
});
