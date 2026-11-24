import {
  AgentToolTrace,
  McpToolName,
  WorkspaceSnapshot,
} from '../shared/types';
import { formatINR, redactSensitiveText } from './format';

export type ActivityStageCategory =
  | 'user_interaction'
  | 'planning'
  | 'document_intelligence'
  | 'mcp_execution'
  | 'security_gateway'
  | 'human_approval'
  | 'tax_engine'
  | 'draft_validation';

export interface DerivedActivityEvent {
  id: string;
  timestamp: string;
  sortOrder: number;
  stage: ActivityStageCategory;
  operationName: string;
  description: string;
  toolName?: McpToolName | 'document_acl_change' | 'orchestrator';
  actor: 'taxpayer' | 'ai_orchestrator' | 'security_gateway' | 'tax_engine';
  durationMs?: number;
  status: 'completed' | 'pending_approval' | 'clarification_needed' | 'rejected' | 'blocked' | 'failed';
  inputSummary?: string;
  outputSummary?: string;
  errorDetails?: string;
}

/**
 * Builds a strictly authentic chronological stream of agent & gateway execution events
 * from real backend session records (`documents`, `chatHistory`, `approvals`, `auditLogs`, `drafts`).
 * Zero fabricated logs or synthetic timers are ever generated.
 */
export function buildSessionActivityEvents(
  snapshot: WorkspaceSnapshot
): DerivedActivityEvent[] {
  const events: DerivedActivityEvent[] = [];
  let seq = 0;

  const pushEvent = (ev: Omit<DerivedActivityEvent, 'sortOrder'>) => {
    events.push({ ...ev, sortOrder: seq++ });
  };

  // 1. Uploaded & Extracted Documents
  const docsChron = [...snapshot.documents].sort(
    (a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
  );
  for (const doc of docsChron) {
    pushEvent({
      id: `ev-doc-${doc.id}`,
      timestamp: doc.uploadedAt,
      stage: 'document_intelligence',
      operationName: 'Document Inspected & Extracted',
      description: `${doc.fileName} processed via ${doc.extractionMethod} (${doc.extractedFacts.length} structured facts extracted${doc.needsUserReview ? ', flagged for OCR review' : ''}).`,
      toolName: 'extract_document_facts',
      actor: 'ai_orchestrator',
      status: doc.processingStatus === 'error' ? 'failed' : 'completed',
      inputSummary: redactSensitiveText(
        `fileName="${doc.fileName}", category="${doc.category}", pages=${doc.pageCount}`
      ),
      outputSummary: redactSensitiveText(
        doc.extractedFacts.map((f) => `${f.label}: ${f.formattedValue} (p.${f.pageNumber})`).join(' · ') ||
          'No structured financial facts extracted'
      ),
      errorDetails: doc.errorMessage,
    });
  }

  // Index tool traces by toolName + approximate time so we can enrich audit logs or render turn steps
  const allTraces: Array<{ msgTimestamp: string; trace: AgentToolTrace }> = [];

  // 2. Chat Messages, Orchestrator Planning, Tool Traces & Clarifications
  for (const msg of snapshot.chatHistory) {
    if (msg.id.startsWith('msg-welcome-')) {
      continue;
    }

    if (msg.role === 'user') {
      const isClarificationReply =
        /\b(yes|include|confirm|only|keep|add|paid|invested)\b/i.test(msg.content);
      pushEvent({
        id: `ev-user-${msg.id}`,
        timestamp: msg.timestamp,
        stage: 'user_interaction',
        operationName: isClarificationReply
          ? 'User Confirmation / Clarification Received'
          : 'User Request Received',
        description: redactSensitiveText(msg.content),
        toolName: 'orchestrator',
        actor: 'taxpayer',
        status: 'completed',
        inputSummary: msg.attachedDocuments?.length
          ? `Attached: ${msg.attachedDocuments.join(', ')}`
          : undefined,
      });
      continue;
    }

    // Assistant turn: Planning event if executionPlan exists
    if (msg.executionPlan && msg.executionPlan.steps.length > 0) {
      pushEvent({
        id: `ev-plan-${msg.id}`,
        timestamp: msg.timestamp,
        stage: 'planning',
        operationName: msg.isAutoResumedTurn
          ? 'Post-Approval Workflow Continuation Planned'
          : 'Agent Execution Plan Formulated',
        description: `${msg.executionPlan.llmEngineUsed} selected ${msg.executionPlan.steps.length} controlled step(s) for: "${redactSensitiveText(msg.executionPlan.intentSummary)}"`,
        toolName: 'orchestrator',
        actor: 'ai_orchestrator',
        status: 'completed',
        outputSummary: msg.executionPlan.steps
          .map((s) => `${s.stepNumber}. ${s.toolName} (${s.status})`)
          .join(' → '),
      });
    }

    if (msg.toolTraces && msg.toolTraces.length > 0) {
      for (const trace of msg.toolTraces) {
        allTraces.push({ msgTimestamp: trace.timestamp || msg.timestamp, trace });

        const isTaxTool =
          trace.toolName === 'calculate_tax' || trace.toolName === 'compare_tax_regimes';
        const isValidationTool =
          trace.toolName === 'validate_return' || trace.toolName === 'generate_return_draft';
        const isDocTool =
          trace.toolName === 'inspect_documents' ||
          trace.toolName === 'extract_document_facts' ||
          trace.toolName === 'get_document_details' ||
          trace.toolName === 'upload_document';

        const stage: ActivityStageCategory =
          trace.gatewayDecision === 'HELD_FOR_HUMAN_APPROVAL'
            ? 'human_approval'
            : trace.errorCode
              ? 'security_gateway'
              : isTaxTool
                ? 'tax_engine'
                : isValidationTool
                  ? 'draft_validation'
                  : isDocTool
                    ? 'document_intelligence'
                    : 'mcp_execution';

        const opLabel =
          trace.toolName === 'compare_tax_regimes' || trace.toolName === 'calculate_tax'
            ? 'Deterministic Tax Engine Executed'
            : trace.toolName === 'reconcile_documents'
              ? 'Cross-Document Reconciliation Executed'
              : trace.toolName === 'validate_return'
                ? 'ITR-1 Mandatory Validation Completed'
                : trace.gatewayDecision === 'HELD_FOR_HUMAN_APPROVAL'
                  ? `SecurityGateway Staged ${trace.toolName} for Approval`
                  : `MCP Tool Executed: ${trace.toolName}`;

        pushEvent({
          id: `ev-trace-${trace.id}`,
          timestamp: trace.timestamp || msg.timestamp,
          stage,
          operationName: opLabel,
          description: `${trace.summary} (${trace.gatewayDecision}${trace.piiMaskedCount > 0 ? ` · ${trace.piiMaskedCount} PII field(s) masked` : ''})`,
          toolName: trace.toolName,
          actor: isTaxTool ? 'tax_engine' : 'ai_orchestrator',
          durationMs: trace.durationMs,
          status:
            trace.gatewayDecision === 'HELD_FOR_HUMAN_APPROVAL'
              ? 'pending_approval'
              : trace.errorCode
                ? trace.gatewayDecision.startsWith('BLOCKED_')
                  ? 'blocked'
                  : 'failed'
                : 'completed',
          inputSummary: trace.maskedArgsPreview
            ? redactSensitiveText(trace.maskedArgsPreview)
            : undefined,
          outputSummary: trace.maskedResponsePreview
            ? redactSensitiveText(trace.maskedResponsePreview)
            : undefined,
          errorDetails: trace.errorCode,
        });
      }
    }

    if (msg.clarificationQuestions && msg.clarificationQuestions.length > 0) {
      pushEvent({
        id: `ev-clarify-${msg.id}`,
        timestamp: msg.timestamp,
        stage: 'user_interaction',
        operationName: 'Clarification Requested from Taxpayer',
        description: redactSensitiveText(msg.clarificationQuestions[0]),
        toolName: 'orchestrator',
        actor: 'ai_orchestrator',
        status: 'clarification_needed',
      });
    }
  }

  // 3. Human-in-the-Loop Approval Decisions
  const approvalsChron = [...snapshot.approvals].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  for (const appr of approvalsChron) {
    if (appr.decidedAt) {
      pushEvent({
        id: `ev-appr-decided-${appr.id}`,
        timestamp: appr.decidedAt,
        stage: 'human_approval',
        operationName:
          appr.status === 'executed'
            ? 'Human Approval Granted & MCP Mutation Executed'
            : appr.status === 'rejected'
              ? 'Human Approval Rejected — Return Unchanged'
              : appr.status === 'cancelled'
                ? 'Staged Approval Cancelled'
                : 'Approved Operation Halted Safely',
        description: `${appr.summary} (${appr.toolName}) → ${appr.status.toUpperCase()}. ${appr.executionResultSummary || ''}`,
        toolName: appr.toolName,
        actor: 'taxpayer',
        status:
          appr.status === 'executed'
            ? 'completed'
            : appr.status === 'rejected' || appr.status === 'cancelled'
              ? 'rejected'
              : 'failed',
        inputSummary: redactSensitiveText(JSON.stringify(appr.maskedArguments)),
        outputSummary: appr.diffs
          .map((d) => `${d.label}: ${d.previousValue} → ${d.proposedValue}`)
          .join(' · '),
      });
    }
  }

  // 4. SecurityGateway Audit Events not already represented by trace IDs (e.g. session init, user-staged updates, ACL changes)
  const auditChron = [...snapshot.auditLogs].reverse();
  for (const audit of auditChron) {
    if (
      audit.operation === 'initialize_session' ||
      audit.toolName === 'document_acl_change' ||
      audit.operation === 'update_gateway_policy' ||
      audit.actor === 'taxpayer_human'
    ) {
      pushEvent({
        id: `ev-audit-${audit.id}`,
        timestamp: audit.timestamp,
        stage: 'security_gateway',
        operationName:
          audit.operation === 'initialize_session'
            ? 'Session & Hash-Chained Audit Ledger Initialized'
            : `SecurityGateway Governance: ${audit.operation}`,
        description: audit.details,
        toolName: audit.toolName,
        actor: 'security_gateway',
        status:
          audit.executionStatus === 'held_for_approval'
            ? 'pending_approval'
            : audit.executionStatus === 'rejected' || audit.executionStatus === 'cancelled'
              ? 'rejected'
              : audit.executionStatus === 'blocked'
                ? 'blocked'
                : audit.executionStatus === 'failed'
                  ? 'failed'
                  : 'completed',
        inputSummary: audit.maskedPayloadPreview,
        outputSummary: `Decision: ${audit.decision} · SHA-256: ${audit.integrityHash}`,
      });
    }
  }

  // 5. Draft Version Snapshots (ITR-1 Draft Generator + Tax Calculation)
  for (const draft of snapshot.drafts) {
    if (draft.version === 1) continue;
    const reg =
      draft.selectedRegime === 'new'
        ? draft.taxSummary.newRegime
        : draft.taxSummary.oldRegime;

    pushEvent({
      id: `ev-draft-${draft.id}`,
      timestamp: draft.createdAt,
      stage: 'draft_validation',
      operationName:
        draft.status === 'validated_ready'
          ? `ITR-1 Draft v${draft.version} Finalized & Validated`
          : `ITR-1 Draft v${draft.version} Updated`,
      description: `${draft.changeNote} (${draft.selectedRegime.toUpperCase()} Regime · Taxable Income ${formatINR(reg.taxableIncome)} · Tax ${formatINR(reg.totalTaxLiability)})`,
      toolName: draft.status === 'validated_ready' ? 'generate_return_draft' : 'inspect_return',
      actor: 'tax_engine',
      status: draft.status === 'blocked_unsupported' ? 'blocked' : 'completed',
      outputSummary: `Validation: ${draft.validation.passCount} passed · ${draft.validation.warningCount} warnings · ${draft.validation.errorCount} errors`,
    });
  }

  return events.sort((a, b) => {
    const timeDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.sortOrder - b.sortOrder;
  });
}
