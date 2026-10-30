import crypto from 'crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { z } from 'zod';
import {
  ApprovalRequest,
  GatewayDecision,
  McpToolName,
  ProposedFieldDiff,
  ReturnFinancialInputs,
  TaxRegime,
} from '../src/shared/types.js';
import { getMcpClient } from './mcpServer.js';
import { EMPTY_INPUTS, SqliteTaxWorkspaceStore, workspaceStore } from './store.js';
import { calculateTaxComparison, detectUnsupportedFilingScenario } from './taxEngine.js';

const SENSITIVE_WRITE_TOOLS = new Set<McpToolName>([
  'add_income_information',
  'add_deduction_information',
  'update_return_information',
  'generate_return_draft',
  'request_user_approval',
]);

const HUMAN_ONLY_TOOLS = new Set<McpToolName>([
  'approve_operation',
  'reject_operation',
]);

const FIELD_LABELS: Record<string, string> = {
  selectedRegime: 'Selected Tax Regime',
  grossSalary: 'Gross Salary u/s 17(1)',
  basicSalary: 'Basic Salary',
  hraExemption: 'HRA Exemption u/s 10(13A)',
  professionalTax: 'Professional Tax u/s 16(iii)',
  savingsInterest: 'Savings Bank Interest (80TTA Eligible)',
  fdInterest: 'Fixed Deposit Interest (Non-80TTA)',
  otherIncome: 'Other Taxable Income',
  section80C: 'Section 80C Deductions',
  section80CCD1: 'Section 80CCD(1) Employee NPS',
  section80CCD1B: 'Section 80CCD(1B) Additional NPS',
  section80CCD2: 'Section 80CCD(2) Employer NPS',
  section80D: 'Section 80D Health Insurance (Self/Family)',
  section80DParents: 'Section 80D Health Insurance (Parents)',
  tdsClaimed: 'Verified TDS Credit Claimed',
  advanceTax: 'Advance Tax Paid',
};

const VOLATILE_ARG_KEYS = new Set([
  'reason',
  'description',
  'justification',
  'releaseNote',
  'summary',
]);

const TOOL_ZOD_SCHEMAS: Partial<Record<McpToolName, z.ZodTypeAny>> = {
  upload_document: z.object({
    fileName: z.string().min(1).max(180),
    category: z.string().min(1),
    textContent: z.string().min(5),
  }),
  extract_document_facts: z.object({
    documentIdOrCategory: z.string().min(1),
  }),
  get_document_details: z.object({
    documentIdOrCategory: z.string().min(1),
  }),
  add_income_information: z.object({
    incomeType: z.string().min(1),
    amount: z.number().nonnegative(),
    description: z.string().min(1),
    sourceProvenance: z.string().optional(),
  }),
  add_deduction_information: z.object({
    deductionSection: z.string().min(1),
    amount: z.number().nonnegative(),
    description: z.string().min(1),
    hasSupportingProof: z.boolean().optional(),
  }),
  update_return_information: z.object({
    selectedRegime: z.enum(['new', 'old']).optional(),
    grossSalary: z.number().nonnegative().optional(),
    basicSalary: z.number().nonnegative().optional(),
    hraExemption: z.number().nonnegative().optional(),
    professionalTax: z.number().nonnegative().optional(),
    savingsInterest: z.number().nonnegative().optional(),
    fdInterest: z.number().nonnegative().optional(),
    otherIncome: z.number().nonnegative().optional(),
    section80C: z.number().nonnegative().optional(),
    section80CCD1: z.number().nonnegative().optional(),
    section80CCD1B: z.number().nonnegative().optional(),
    section80CCD2: z.number().nonnegative().optional(),
    section80D: z.number().nonnegative().optional(),
    section80DParents: z.number().nonnegative().optional(),
    tdsClaimed: z.number().nonnegative().optional(),
    advanceTax: z.number().nonnegative().optional(),
    reason: z.string().min(2),
  }),
  retrieve_tax_rules: z.object({
    query: z.string().min(1),
  }),
  generate_return_draft: z.object({
    selectedRegime: z.enum(['new', 'old']).optional(),
    releaseNote: z.string().min(2),
  }),
};

export function maskSensitivePii(rawJsonString: string): {
  maskedText: string;
  maskedCount: number;
} {
  let count = 0;
  let masked = rawJsonString;

  // Mask Indian PAN (AAAAA9999A)
  masked = masked.replace(/\b([A-Z]{5})([0-9]{4})([A-Z])\b/g, (_match, p1, _p2, p3) => {
    count += 1;
    return `${p1}****${p3}`;
  });

  // Mask Employer TAN (AAAA99999A)
  masked = masked.replace(/\b([A-Z]{4}[0-9])([0-9]{4})([A-Z])\b/g, (_match, p1, _p2, p3) => {
    count += 1;
    return `${p1}****${p3}`;
  });

  // Mask 10-16 digit bank account numbers
  masked = masked.replace(/\b([0-9]{6,12})([0-9]{4})\b/g, (match, _prefix, last4) => {
    if (match.length < 10) return match;
    count += 1;
    return `XXXXXXXX${last4}`;
  });

  // Mask Indian phone numbers
  masked = masked.replace(/\+91-[0-9]{5}-([0-9]{5})/g, (_m, last5) => {
    count += 1;
    return `+91-XXXXX-${last5}`;
  });

  // Mask email local-part
  masked = masked.replace(
    /\b([a-zA-Z0-9._%+-]{2})[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
    (_m, prefix, domain) => {
      count += 1;
      return `${prefix}***@${domain}`;
    }
  );

  return { maskedText: masked, maskedCount: count };
}

function containsPathTraversal(args: Record<string, unknown>): boolean {
  const serialized = JSON.stringify(args);
  return (
    serialized.includes('../') ||
    serialized.includes('..\\') ||
    serialized.includes('/etc/') ||
    serialized.includes('/proc/') ||
    serialized.includes('file://')
  );
}

/**
 * Canonicalizes arguments for idempotency hashing by stripping volatile prose fields
 * (`reason`, `justification`, `description`, `releaseNote`) and sorting keys deterministically.
 */
export function canonicalizeOperationArguments(
  toolName: McpToolName,
  args: Record<string, unknown>,
  draftVersionForFinalization?: number
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  const sortedKeys = Object.keys(args).sort();
  for (const k of sortedKeys) {
    if (VOLATILE_ARG_KEYS.has(k)) continue;
    const v = args[k];
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      cleaned[k] = canonicalizeOperationArguments(toolName, v as Record<string, unknown>);
    } else {
      cleaned[k] = v;
    }
  }
  if (toolName === 'generate_return_draft' && draftVersionForFinalization !== undefined) {
    cleaned._baseDraftVersion = draftVersionForFinalization;
  }
  return cleaned;
}

export function computeApprovalIdempotencyKey(params: {
  sessionId: string;
  operationType: ApprovalRequest['operationType'];
  toolName: McpToolName;
  args: Record<string, unknown>;
  draftVersion?: number;
}): string {
  const normalized = canonicalizeOperationArguments(
    params.toolName,
    params.args,
    params.draftVersion
  );
  const rawKey = `${params.sessionId}:${params.operationType}:${params.toolName}:${JSON.stringify(normalized)}`;
  return `idem-${crypto.createHash('sha256').update(rawKey).digest('hex').slice(0, 20)}`;
}

function inferSourceAndImpact(
  store: SqliteTaxWorkspaceStore,
  toolName: McpToolName,
  args: Record<string, unknown>
): {
  relevantAmount?: number;
  sourceDocumentName: string;
  taxImpactSummary: string;
} {
  const draft = store.getActiveDraft();
  const docs = store.getDocuments();
  const beforeSummary = draft.taxSummary;

  const hypotheticalInputs: ReturnFinancialInputs = {
    ...EMPTY_INPUTS,
    ...draft.inputs,
  };
  let relevantAmount: number | undefined;
  const matchedDocNames = new Set<string>();

  const matchFieldDoc = (field: string) => {
    if (field === 'savingsInterest') {
      const d = docs.find((x) => (x.structuredData.savingsBankInterest ?? 0) > 0);
      if (d) matchedDocNames.add(d.fileName);
    } else if (field === 'fdInterest') {
      const d = docs.find((x) => (x.structuredData.fdInterest ?? 0) > 0);
      if (d) matchedDocNames.add(d.fileName);
    } else if (field.startsWith('section80')) {
      const d = docs.find(
        (x) =>
          (x.structuredData.section80CProofTotal ?? 0) > 0 ||
          (x.structuredData.section80DProofTotal ?? 0) > 0
      );
      if (d) matchedDocNames.add(d.fileName);
    } else if (field === 'grossSalary' || field === 'tdsClaimed') {
      const d = docs.find((x) => x.category === 'form_16' || x.category === 'form_26as');
      if (d) matchedDocNames.add(d.fileName);
    }
  };

  if (toolName === 'add_income_information') {
    const field = String(args.incomeType || 'otherIncome') as keyof ReturnFinancialInputs;
    const amt = Number(args.amount || 0);
    relevantAmount = amt;
    (hypotheticalInputs as unknown as Record<string, unknown>)[field] = amt;
    matchFieldDoc(String(field));
  } else if (toolName === 'add_deduction_information') {
    const field = String(args.deductionSection || 'section80C') as keyof ReturnFinancialInputs;
    const amt = Number(args.amount || 0);
    relevantAmount = amt;
    (hypotheticalInputs as unknown as Record<string, unknown>)[field] = amt;
    matchFieldDoc(String(field));
  } else if (toolName === 'update_return_information') {
    let sumChanged = 0;
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === 'number' && k in hypotheticalInputs) {
        const prev = Number(hypotheticalInputs[k as keyof ReturnFinancialInputs] ?? 0);
        if (v !== prev) {
          sumChanged += v;
          (hypotheticalInputs as unknown as Record<string, unknown>)[k] = v;
          matchFieldDoc(k);
        }
      }
    }
    if (sumChanged > 0) relevantAmount = sumChanged;
  } else if (toolName === 'generate_return_draft') {
    const reg: TaxRegime =
      args.selectedRegime === 'old' || args.selectedRegime === 'new'
        ? args.selectedRegime
        : beforeSummary.recommendedRegime;
    const activeCalc = reg === 'new' ? beforeSummary.newRegime : beforeSummary.oldRegime;
    relevantAmount =
      activeCalc.refundDue > 0 ? activeCalc.refundDue : activeCalc.netTaxPayable;
    docs.forEach((d) => matchedDocNames.add(d.fileName));
    return {
      relevantAmount,
      sourceDocumentName:
        matchedDocNames.size > 0
          ? Array.from(matchedDocNames).slice(0, 2).join(', ')
          : 'Validated Return Ledger',
      taxImpactSummary:
        activeCalc.refundDue > 0
          ? `Locks ${reg.toUpperCase()} Regime Draft v${draft.version + 1} · Tax ₹${activeCalc.totalTaxLiability.toLocaleString('en-IN')} · Refund ₹${activeCalc.refundDue.toLocaleString('en-IN')}`
          : `Locks ${reg.toUpperCase()} Regime Draft v${draft.version + 1} · Tax ₹${activeCalc.totalTaxLiability.toLocaleString('en-IN')} · Payable ₹${activeCalc.netTaxPayable.toLocaleString('en-IN')}`,
    };
  }

  const afterSummary = calculateTaxComparison(hypotheticalInputs);
  const newDelta =
    afterSummary.newRegime.totalTaxLiability - beforeSummary.newRegime.totalTaxLiability;
  const oldDelta =
    afterSummary.oldRegime.totalTaxLiability - beforeSummary.oldRegime.totalTaxLiability;

  const fmtDelta = (d: number) =>
    d === 0
      ? 'no change'
      : d > 0
        ? `+₹${d.toLocaleString('en-IN')}`
        : `-₹${Math.abs(d).toLocaleString('en-IN')}`;

  const taxImpactSummary = `New Regime Tax: ₹${afterSummary.newRegime.totalTaxLiability.toLocaleString('en-IN')} (${fmtDelta(newDelta)}) · Old Regime Tax: ₹${afterSummary.oldRegime.totalTaxLiability.toLocaleString('en-IN')} (${fmtDelta(oldDelta)})`;

  return {
    relevantAmount,
    sourceDocumentName:
      matchedDocNames.size > 0
        ? Array.from(matchedDocNames).join(', ')
        : 'User / Conversation Input',
    taxImpactSummary,
  };
}

function computeProposedDiffs(
  store: SqliteTaxWorkspaceStore,
  toolName: McpToolName,
  args: Record<string, unknown>
): ProposedFieldDiff[] {
  const draft = store.getActiveDraft();
  const curInputs = { ...EMPTY_INPUTS, ...draft.inputs };
  const diffs: ProposedFieldDiff[] = [];

  if (toolName === 'add_income_information') {
    const field = String(args.incomeType || 'otherIncome') as keyof ReturnFinancialInputs;
    const prev = Number(curInputs[field] ?? 0);
    const nextVal = Number(args.amount || 0);
    if (prev !== nextVal) {
      diffs.push({
        field: String(field),
        label: FIELD_LABELS[String(field)] || String(args.incomeType),
        previousValue: `₹${prev.toLocaleString('en-IN')}`,
        proposedValue: `₹${nextVal.toLocaleString('en-IN')}`,
        sourceProvenance:
          args.sourceProvenance === 'document_extracted' ? 'document_extracted' : 'user_provided',
      });
    }
  } else if (toolName === 'add_deduction_information') {
    const field = String(args.deductionSection || 'section80C') as keyof ReturnFinancialInputs;
    const prev = Number(curInputs[field] ?? 0);
    const nextVal = Number(args.amount || 0);
    if (prev !== nextVal) {
      diffs.push({
        field: String(field),
        label: FIELD_LABELS[String(field)] || String(args.deductionSection),
        previousValue: `₹${prev.toLocaleString('en-IN')}`,
        proposedValue: `₹${nextVal.toLocaleString('en-IN')}`,
        sourceProvenance: 'user_provided',
      });
    }
  } else if (toolName === 'update_return_information') {
    if (
      (args.selectedRegime === 'new' || args.selectedRegime === 'old') &&
      args.selectedRegime !== draft.selectedRegime
    ) {
      diffs.push({
        field: 'selectedRegime',
        label: FIELD_LABELS.selectedRegime,
        previousValue: draft.selectedRegime.toUpperCase(),
        proposedValue: String(args.selectedRegime).toUpperCase(),
      });
    }
    const inputKeys = Object.keys(curInputs) as Array<keyof ReturnFinancialInputs>;
    for (const key of inputKeys) {
      if (typeof args[key] === 'number' && args[key] !== Number(curInputs[key] ?? 0)) {
        diffs.push({
          field: String(key),
          label: FIELD_LABELS[String(key)] || String(key),
          previousValue: `₹${Number(curInputs[key] ?? 0).toLocaleString('en-IN')}`,
          proposedValue: `₹${Number(args[key]).toLocaleString('en-IN')}`,
        });
      }
    }
  } else if (toolName === 'generate_return_draft') {
    const regime =
      args.selectedRegime === 'new' || args.selectedRegime === 'old'
        ? args.selectedRegime
        : draft.taxSummary.recommendedRegime;
    diffs.push({
      field: 'draftVersion',
      label: 'ITR-1 Finalized Draft Snapshot',
      previousValue: `v${draft.version} (${draft.status})`,
      proposedValue: `v${draft.version + 1} (${regime.toUpperCase()} Regime · Validated Draft)`,
    });
  } else if (toolName === 'request_user_approval' && args.proposedUpdates) {
    const updates = args.proposedUpdates as Record<string, unknown>;
    for (const [k, v] of Object.entries(updates)) {
      const prev = k in curInputs ? curInputs[k as keyof ReturnFinancialInputs] : '—';
      if (prev !== v) {
        diffs.push({
          field: k,
          label: FIELD_LABELS[k] || k,
          previousValue: typeof prev === 'number' ? `₹${prev.toLocaleString('en-IN')}` : String(prev),
          proposedValue: typeof v === 'number' ? `₹${v.toLocaleString('en-IN')}` : String(v),
        });
      }
    }
  }

  return diffs;
}

export interface GatewayExecutionOutcome {
  decision: GatewayDecision;
  piiMaskedCount: number;
  durationMs: number;
  toolOutputForAgent: Record<string, unknown>;
  approvalRequest?: ApprovalRequest;
  errorCode?: string;
}

export async function executeThroughSecurityGateway(params: {
  toolName: McpToolName;
  args: Record<string, unknown>;
  requestedBy: 'ai_agent' | 'user_staged';
  store?: SqliteTaxWorkspaceStore;
  mcpClient?: Client;
  turnToolCallSignatures?: Map<string, number>;
}): Promise<GatewayExecutionOutcome> {
  const started = Date.now();
  const { toolName, args, requestedBy } = params;
  const store = params.store ?? workspaceStore;
  const config = store.getGatewayConfig();

  const rawArgsStr = JSON.stringify(args);
  const { maskedText: maskedArgsStr, maskedCount: argMaskCount } = maskSensitivePii(rawArgsStr);

  // 1. Block Arbitrary Path Traversal / Filesystem Escape Attempts
  if (containsPathTraversal(args)) {
    store.recordAudit({
      actor: requestedBy === 'ai_agent' ? 'ai_agent' : 'taxpayer_human',
      toolName,
      operation: `blocked_traversal:${toolName}`,
      decision: 'BLOCKED_PATH_TRAVERSAL',
      executionStatus: 'blocked',
      piiFieldsMasked: argMaskCount,
      maskedPayloadPreview: maskedArgsStr,
      details: 'Blocked arbitrary filesystem path or directory traversal attempt.',
    });
    return {
      decision: 'BLOCKED_PATH_TRAVERSAL',
      piiMaskedCount: argMaskCount,
      durationMs: Date.now() - started,
      errorCode: 'ERR_PATH_TRAVERSAL_BLOCKED',
      toolOutputForAgent: {
        error: 'ERR_PATH_TRAVERSAL_BLOCKED',
        message: 'SecurityGateway rejected filesystem path or traversal characters in arguments.',
      },
    };
  }

  // 2. Prevent AI Agent from Invoking Human-Only Self-Approval Tools
  if (HUMAN_ONLY_TOOLS.has(toolName) && requestedBy === 'ai_agent') {
    store.recordAudit({
      actor: 'ai_agent',
      toolName,
      operation: `unauthorized_self_approval:${toolName}`,
      decision: 'BLOCKED_UNAUTHORIZED',
      executionStatus: 'blocked',
      piiFieldsMasked: argMaskCount,
      maskedPayloadPreview: maskedArgsStr,
      details: `Blocked AI Agent attempt to invoke human-only tool "${toolName}".`,
    });
    return {
      decision: 'BLOCKED_UNAUTHORIZED',
      piiMaskedCount: argMaskCount,
      durationMs: Date.now() - started,
      errorCode: 'ERR_AGENT_CANNOT_SELF_APPROVE',
      toolOutputForAgent: {
        error: 'ERR_AGENT_CANNOT_SELF_APPROVE',
        message:
          'SecurityGateway violation prevented: Only the human taxpayer may approve or reject staged operations.',
      },
    };
  }

  // 3. Bounded Loop / Duplicate Tool Call Guard within a Single Turn
  if (params.turnToolCallSignatures) {
    const canonicalSig = `${toolName}:${JSON.stringify(canonicalizeOperationArguments(toolName, args))}`;
    const priorCalls = params.turnToolCallSignatures.get(canonicalSig) ?? 0;
    if (priorCalls >= 2) {
      store.recordAudit({
        actor: 'ai_agent',
        toolName,
        operation: `loop_guard:${toolName}`,
        decision: 'BLOCKED_DUPLICATE_LOOP',
        executionStatus: 'blocked',
        piiFieldsMasked: argMaskCount,
        maskedPayloadPreview: maskedArgsStr,
        details: `Prevented repeated identical tool invocation (${canonicalSig.slice(0, 80)}).`,
      });
      return {
        decision: 'BLOCKED_DUPLICATE_LOOP',
        piiMaskedCount: argMaskCount,
        durationMs: Date.now() - started,
        errorCode: 'ERR_DUPLICATE_TOOL_LOOP_PREVENTED',
        toolOutputForAgent: {
          error: 'ERR_DUPLICATE_TOOL_LOOP_PREVENTED',
          message:
            'This exact tool and argument set was already executed in this turn. Summarize results or proceed to the next step.',
        },
      };
    }
    params.turnToolCallSignatures.set(canonicalSig, priorCalls + 1);
  }

  // 4. Schema Validation on Tool Arguments
  const zodSchema = TOOL_ZOD_SCHEMAS[toolName];
  if (zodSchema) {
    const parsed = zodSchema.safeParse(args);
    if (!parsed.success) {
      const errDetail = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      store.recordAudit({
        actor: requestedBy === 'ai_agent' ? 'ai_agent' : 'taxpayer_human',
        toolName,
        operation: `schema_invalid:${toolName}`,
        decision: 'BLOCKED_SCHEMA_INVALID',
        executionStatus: 'blocked',
        piiFieldsMasked: argMaskCount,
        maskedPayloadPreview: maskedArgsStr,
        details: `Schema validation failed for ${toolName}: ${errDetail}`,
      });
      return {
        decision: 'BLOCKED_SCHEMA_INVALID',
        piiMaskedCount: argMaskCount,
        durationMs: Date.now() - started,
        errorCode: 'ERR_SCHEMA_VALIDATION_FAILED',
        toolOutputForAgent: {
          error: 'ERR_SCHEMA_VALIDATION_FAILED',
          message: `Invalid arguments for ${toolName}: ${errDetail}`,
        },
      };
    }
  }

  // 5. Tool Permission Policy Check
  if (
    (toolName === 'calculate_tax' || toolName === 'compare_tax_regimes') &&
    !config.allowCalculateTaxTool
  ) {
    store.recordAudit({
      actor: requestedBy === 'ai_agent' ? 'ai_agent' : 'taxpayer_human',
      toolName,
      operation: `policy_disabled:${toolName}`,
      decision: 'BLOCKED_UNAUTHORIZED',
      executionStatus: 'blocked',
      piiFieldsMasked: argMaskCount,
      maskedPayloadPreview: maskedArgsStr,
      details: `Blocked ${toolName}: Tax calculation tool permission is disabled in SecurityGateway.`,
    });
    return {
      decision: 'BLOCKED_UNAUTHORIZED',
      piiMaskedCount: argMaskCount,
      durationMs: Date.now() - started,
      errorCode: 'ERR_TOOL_PERMISSION_DISABLED',
      toolOutputForAgent: {
        error: 'ERR_TOOL_PERMISSION_DISABLED',
        message: `Execution of ${toolName} is currently disabled by SecurityGateway policy.`,
      },
    };
  }

  // 6. Document Access Control (ACL) Check
  if (
    (toolName === 'extract_document_facts' || toolName === 'get_document_details') &&
    config.enforceDocumentAcl
  ) {
    const key = String(args.documentIdOrCategory || '');
    const docs = store.getDocuments();
    const targetDoc =
      docs.find((d) => d.id === key) ||
      docs.find((d) => d.category === key) ||
      docs.find((d) => d.fileName.toLowerCase() === key.toLowerCase()) ||
      docs.find((d) => d.category === store.findCategoryByName(key));

    if (targetDoc && !targetDoc.agentAccessAllowed) {
      store.recordAudit({
        actor: 'ai_agent',
        toolName,
        operation: `acl_denied:${targetDoc.fileName}`,
        decision: 'BLOCKED_ACL',
        executionStatus: 'blocked',
        piiFieldsMasked: argMaskCount,
        maskedPayloadPreview: maskedArgsStr,
        details: `Blocked read access to "${targetDoc.fileName}": Restricted by Taxpayer Document ACL.`,
      });
      return {
        decision: 'BLOCKED_ACL',
        piiMaskedCount: argMaskCount,
        durationMs: Date.now() - started,
        errorCode: 'ERR_DOCUMENT_ACL_DENIED',
        toolOutputForAgent: {
          error: 'ERR_DOCUMENT_ACL_DENIED',
          documentName: targetDoc.fileName,
          message: `Access to "${targetDoc.fileName}" is restricted by Taxpayer Document ACL. Ask the user to grant access in Documents if needed.`,
        },
      };
    }
  }

  // 7. Immediate Unsupported Scenario Detection Before Staging Approval
  if (toolName === 'add_income_information') {
    const combinedText = `${args.incomeType || ''} ${args.description || ''}`;
    if (detectUnsupportedFilingScenario(combinedText)) {
      const mcpClient = params.mcpClient ?? (await getMcpClient());
      const mcpRes = await mcpClient.callTool({ name: toolName, arguments: args });
      const rawOut =
        ((mcpRes.content as Array<{ text?: string }>) ?? [])
          .map((c) => c.text ?? '')
          .join('\n') || '{}';
      store.recordAudit({
        actor: requestedBy === 'ai_agent' ? 'ai_agent' : 'taxpayer_human',
        toolName,
        operation: 'halt_unsupported_scenario',
        decision: 'ALLOWED_EXECUTED',
        executionStatus: 'executed',
        piiFieldsMasked: argMaskCount,
        maskedPayloadPreview: maskedArgsStr,
        details: 'Detected unsupported ITR-1 filing scenario; halted return mutation safely.',
      });
      return {
        decision: 'ALLOWED_EXECUTED',
        piiMaskedCount: argMaskCount,
        durationMs: Date.now() - started,
        toolOutputForAgent: JSON.parse(rawOut),
      };
    }
  }

  // 8. Intercept Sensitive Mutation Tools for Idempotent Human-in-the-Loop Approval
  if (SENSITIVE_WRITE_TOOLS.has(toolName) && config.requireHumanApprovalForWrites) {
    const justification = String(
      args.reason ||
        args.description ||
        args.releaseNote ||
        args.justification ||
        'Proposed update requires human taxpayer approval.'
    );

    const executableToolName: McpToolName =
      toolName === 'request_user_approval' && args.proposedUpdates
        ? 'update_return_information'
        : toolName;
    const executableArgs: Record<string, unknown> =
      toolName === 'request_user_approval' && args.proposedUpdates
        ? { ...(args.proposedUpdates as Record<string, unknown>), reason: justification }
        : args;

    const opType: ApprovalRequest['operationType'] =
      executableToolName === 'generate_return_draft'
        ? 'draft_finalization'
        : executableToolName === 'add_income_information'
          ? 'income_addition'
          : executableToolName === 'add_deduction_information'
            ? 'deduction_addition'
            : toolName === 'request_user_approval'
              ? 'conflict_resolution'
              : 'return_update';

    const activeDraft = store.getActiveDraft();
    const diffs = computeProposedDiffs(store, executableToolName, executableArgs);

    // Semantic No-Op Guard: If all proposed field values are ALREADY applied to the active return draft,
    // do NOT create a redundant approval request!
    if (executableToolName !== 'generate_return_draft' && diffs.length === 0) {
      return {
        decision: 'ALLOWED_EXECUTED',
        piiMaskedCount: argMaskCount,
        durationMs: Date.now() - started,
        toolOutputForAgent: {
          status: 'NO_OP_ALREADY_APPLIED',
          message:
            'All proposed values already match the confirmed active return draft. No duplicate approval needed.',
          inputs: activeDraft.inputs,
        },
      };
    }

    const sessionId = store.getActiveSessionId();
    const idempotencyKey = computeApprovalIdempotencyKey({
      sessionId,
      operationType: opType,
      toolName: executableToolName,
      args: executableArgs,
      draftVersion:
        executableToolName === 'generate_return_draft' ? activeDraft.version : undefined,
    });

    const sessionApprovals = store.getApprovals(sessionId);

    // Check 8A: Reuse existing unexpired `pending` approval with identical `idempotencyKey`
    const existingPending = sessionApprovals.find((a) => {
      if (a.status !== 'pending' || a.idempotencyKey !== idempotencyKey) return false;
      if (a.expiresAt && new Date(a.expiresAt).getTime() < Date.now()) return false;
      return true;
    });

    if (existingPending) {
      return {
        decision: 'HELD_FOR_HUMAN_APPROVAL',
        piiMaskedCount: argMaskCount,
        durationMs: Date.now() - started,
        approvalRequest: existingPending,
        toolOutputForAgent: {
          status: 'PENDING_HUMAN_APPROVAL',
          idempotentReuse: true,
          idempotencyKey,
          approvalRequestId: existingPending.id,
          summary: existingPending.summary,
          diffs: existingPending.diffs,
          message: 'Identical operation is already pending human approval (idempotency guard).',
        },
      };
    }

    // Check 8B: Block re-staging an identical `generate_return_draft` that already executed on this draft version
    const alreadyExecutedSameKey = sessionApprovals.find(
      (a) =>
        (a.status === 'executed' || a.status === 'approved') &&
        a.idempotencyKey === idempotencyKey &&
        executableToolName === 'generate_return_draft'
    );
    if (alreadyExecutedSameKey) {
      return {
        decision: 'ALLOWED_EXECUTED',
        piiMaskedCount: argMaskCount,
        durationMs: Date.now() - started,
        toolOutputForAgent: {
          status: 'ALREADY_APPROVED_AND_EXECUTED',
          idempotencyKey,
          approvalRequestId: alreadyExecutedSameKey.id,
          message: 'This exact ITR-1 draft finalization was already approved and executed.',
        },
      };
    }

    const summary =
      executableToolName === 'generate_return_draft'
        ? `Finalize & Generate ITR-1 Draft v${activeDraft.version + 1}`
        : executableToolName === 'add_income_information'
          ? `Add Income (${FIELD_LABELS[String(executableArgs.incomeType)] || executableArgs.incomeType}: ₹${Number(executableArgs.amount || 0).toLocaleString('en-IN')})`
          : executableToolName === 'add_deduction_information'
            ? `Add Deduction (${FIELD_LABELS[String(executableArgs.deductionSection)] || executableArgs.deductionSection}: ₹${Number(executableArgs.amount || 0).toLocaleString('en-IN')})`
            : String(args.summary || `Update ${diffs.length} Verified Return Field(s)`);

    const { relevantAmount, sourceDocumentName, taxImpactSummary } = inferSourceAndImpact(
      store,
      executableToolName,
      executableArgs
    );

    const nowMs = Date.now();
    const approvalReq: ApprovalRequest = {
      id: `appr-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId,
      idempotencyKey,
      toolName: executableToolName,
      operationType: opType,
      requestedBy,
      status: 'pending',
      riskLevel: 'high',
      summary,
      justification,
      relevantAmount,
      sourceDocumentName,
      taxImpactSummary,
      rawArguments: executableArgs,
      maskedArguments: JSON.parse(maskSensitivePii(JSON.stringify(executableArgs)).maskedText),
      diffs,
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 24 * 60 * 60 * 1000).toISOString(),
    };

    store.addApprovalRequest(approvalReq);
    store.recordAudit({
      sessionId,
      actor: requestedBy === 'ai_agent' ? 'ai_agent' : 'taxpayer_human',
      toolName: executableToolName,
      operation: `stage_${opType}`,
      decision: 'HELD_FOR_HUMAN_APPROVAL',
      executionStatus: 'held_for_approval',
      approvalRequestId: approvalReq.id,
      piiFieldsMasked: argMaskCount,
      maskedPayloadPreview: maskedArgsStr,
      details: `SecurityGateway staged ${executableToolName} (${summary}) [key=${idempotencyKey}]. Held awaiting explicit taxpayer approval.`,
    });

    return {
      decision: 'HELD_FOR_HUMAN_APPROVAL',
      piiMaskedCount: argMaskCount,
      durationMs: Date.now() - started,
      approvalRequest: approvalReq,
      toolOutputForAgent: {
        status: 'PENDING_HUMAN_APPROVAL',
        approvalRequestId: approvalReq.id,
        idempotencyKey,
        summary,
        taxImpactSummary,
        diffs,
        message:
          'SecurityGateway paused this sensitive operation for Human-in-the-Loop approval. Explain the proposed changes and tax impact clearly so the taxpayer can Approve, Reject, or Cancel.',
      },
    };
  }

  // 9. Execute Read / Compute Tool via Controlled MCP Client
  const mcpClient = params.mcpClient ?? (await getMcpClient());
  const mcpResult = await mcpClient.callTool({
    name: toolName,
    arguments: args,
  });

  const contentArr = (mcpResult.content as Array<{ type: string; text?: string }>) ?? [];
  let rawOutputText = contentArr.map((c) => c.text ?? '').join('\n') || '{}';

  if (toolName === 'inspect_documents' && config.enforceDocumentAcl) {
    try {
      const parsed = JSON.parse(rawOutputText);
      if (Array.isArray(parsed.documents)) {
        parsed.documents = parsed.documents.map((d: Record<string, unknown>) =>
          d.agentAccessAllowed === false
            ? { ...d, structuredData: undefined, note: 'Restricted by Taxpayer ACL' }
            : d
        );
        rawOutputText = JSON.stringify(parsed);
      }
    } catch {
      // keep raw
    }
  }

  const { maskedText, maskedCount: outputMaskCount } = maskSensitivePii(rawOutputText);
  const totalMasked = config.enforcePiiMaskingToLlm ? argMaskCount + outputMaskCount : 0;
  const textSentToAgent = config.enforcePiiMaskingToLlm ? maskedText : rawOutputText;

  store.recordAudit({
    actor: requestedBy === 'ai_agent' ? 'ai_agent' : 'taxpayer_human',
    toolName,
    operation: `read_or_compute:${toolName}`,
    decision: 'ALLOWED_EXECUTED',
    executionStatus: 'executed',
    piiFieldsMasked: totalMasked,
    maskedPayloadPreview: maskedText.slice(0, 260),
    details: `Executed MCP tool ${toolName} (${totalMasked} PII fields redacted).`,
  });

  return {
    decision: 'ALLOWED_EXECUTED',
    piiMaskedCount: totalMasked,
    durationMs: Date.now() - started,
    toolOutputForAgent: JSON.parse(textSentToAgent),
  };
}

/**
 * Exact-Once Human-in-the-Loop Approval Resolution:
 * - Validates existence, `pending` state (preventing double execution), and expiration.
 * - Transitions `pending` -> `approved` -> `executed` ONLY after MCP succeeds (or `failed` on error).
 */
export async function resolveApprovalRequest(params: {
  approvalId: string;
  action: 'approve' | 'reject' | 'cancel';
  decisionNote?: string;
  store?: SqliteTaxWorkspaceStore;
  mcpClient?: Client;
}): Promise<ApprovalRequest> {
  const store = params.store ?? workspaceStore;
  const existing = store.getApprovalById(params.approvalId);

  if (!existing) {
    throw new Error(`Approval request ${params.approvalId} not found.`);
  }
  if (existing.status !== 'pending') {
    throw new Error(
      `Approval request ${params.approvalId} cannot be resolved again (current status: ${existing.status}).`
    );
  }

  // Expiration guard
  if (existing.expiresAt && new Date(existing.expiresAt).getTime() < Date.now()) {
    store.updateApprovalStatus({
      approvalId: params.approvalId,
      status: 'cancelled',
      decisionNote: 'Approval request expired prior to decision.',
      executionResultSummary: 'Expired — MCP tool was NOT invoked.',
    });
    throw new Error(`Approval request ${params.approvalId} has expired.`);
  }

  if (params.action === 'reject' || params.action === 'cancel') {
    const newStatus = params.action === 'cancel' ? 'cancelled' : 'rejected';
    const decisionFlag: GatewayDecision =
      params.action === 'cancel' ? 'CANCELLED_BY_USER' : 'REJECTED_BY_HUMAN';

    const updated = store.updateApprovalStatus({
      approvalId: params.approvalId,
      status: newStatus,
      decisionNote:
        params.decisionNote ||
        `Operation ${newStatus} by taxpayer — return state left unmodified.`,
      executionResultSummary: `Operation ${newStatus.toUpperCase()} — MCP tool was NOT invoked.`,
    });

    store.recordAudit({
      sessionId: existing.sessionId,
      actor: 'taxpayer_human',
      toolName: 'reject_operation',
      operation: `${newStatus}:${existing.toolName}`,
      decision: decisionFlag,
      executionStatus: newStatus,
      approvalRequestId: existing.id,
      piiFieldsMasked: 0,
      maskedPayloadPreview: JSON.stringify(existing.maskedArguments),
      details: `Taxpayer ${newStatus.toUpperCase()} ${existing.toolName} (${existing.summary}).`,
    });

    return updated;
  }

  // Step 1: Mark `'approved'` BEFORE invoking MCP tool (NOT `'executed'` yet!)
  store.updateApprovalStatus({
    approvalId: params.approvalId,
    status: 'approved',
    decisionNote: params.decisionNote || 'Approved by taxpayer; executing via MCP Server...',
    executionResultSummary: 'Executing controlled MCP tool...',
  });

  // Step 2: Execute via MCP Server; only mark `'executed'` if MCP execution succeeds!
  try {
    const mcpClient = params.mcpClient ?? (await getMcpClient());
    const mcpRes = await mcpClient.callTool({
      name: existing.toolName,
      arguments: existing.rawArguments,
    });

    const contentArr = (mcpRes.content as Array<{ type: string; text?: string }>) ?? [];
    const rawResultText = contentArr.map((c) => c.text ?? '').join('\n') || '{}';
    const { maskedText, maskedCount } = maskSensitivePii(rawResultText);

    const parsed = JSON.parse(rawResultText) as Record<string, unknown>;
    if (
      parsed.status === 'BLOCKED_UNSUPPORTED_SCENARIO' ||
      parsed.status === 'UNSUPPORTED_FILING_SCENARIO'
    ) {
      const failMsg = String(
        parsed.message || 'Blocked due to unsupported ITR-1 filing scenario.'
      );
      const failed = store.updateApprovalStatus({
        approvalId: params.approvalId,
        status: 'failed',
        decisionNote: params.decisionNote || 'Approved by taxpayer, halted by scope check.',
        executionResultSummary: failMsg,
      });
      store.recordAudit({
        sessionId: existing.sessionId,
        actor: 'security_gateway',
        toolName: existing.toolName,
        operation: `failed_scope:${existing.toolName}`,
        decision: 'EXECUTION_FAILED',
        executionStatus: 'failed',
        approvalRequestId: existing.id,
        piiFieldsMasked: maskedCount,
        maskedPayloadPreview: maskedText.slice(0, 260),
        details: failMsg,
      });
      return failed;
    }

    let resultSummary = 'Approved and executed via MCP Server.';
    if (parsed.newVersion) {
      const latestDraft = store.getActiveDraft(existing.sessionId);
      const opt = latestDraft.taxSummary.recommendedRegime.toUpperCase();
      const newTax = latestDraft.taxSummary.newRegime.totalTaxLiability;
      const oldTax = latestDraft.taxSummary.oldRegime.totalTaxLiability;
      resultSummary = `Committed Draft v${parsed.newVersion}. New Regime Tax: ₹${newTax.toLocaleString('en-IN')} · Old Regime Tax: ₹${oldTax.toLocaleString('en-IN')} (Optimal: ${opt}).`;
    } else if (parsed.version) {
      resultSummary = `Finalized validated ITR-1 JSON Draft v${parsed.version} (${String(parsed.selectedRegime).toUpperCase()} Regime · Refund ₹${Number(parsed.refundDue || 0).toLocaleString('en-IN')} · Payable ₹${Number(parsed.netTaxPayable || 0).toLocaleString('en-IN')}).`;
    }

    const executed = store.updateApprovalStatus({
      approvalId: params.approvalId,
      status: 'executed',
      decisionNote: params.decisionNote || 'Approved by taxpayer and executed via MCP Server.',
      executionResultSummary: resultSummary,
    });

    store.recordAudit({
      sessionId: existing.sessionId,
      actor: 'taxpayer_human',
      toolName: 'approve_operation',
      operation: `executed:${existing.toolName}`,
      decision: 'APPROVED_AND_EXECUTED',
      executionStatus: 'executed',
      approvalRequestId: existing.id,
      piiFieldsMasked: maskedCount,
      maskedPayloadPreview: maskedText.slice(0, 260),
      details: `Taxpayer APPROVED & EXECUTED ${existing.toolName}: ${resultSummary}`,
    });

    return executed;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'MCP tool execution failed.';
    store.updateApprovalStatus({
      approvalId: params.approvalId,
      status: 'failed',
      decisionNote: params.decisionNote || 'Approved by taxpayer, but MCP execution failed.',
      executionResultSummary: `Execution failed: ${errMsg}`,
    });
    store.recordAudit({
      sessionId: existing.sessionId,
      actor: 'security_gateway',
      toolName: existing.toolName,
      operation: `execution_error:${existing.toolName}`,
      decision: 'EXECUTION_FAILED',
      executionStatus: 'failed',
      approvalRequestId: existing.id,
      piiFieldsMasked: 0,
      maskedPayloadPreview: JSON.stringify(existing.maskedArguments),
      details: `MCP execution failed for ${existing.toolName}: ${errMsg}`,
    });
    throw err;
  }
}
