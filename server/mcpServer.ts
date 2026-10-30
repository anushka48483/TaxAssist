import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  DocumentCategory,
  DOCUMENT_CATEGORY_LABELS,
  McpToolName,
  ReturnFinancialInputs,
  TaxRegime,
  UploadedDocument,
} from '../src/shared/types.js';
import { EMPTY_INPUTS, SqliteTaxWorkspaceStore, workspaceStore } from './store.js';
import {
  calculateTaxComparison,
  computeSingleRegime,
  detectUnsupportedFilingScenario,
  validateReturnData,
} from './taxEngine.js';
import { reconcileDocumentsAndReturn } from './reconciliationEngine.js';
import { retrieveTaxRules } from './ragKnowledgeBase.js';
import { extractFinancialDocument } from './documentExtractor.js';

export const MCP_TOOL_DEFINITIONS = [
  // --- 1. Document Tools ---
  {
    name: 'upload_document',
    description:
      'Ingest and extract a text-based tax document into the current filing session vault.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fileName: { type: 'string', description: 'Document filename (no path traversal)' },
        category: {
          type: 'string',
          description:
            'form_16, salary_slips, bank_statements, interest_certificates, investment_proofs, form_26as, ais, tis, or other_tax_doc',
        },
        textContent: { type: 'string', description: 'Raw text content of the document' },
      },
      required: ['fileName', 'category', 'textContent'],
    },
  },
  {
    name: 'inspect_documents',
    description:
      'List all uploaded documents in the current session, their extraction status, confidence, missing fields, and validation errors.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: 'Optional category filter' },
      },
    },
  },
  {
    name: 'extract_document_facts',
    description:
      'Retrieve structured financial extraction with page numbers, confidence scores, and validation status for an uploaded document.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        documentIdOrCategory: {
          type: 'string',
          description:
            'Document ID or category key (form_16, bank_statements, interest_certificates, investment_proofs, form_26as, ais, tis)',
        },
      },
      required: ['documentIdOrCategory'],
    },
  },
  {
    name: 'get_document_details',
    description:
      'Get full metadata, OCR/raw text preview, structured normalized JSON, and validation errors for a specific document.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        documentIdOrCategory: { type: 'string', description: 'Document ID or category name' },
      },
      required: ['documentIdOrCategory'],
    },
  },

  // --- 2. Financial Tools ---
  {
    name: 'get_financial_summary',
    description:
      'Read consolidated financial profile separated by provenance (document_extracted, user_provided, system_calculated) and keeping savingsInterest separate from fdInterest.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'reconcile_documents',
    description:
      'Compare Form 16 vs Salary Slips, Form 16 TDS vs Form 26AS, separate Savings Interest vs FD Interest, and Form 16 vs Investment Proofs while deduplicating overlapping reports.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'add_income_information',
    description:
      'SENSITIVE ACTION (Requires Human Approval): Add or confirm reconciled income (grossSalary, savingsInterest, fdInterest, otherIncome) keeping savings and FD interest strictly separate.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        incomeType: {
          type: 'string',
          description:
            'grossSalary, savingsInterest, fdInterest, otherIncome, or unsupported scenario description',
        },
        amount: { type: 'number', description: 'Income amount in INR' },
        description: {
          type: 'string',
          description: 'Source document reference or user confirmation context',
        },
        sourceProvenance: {
          type: 'string',
          description: '"user_provided" or "document_extracted"',
        },
      },
      required: ['incomeType', 'amount', 'description'],
    },
  },
  {
    name: 'add_deduction_information',
    description:
      'SENSITIVE ACTION (Requires Human Approval): Add or confirm eligible tax deductions (section80C, section80CCD1, section80CCD1B, section80CCD2, section80D, section80DParents, hraExemption, professionalTax).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        deductionSection: {
          type: 'string',
          description:
            'section80C, section80CCD1, section80CCD1B, section80CCD2, section80D, section80DParents, hraExemption, or professionalTax',
        },
        amount: { type: 'number', description: 'Deduction amount paid/invested in INR' },
        description: {
          type: 'string',
          description: 'Details such as ELSS, PPF, NPS, health insurance policy, or Form 16 proof',
        },
        hasSupportingProof: {
          type: 'boolean',
          description: 'Whether documentary receipt is uploaded or confirmed by user',
        },
      },
      required: ['deductionSection', 'amount', 'description'],
    },
  },
  {
    name: 'update_return_information',
    description:
      'SENSITIVE ACTION (Requires Human Approval): Batch-update multiple return financial fields (salary, savingsInterest, fdInterest, deductions, TDS, advanceTax, or regime) after reconciliation.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        selectedRegime: { type: 'string', description: '"new" or "old"' },
        grossSalary: { type: 'number' },
        basicSalary: { type: 'number' },
        hraExemption: { type: 'number' },
        professionalTax: { type: 'number' },
        savingsInterest: { type: 'number' },
        fdInterest: { type: 'number' },
        otherIncome: { type: 'number' },
        section80C: { type: 'number' },
        section80CCD1: { type: 'number' },
        section80CCD1B: { type: 'number' },
        section80CCD2: { type: 'number' },
        section80D: { type: 'number' },
        section80DParents: { type: 'number' },
        tdsClaimed: { type: 'number' },
        advanceTax: { type: 'number' },
        reason: { type: 'string', description: 'Explanation and evidence source for the update' },
      },
      required: ['reason'],
    },
  },

  // --- 3. Tax Tools ---
  {
    name: 'retrieve_tax_rules',
    description:
      'Retrieve official AY 2026-27 Indian Income Tax Act rules, deduction limits, document requirements, and ITR-1 scope from rules/AY2026-27.yaml.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Rule topic or section keyword' },
      },
      required: ['query'],
    },
  },
  {
    name: 'calculate_tax',
    description:
      'Run the YAML-driven deterministic tax engine for a specific regime ("new" or "old") or hypothetical figures without mutating the saved return.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        regime: { type: 'string', description: '"new" or "old" (defaults to selected regime)' },
        grossSalary: { type: 'number' },
        basicSalary: { type: 'number' },
        hraExemption: { type: 'number' },
        professionalTax: { type: 'number' },
        savingsInterest: { type: 'number' },
        fdInterest: { type: 'number' },
        otherIncome: { type: 'number' },
        section80C: { type: 'number' },
        section80CCD1: { type: 'number' },
        section80CCD1B: { type: 'number' },
        section80CCD2: { type: 'number' },
        section80D: { type: 'number' },
        section80DParents: { type: 'number' },
        tdsClaimed: { type: 'number' },
        advanceTax: { type: 'number' },
      },
    },
  },
  {
    name: 'compare_tax_regimes',
    description:
      'Deterministically compute and compare Old Tax Regime vs New Tax Regime (u/s 115BAC(1A)) from rules/AY2026-27.yaml.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        grossSalary: { type: 'number' },
        basicSalary: { type: 'number' },
        hraExemption: { type: 'number' },
        professionalTax: { type: 'number' },
        savingsInterest: { type: 'number' },
        fdInterest: { type: 'number' },
        otherIncome: { type: 'number' },
        section80C: { type: 'number' },
        section80CCD1: { type: 'number' },
        section80CCD1B: { type: 'number' },
        section80CCD2: { type: 'number' },
        section80D: { type: 'number' },
        section80DParents: { type: 'number' },
        tdsClaimed: { type: 'number' },
        advanceTax: { type: 'number' },
      },
    },
  },
  {
    name: 'validate_return',
    description:
      'Validate mandatory ITR-1 fields, PAN/IFSC formats, unsupported scenario flags, separate savings/FD interest checks, and TDS consistency.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },

  // --- 4. Return Tools ---
  {
    name: 'inspect_return',
    description:
      'Inspect current active return draft inputs, selected regime, deterministic tax summary, and validation state.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'generate_return_draft',
    description:
      'SENSITIVE ACTION (Requires Human Approval): Finalize and generate a new versioned, validated ITR-1 Sahaj draft snapshot.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        selectedRegime: { type: 'string', description: '"new" or "old"' },
        releaseNote: { type: 'string', description: 'Summary note for this ITR-1 draft version' },
      },
      required: ['releaseNote'],
    },
  },
  {
    name: 'export_return_json',
    description:
      'Export the structured ITR-1 Sahaj JSON payload for the active or specified draft version (local draft only; never submits to government portal).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        version: { type: 'number', description: 'Optional draft version number' },
      },
    },
  },
  {
    name: 'get_return_status',
    description:
      'Check high-level filing session status, active draft version, pending approvals count, and unsupported scenario flags.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },

  // --- 5. Security Tools ---
  {
    name: 'check_permissions',
    description:
      'Check SecurityGateway authorization and approval policy for a given MCP tool name and actor.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        toolName: { type: 'string', description: 'MCP tool name to inspect permissions for' },
      },
      required: ['toolName'],
    },
  },
  {
    name: 'request_user_approval',
    description:
      'Explicitly create a human-in-the-loop approval request when resolving an ambiguous document value or discrepancy.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string' },
        justification: { type: 'string' },
        proposedUpdates: {
          type: 'object',
          description: 'Key-value financial updates to apply once approved',
        },
      },
      required: ['summary', 'justification'],
    },
  },
  {
    name: 'approve_operation',
    description:
      'HUMAN-ONLY TOOL: Approve a pending approval request and execute its underlying operation.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        approvalId: { type: 'string' },
        decisionNote: { type: 'string' },
      },
      required: ['approvalId'],
    },
  },
  {
    name: 'reject_operation',
    description:
      'HUMAN-ONLY TOOL: Reject or cancel a pending approval request without modifying the return.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        approvalId: { type: 'string' },
        decisionNote: { type: 'string' },
      },
      required: ['approvalId'],
    },
  },
  {
    name: 'get_audit_history',
    description:
      'Retrieve PII-masked SHA-256 hash-chained SecurityGateway audit records for the current filing session.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max entries to return (default 20)' },
      },
    },
  },
];

export async function createBoundMcpClient(
  store: SqliteTaxWorkspaceStore = workspaceStore
): Promise<Client> {
  const mcpServer = new Server(
    {
      name: 'axshield-autonomous-mcp-server',
      version: '2.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: MCP_TOOL_DEFINITIONS };
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name as McpToolName;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    const mergeHypotheticalInputs = (): ReturnFinancialInputs => {
      const cur = { ...EMPTY_INPUTS, ...store.getActiveDraft().inputs };
      const num = (k: keyof ReturnFinancialInputs) =>
        typeof args[k] === 'number' ? (args[k] as number) : Number(cur[k] ?? 0);
      return {
        ...cur,
        grossSalary: num('grossSalary'),
        basicSalary: num('basicSalary'),
        hraExemption: num('hraExemption'),
        professionalTax: num('professionalTax'),
        savingsInterest: num('savingsInterest'),
        fdInterest: num('fdInterest'),
        otherIncome: num('otherIncome'),
        section80C: num('section80C'),
        section80CCD1: num('section80CCD1'),
        section80CCD1B: num('section80CCD1B'),
        section80CCD2: num('section80CCD2'),
        section80D: num('section80D'),
        section80DParents: num('section80DParents'),
        tdsClaimed: num('tdsClaimed'),
        advanceTax: num('advanceTax'),
      };
    };

    switch (toolName) {
      case 'upload_document': {
        const fileName = String(args.fileName || 'Uploaded_Document.txt');
        const category =
          (args.category as DocumentCategory) || store.findCategoryByName(fileName);
        const textContent = String(args.textContent || '');
        const buffer = Buffer.from(textContent, 'utf-8');
        const extraction = await extractFinancialDocument({
          buffer,
          mimeType: 'text/plain',
          fileName,
          category,
        });
        const doc: UploadedDocument = {
          id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          sessionId: store.getActiveSessionId(),
          category,
          fileName,
          mimeType: 'text/plain',
          fileSize: buffer.length,
          isSynthetic: extraction.isSynthetic,
          uploadedAt: new Date().toISOString(),
          processingStatus: 'extracted',
          extractionMethod: extraction.extractionMethod,
          pageCount: extraction.pageCount,
          rawTextPreview: extraction.rawTextPreview,
          extractedFacts: extraction.extractedFacts,
          structuredData: extraction.structuredData,
          missingExpectedFields: extraction.missingExpectedFields,
          needsUserReview: extraction.needsUserReview,
          validationErrors: extraction.validationErrors,
          agentAccessAllowed: true,
        };
        store.upsertDocument(doc);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'EXTRACTED',
                documentId: doc.id,
                fileName: doc.fileName,
                category: doc.category,
                factCount: doc.extractedFacts.length,
                missingExpectedFields: doc.missingExpectedFields,
                needsUserReview: doc.needsUserReview,
                validationErrors: doc.validationErrors,
              }),
            },
          ],
        };
      }

      case 'inspect_documents': {
        const categoryFilter = typeof args.category === 'string' ? args.category : undefined;
        const allDocs = store.getDocuments();
        const filtered = categoryFilter
          ? allDocs.filter((d) => d.category === categoryFilter)
          : allDocs;

        const coreCats: DocumentCategory[] = ['form_16', 'bank_statements', 'investment_proofs'];
        const uploadedSet = new Set(allDocs.map((d) => d.category));
        const missingCore = coreCats.filter((c) => !uploadedSet.has(c));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'OK',
                uploadedCount: filtered.length,
                missingCoreDocuments: missingCore.map((c) => ({
                  category: c,
                  label: DOCUMENT_CATEGORY_LABELS[c],
                })),
                documents: filtered.map((d) => ({
                  id: d.id,
                  category: d.category,
                  categoryLabel: DOCUMENT_CATEGORY_LABELS[d.category],
                  fileName: d.fileName,
                  isSynthetic: d.isSynthetic,
                  processingStatus: d.processingStatus,
                  extractionMethod: d.extractionMethod,
                  pageCount: d.pageCount,
                  agentAccessAllowed: d.agentAccessAllowed,
                  needsUserReview: d.needsUserReview,
                  missingExpectedFields: d.missingExpectedFields,
                  factCount: d.extractedFacts.length,
                  structuredData: d.agentAccessAllowed ? d.structuredData : undefined,
                  validationErrors: d.validationErrors,
                })),
              }),
            },
          ],
        };
      }

      case 'extract_document_facts':
      case 'get_document_details': {
        const key = String(args.documentIdOrCategory || '');
        const docs = store.getDocuments();
        const target =
          docs.find((d) => d.id === key) ||
          docs.find((d) => d.category === key) ||
          docs.find((d) => d.fileName.toLowerCase() === key.toLowerCase()) ||
          docs.find((d) => d.category === store.findCategoryByName(key));

        if (!target) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'NOT_FOUND',
                  errorCode: 'ERR_DOCUMENT_NOT_FOUND',
                  message: `No uploaded document matched "${key}".`,
                }),
              },
            ],
          };
        }

        const payload =
          toolName === 'get_document_details'
            ? target
            : {
                status: 'OK',
                documentId: target.id,
                fileName: target.fileName,
                isSynthetic: target.isSynthetic,
                category: target.category,
                pageCount: target.pageCount,
                needsUserReview: target.needsUserReview,
                missingExpectedFields: target.missingExpectedFields,
                structuredData: target.structuredData,
                extractedFacts: target.extractedFacts,
                validationErrors: target.validationErrors,
              };

        return {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
        };
      }

      case 'get_financial_summary': {
        const ledger = store.getLedgerEntries();
        const draft = store.getActiveDraft();
        const grouped = {
          documentExtracted: ledger.filter((e) => e.sourceType === 'document_extracted'),
          userProvided: ledger.filter((e) => e.sourceType === 'user_provided'),
          systemCalculated: ledger.filter((e) => e.sourceType === 'system_calculated'),
          confirmedReturnInputs: draft.inputs,
          selectedRegime: draft.selectedRegime,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(grouped) }],
        };
      }

      case 'reconcile_documents': {
        const docs = store.getDocuments();
        const draft = store.getActiveDraft();
        const report = reconcileDocumentsAndReturn(docs, draft.inputs);
        return {
          content: [{ type: 'text', text: JSON.stringify(report) }],
        };
      }

      case 'add_income_information': {
        const incomeType = String(args.incomeType || '');
        const amount = Number(args.amount || 0);
        const description = String(args.description || '');
        const provenance =
          args.sourceProvenance === 'document_extracted'
            ? 'document_extracted'
            : 'user_provided';

        const unsupported = detectUnsupportedFilingScenario(`${incomeType} ${description}`);
        if (unsupported) {
          store.addUnsupportedScenarioFlag(unsupported);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'UNSUPPORTED_FILING_SCENARIO',
                  unsupportedFlag: unsupported,
                  message: `${unsupported.title}: ${unsupported.reason} Recommended handling: ${unsupported.recommendedItrForm}. Return modification halted safely.`,
                }),
              },
            ],
          };
        }

        const partial: Partial<ReturnFinancialInputs> = {};
        if (incomeType === 'grossSalary') partial.grossSalary = amount;
        else if (incomeType === 'savingsInterest') partial.savingsInterest = amount;
        else if (incomeType === 'fdInterest') partial.fdInterest = amount;
        else partial.otherIncome = amount;

        store.addLedgerEntry({
          sourceType: provenance,
          category: 'income',
          field: incomeType,
          label: `Confirmed Income (${incomeType})`,
          amount,
          status: 'confirmed',
          notes: description,
        });

        const updatedDraft = store.commitNewDraft({
          inputs: partial,
          changeNote: `Added income (${incomeType}: ₹${amount.toLocaleString('en-IN')}) — ${description}`,
          approvedBy: 'Human Taxpayer Approval (MCP add_income_information)',
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'UPDATED',
                newVersion: updatedDraft.version,
                inputs: updatedDraft.inputs,
                taxSummary: updatedDraft.taxSummary,
              }),
            },
          ],
        };
      }

      case 'add_deduction_information': {
        const section = String(args.deductionSection || 'section80C');
        const amount = Number(args.amount || 0);
        const description = String(args.description || '');

        const partial: Partial<ReturnFinancialInputs> = {};
        if (section === 'section80C') partial.section80C = amount;
        else if (section === 'section80CCD1') partial.section80CCD1 = amount;
        else if (section === 'section80CCD1B') partial.section80CCD1B = amount;
        else if (section === 'section80CCD2') partial.section80CCD2 = amount;
        else if (section === 'section80D') partial.section80D = amount;
        else if (section === 'section80DParents') partial.section80DParents = amount;
        else if (section === 'hraExemption') partial.hraExemption = amount;
        else if (section === 'professionalTax') partial.professionalTax = amount;

        store.addLedgerEntry({
          sourceType: 'user_provided',
          category: 'deduction',
          field: section,
          label: `Confirmed Deduction (${section})`,
          amount,
          status: 'confirmed',
          notes: description,
        });

        const updatedDraft = store.commitNewDraft({
          inputs: partial,
          changeNote: `Added deduction (${section}: ₹${amount.toLocaleString('en-IN')}) — ${description}`,
          approvedBy: 'Human Taxpayer Approval (MCP add_deduction_information)',
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'UPDATED',
                newVersion: updatedDraft.version,
                inputs: updatedDraft.inputs,
                taxSummary: updatedDraft.taxSummary,
              }),
            },
          ],
        };
      }

      case 'update_return_information': {
        const partial: Partial<ReturnFinancialInputs> = {};
        const numericKeys: Array<keyof ReturnFinancialInputs> = [
          'grossSalary',
          'basicSalary',
          'hraExemption',
          'professionalTax',
          'savingsInterest',
          'fdInterest',
          'otherIncome',
          'section80C',
          'section80CCD1',
          'section80CCD1B',
          'section80CCD2',
          'section80D',
          'section80DParents',
          'tdsClaimed',
          'advanceTax',
        ];
        for (const k of numericKeys) {
          if (typeof args[k] === 'number') {
            (partial as Record<string, unknown>)[k] = args[k] as number;
            store.addLedgerEntry({
              sourceType: 'user_provided',
              category:
                k === 'tdsClaimed' || k === 'advanceTax'
                  ? 'tax_credit'
                  : String(k).startsWith('section') ||
                      k === 'hraExemption' ||
                      k === 'professionalTax'
                    ? 'deduction'
                    : 'income',
              field: String(k),
              label: `Approved Update (${String(k)})`,
              amount: args[k] as number,
              status: 'confirmed',
              notes: String(args.reason || 'Approved return update'),
            });
          }
        }
        const selectedRegime: TaxRegime | undefined =
          args.selectedRegime === 'new' || args.selectedRegime === 'old'
            ? args.selectedRegime
            : undefined;

        const newDraft = store.commitNewDraft({
          inputs: partial,
          selectedRegime,
          changeNote: String(args.reason || 'Updated return draft via approved MCP execution.'),
          approvedBy: 'Human Taxpayer Approval (SecurityGateway)',
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'UPDATED',
                newVersion: newDraft.version,
                selectedRegime: newDraft.selectedRegime,
                inputs: newDraft.inputs,
                recommendedRegime: newDraft.taxSummary.recommendedRegime,
                newRegimeTax: newDraft.taxSummary.newRegime.totalTaxLiability,
                oldRegimeTax: newDraft.taxSummary.oldRegime.totalTaxLiability,
                newRegimeRefund: newDraft.taxSummary.newRegime.refundDue,
                oldRegimeRefund: newDraft.taxSummary.oldRegime.refundDue,
              }),
            },
          ],
        };
      }

      case 'retrieve_tax_rules': {
        const query = String(args.query || 'AY 2026-27 slabs 80C 87A');
        const citations = retrieveTaxRules(query, 4);
        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'OK', query, citations }) }],
        };
      }

      case 'calculate_tax': {
        const merged = mergeHypotheticalInputs();
        const regime: TaxRegime =
          args.regime === 'old' || args.regime === 'new'
            ? args.regime
            : store.getActiveDraft().selectedRegime;
        const computation = computeSingleRegime(merged, regime);
        return {
          content: [{ type: 'text', text: JSON.stringify(computation) }],
        };
      }

      case 'compare_tax_regimes': {
        const merged = mergeHypotheticalInputs();
        const comparison = calculateTaxComparison(merged);
        return {
          content: [{ type: 'text', text: JSON.stringify(comparison) }],
        };
      }

      case 'validate_return': {
        const profile = store.getProfile();
        const draft = store.getActiveDraft();
        const docs = store.getDocuments();
        const session = store.getActiveSession();
        const validation = validateReturnData(
          profile,
          draft.inputs,
          draft.selectedRegime,
          docs,
          session.unsupportedScenarios
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(validation) }],
        };
      }

      case 'inspect_return': {
        const profile = store.getProfile();
        const draft = store.getActiveDraft();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                version: draft.version,
                status: draft.status,
                selectedRegime: draft.selectedRegime,
                taxpayer: profile,
                inputs: draft.inputs,
                taxSummary: draft.taxSummary,
                validation: draft.validation,
              }),
            },
          ],
        };
      }

      case 'generate_return_draft': {
        const session = store.getActiveSession();
        const current = store.getActiveDraft();
        if (
          session.unsupportedScenarios.length > 0 ||
          current.validation.unsupportedScenarios.length > 0
        ) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'BLOCKED_UNSUPPORTED_SCENARIO',
                  unsupportedScenarios:
                    session.unsupportedScenarios.length > 0
                      ? session.unsupportedScenarios
                      : current.validation.unsupportedScenarios,
                  message:
                    'Cannot finalize ITR-1 (Sahaj) draft while unsupported income scenarios or >₹50L income ceiling violations are active.',
                }),
              },
            ],
          };
        }

        const regime: TaxRegime =
          args.selectedRegime === 'new' || args.selectedRegime === 'old'
            ? args.selectedRegime
            : current.taxSummary.recommendedRegime;
        const releaseNote = String(
          args.releaseNote || 'Validated ITR-1 Sahaj return draft generated for local download.'
        );

        const generated = store.commitNewDraft({
          inputs: current.inputs,
          selectedRegime: regime,
          changeNote: `ITR-1 Draft Finalized: ${releaseNote}`,
          approvedBy: 'Human Taxpayer Approval (SecurityGateway)',
        });

        const regCalc =
          regime === 'new' ? generated.taxSummary.newRegime : generated.taxSummary.oldRegime;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'DRAFT_GENERATED_LOCAL_ONLY',
                portalSubmitted: false,
                draftId: generated.id,
                version: generated.version,
                selectedRegime: generated.selectedRegime,
                isValid: generated.validation.isValid,
                taxableIncome: regCalc.taxableIncome,
                totalTaxLiability: regCalc.totalTaxLiability,
                tdsCredited: regCalc.tdsCredited,
                refundDue: regCalc.refundDue,
                netTaxPayable: regCalc.netTaxPayable,
              }),
            },
          ],
        };
      }

      case 'export_return_json': {
        const drafts = store.getDrafts();
        const ver = typeof args.version === 'number' ? args.version : undefined;
        const target = ver ? drafts.find((d) => d.version === ver) : drafts[drafts.length - 1];
        if (!target) {
          throw new Error(`Draft version ${ver} not found.`);
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                version: target.version,
                selectedRegime: target.selectedRegime,
                portalSubmitted: false,
                itrJson: target.itrJson,
              }),
            },
          ],
        };
      }

      case 'get_return_status': {
        const session = store.getActiveSession();
        const draft = store.getActiveDraft();
        const pendingApprovals = store
          .getApprovals()
          .filter((a) => a.status === 'pending').length;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sessionId: session.id,
                sessionStatus: session.status,
                agentState: session.agentState,
                activeDraftVersion: draft.version,
                draftStatus: draft.status,
                pendingApprovals,
                unsupportedScenarios: session.unsupportedScenarios,
                portalSubmitted: false,
              }),
            },
          ],
        };
      }

      case 'check_permissions': {
        const targetTool = String(args.toolName || '');
        const cfg = store.getGatewayConfig();
        const writeTools = new Set([
          'add_income_information',
          'add_deduction_information',
          'update_return_information',
          'generate_return_draft',
          'request_user_approval',
        ]);
        const humanOnlyTools = new Set(['approve_operation', 'reject_operation']);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                toolName: targetTool,
                agentExecutable: !humanOnlyTools.has(targetTool),
                requiresHumanApproval:
                  writeTools.has(targetTool) && cfg.requireHumanApprovalForWrites,
                piiMaskingEnforced: cfg.enforcePiiMaskingToLlm,
                documentAclEnforced: cfg.enforceDocumentAcl,
              }),
            },
          ],
        };
      }

      case 'request_user_approval': {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'APPROVAL_REQUEST_LOGGED',
                summary: args.summary,
              }),
            },
          ],
        };
      }

      case 'approve_operation':
      case 'reject_operation': {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'HANDLED_BY_SECURITY_GATEWAY',
                approvalId: args.approvalId,
              }),
            },
          ],
        };
      }

      case 'get_audit_history': {
        const limit = typeof args.limit === 'number' ? Math.min(50, args.limit) : 20;
        const logs = store.getAuditLogs().slice(0, limit);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                count: logs.length,
                auditChainValid: store.verifyAuditHashChain(),
                logs,
              }),
            },
          ],
        };
      }

      default:
        throw new Error(`ERR_UNKNOWN_MCP_TOOL: Unknown MCP tool "${toolName}".`);
    }
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    {
      name: 'axshield-security-gateway-mcp-client',
      version: '2.1.0',
    },
    { capabilities: {} }
  );

  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

let defaultMcpClient: Client | null = null;

export async function getMcpClient(): Promise<Client> {
  if (!defaultMcpClient) {
    defaultMcpClient = await createBoundMcpClient(workspaceStore);
  }
  return defaultMcpClient;
}
