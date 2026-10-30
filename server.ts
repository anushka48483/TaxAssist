import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
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
    return workspaceStore.upsertDocument(completedDoc);
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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

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
    res.write(
      `event: connected\ndata: ${JSON.stringify({
        sessionId: active.id,
        agentState: active.agentState,
        timestamp: new Date().toISOString(),
      })}\n\n`
    );

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

  // 2. MCP Registered Tools (All 22 Controlled Tools) + YAML Rule Verification Metadata
  app.get('/api/mcp/tools', (_req, res) => {
    res.json({
      count: MCP_TOOL_DEFINITIONS.length,
      tools: MCP_TOOL_DEFINITIONS,
      ruleVerification: getRuleVerificationMetadata(),
    });
  });

  // 3. Synthetic Demo Mode (Isolated Start / Reset + 4-Document Synthetic Pack)
  app.get('/api/demo/synthetic-files', (_req, res) => {
    res.json({ files: SYNTHETIC_DEMO_FILES });
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
      res.json({ document: doc, snapshot: await buildFullSnapshot() });
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

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TaxShield MCP Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
