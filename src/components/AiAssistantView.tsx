import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  Ban,
  BookOpen,
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  Layers,
  Loader2,
  Paperclip,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import {
  AgentExecutionState,
  DOCUMENT_CATEGORY_LABELS,
  RagRuleCitation,
  ReturnFinancialInputs,
  UploadedDocument,
  WorkspaceSnapshot,
} from '../shared/types';
import { formatINR, formatShortTime } from '../utils/format';
import { Button, StatusIndicator } from './DesignSystem';
import { MarkdownMessage } from './MarkdownMessage';

interface AiAssistantViewProps {
  snapshot: WorkspaceSnapshot;
  onSendMessage: (message: string, files?: File[]) => Promise<void>;
  onStageUpdate: (
    inputs: Partial<ReturnFinancialInputs>,
    reason: string
  ) => Promise<void>;
  onUploadSyntheticDemoPack: () => Promise<void>;
  onDownloadSyntheticFiles: () => Promise<void>;
  onResolveApproval: (
    approvalId: string,
    action: 'approve' | 'reject' | 'cancel'
  ) => Promise<void>;
  onClearUnsupportedFlags: () => Promise<void>;
  onSearchRagRules: (query: string) => Promise<RagRuleCitation[]>;
  onNavigateToItrForm: () => void;
  onNavigateToActivityMonitor: () => void;
  onNavigateToTaxComputation: () => void;
}

const DEMO_CONVERSATION_STARTERS = [
  'Prepare my income tax return.',
  'Analyze my uploaded documents and check for discrepancies.',
  'Calculate my tax under both regimes.',
  'Generate and finalize my ITR-1 return draft.',
  'I also paid ₹20,000 for health insurance u/s 80D.',
];

const AGENT_STATE_DESCRIPTIONS: Record<AgentExecutionState, string> = {
  IDLE: 'Ready for instructions',
  PLANNING: 'Planning MCP tool sequence',
  EXECUTING_TOOLS: 'Executing controlled MCP tools',
  WAITING_FOR_USER_CLARIFICATION: 'Waiting for taxpayer confirmation on variances',
  WAITING_FOR_HUMAN_APPROVAL: 'Paused at SecurityGateway — awaiting human approval',
  HALTED_UNSUPPORTED_SCENARIO: 'Halted — unsupported ITR-1 (Sahaj) tax scenario',
  COMPLETED: 'Return preparation & validation complete',
  ERROR: 'Recoverable execution error',
};

function summarizeDocumentLiveFigures(doc: UploadedDocument): string {
  const sd = doc.structuredData;
  const parts: string[] = [];
  if (typeof sd.grossSalary === 'number' && sd.grossSalary > 0) {
    parts.push(`Gross Salary ${formatINR(sd.grossSalary)}`);
  }
  if (typeof sd.tdsOnSalary === 'number' && sd.tdsOnSalary > 0) {
    parts.push(`TDS ${formatINR(sd.tdsOnSalary)}`);
  }
  if (typeof sd.savingsBankInterest === 'number' && sd.savingsBankInterest > 0) {
    parts.push(`Savings Interest ${formatINR(sd.savingsBankInterest)}`);
  }
  if (typeof sd.fdInterest === 'number' && sd.fdInterest > 0) {
    parts.push(`FD Interest ${formatINR(sd.fdInterest)}`);
  }
  if (typeof sd.section80CProofTotal === 'number' && sd.section80CProofTotal > 0) {
    parts.push(`Sec 80C Proof ${formatINR(sd.section80CProofTotal)}`);
  }
  if (typeof sd.section80DProofTotal === 'number' && sd.section80DProofTotal > 0) {
    parts.push(`Sec 80D Proof ${formatINR(sd.section80DProofTotal)}`);
  }
  if (parts.length > 0) {
    return parts.join(' · ');
  }
  if (doc.extractedFacts.length > 0) {
    return doc.extractedFacts
      .slice(0, 2)
      .map((f) => `${f.label}: ${f.formattedValue}`)
      .join(' · ');
  }
  return doc.processingStatus;
}

export const AiAssistantView: React.FC<AiAssistantViewProps> = ({
  snapshot,
  onSendMessage,
  onStageUpdate,
  onUploadSyntheticDemoPack,
  onDownloadSyntheticFiles,
  onResolveApproval,
  onClearUnsupportedFlags,
  onSearchRagRules,
  onNavigateToItrForm,
  onNavigateToActivityMonitor,
  onNavigateToTaxComputation,
}) => {
  const {
    chatHistory,
    approvals,
    auditLogs,
    documents,
    ledger,
    reconciliation,
    activeSession,
    activeDraft,
    llmStatus,
  } = snapshot;

  const [input, setInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [stagingClarification, setStagingClarification] = useState<string | null>(
    null
  );
  const [optimisticText, setOptimisticText] = useState<string | null>(null);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<'timeline' | 'provenance' | 'rag'>(
    'timeline'
  );
  const [expandedTechIds, setExpandedTechIds] = useState<Record<string, boolean>>(
    {}
  );

  const [ragQuery, setRagQuery] = useState('Section 87A rebate 12 lakh and 80C');
  const [ragResults, setRagResults] = useState<RagRuleCitation[]>([]);
  const [searchingRag, setSearchingRag] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory.length, approvals.length, sending]);

  useEffect(() => {
    let active = true;
    onSearchRagRules('Section 115BAC 87A 80C 80TTA').then((res) => {
      if (active) setRagResults(res);
    });
    return () => {
      active = false;
    };
  }, []);

  const toggleTechDetails = (msgId: string) => {
    setExpandedTechIds((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length > 0) {
      setAttachedFiles((prev) => [...prev, ...selected]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachedFile = (idx: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSend = async (overrideMessage?: string) => {
    const text = (overrideMessage ?? input).trim();
    if ((!text && attachedFiles.length === 0) || sending) return;

    const filesToSend = overrideMessage ? [] : [...attachedFiles];
    if (!overrideMessage) {
      setInput('');
      setAttachedFiles([]);
    }

    setSending(true);
    setOptimisticText(
      text ||
        (filesToSend.length > 0
          ? `Attached ${filesToSend.map((f) => f.name).join(', ')}`
          : null)
    );
    setError(null);
    try {
      await onSendMessage(text, filesToSend);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agent execution error.');
    } finally {
      setSending(false);
      setOptimisticText(null);
    }
  };

  const handleUploadSynthetic = async () => {
    setLoadingDemo(true);
    setError(null);
    try {
      await onUploadSyntheticDemoPack();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load synthetic demo pack.'
      );
    } finally {
      setLoadingDemo(false);
    }
  };

  const handleInlineDecision = async (
    approvalId: string,
    action: 'approve' | 'reject' | 'cancel'
  ) => {
    setResolvingId(approvalId);
    setError(null);
    try {
      await onResolveApproval(approvalId, action);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval resolution failed.');
    } finally {
      setResolvingId(null);
    }
  };

  const actionableReconciliationItems = reconciliation.items.filter(
    (item) =>
      item.recommendedAction && item.resolutionStatus === 'needs_clarification'
  );

  const handleConfirmIncludeAll = async () => {
    if (actionableReconciliationItems.length === 0) {
      await handleSend(
        'Yes, include all my reconciled savings bank interest, fixed deposit interest, and verified Section 80C investment proofs.'
      );
      return;
    }

    setStagingClarification('all');
    setError(null);
    try {
      const updates: Partial<ReturnFinancialInputs> = {};
      for (const item of actionableReconciliationItems) {
        if (item.recommendedAction) {
          updates[item.recommendedAction.fieldToUpdate] =
            item.recommendedAction.proposedValue as never;
        }
      }
      await onStageUpdate(
        updates,
        'Taxpayer confirmed inclusion of all reconciled items (Savings Bank Interest, Fixed Deposit Interest, and verified Section 80C proofs) via AI Assistant.'
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to stage reconciled items.'
      );
    } finally {
      setStagingClarification(null);
    }
  };

  const handleIncludeInterestOnly = async () => {
    const interestItems = actionableReconciliationItems.filter(
      (item) =>
        item.recommendedAction?.fieldToUpdate === 'savingsInterest' ||
        item.recommendedAction?.fieldToUpdate === 'fdInterest'
    );

    if (interestItems.length === 0) {
      await handleSend(
        'Include my savings bank interest and fixed deposit interest only.'
      );
      return;
    }

    setStagingClarification('interest');
    setError(null);
    try {
      const updates: Partial<ReturnFinancialInputs> = {};
      for (const item of interestItems) {
        if (item.recommendedAction) {
          updates[item.recommendedAction.fieldToUpdate] =
            item.recommendedAction.proposedValue as never;
        }
      }
      await onStageUpdate(
        updates,
        'Taxpayer confirmed inclusion of Savings Bank Interest (Section 80TTA eligible in Old Regime) and Fixed Deposit Interest (Schedule OS) separately via AI Assistant.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stage interest items.');
    } finally {
      setStagingClarification(null);
    }
  };

  const handleFocusUpdateInfo = () => {
    setInput('Update my return information: ');
    composerInputRef.current?.focus();
  };

  const handleCompareRegimesAction = () => {
    if (activeDraft.inputs.grossSalary > 0) {
      onNavigateToTaxComputation();
    } else {
      handleSend('Compare my tax under Old and New regimes.');
    }
  };

  const handleRagSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ragQuery.trim()) return;
    setSearchingRag(true);
    try {
      const results = await onSearchRagRules(ragQuery.trim());
      setRagResults(results);
    } finally {
      setSearchingRag(false);
    }
  };

  const docExtractedEntries = ledger.filter(
    (l) => l.sourceType === 'document_extracted'
  );
  const userProvidedEntries = ledger.filter(
    (l) => l.sourceType === 'user_provided'
  );
  const systemCalculatedEntries = ledger.filter(
    (l) => l.sourceType === 'system_calculated'
  );

  const pendingSessionApprovals = approvals.filter((a) => a.status === 'pending');
  const linkedApprovalIdsInMessages = new Set(
    chatHistory.flatMap((m) => m.pendingApprovalIds ?? [])
  );
  const unlinkedPendingApprovals = pendingSessionApprovals.filter(
    (a) => !linkedApprovalIdsInMessages.has(a.id)
  );

  const providerLabel =
    llmStatus.activeProvider === 'ollama_qwen3'
      ? `Ollama (${llmStatus.configuredModel})`
      : llmStatus.activeProvider === 'gemini_cloud'
        ? `Gemini (${llmStatus.configuredModel})`
        : 'Deterministic Planner';

  const nonWelcomeMessages = chatHistory.filter(
    (m) => !m.id.startsWith('msg-welcome-')
  );

  const renderApprovalCard = (appr: (typeof approvals)[number]) => (
    <div
      key={appr.id}
      className="mt-3 max-w-2xl w-full border border-amber-200 bg-amber-50/40 rounded-xl p-4 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
          <span className="text-xs font-semibold text-[#172B4D]">
            SecurityGateway Approval Required: {appr.summary}
          </span>
        </div>
        <StatusIndicator
          tone={
            appr.status === 'executed' || appr.status === 'approved'
              ? 'success'
              : appr.status === 'pending'
                ? 'warning'
                : 'error'
          }
          label={appr.status.toUpperCase()}
          mono
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-[#64748B] font-mono tabular-nums bg-white border border-[#E2E8F0] rounded-lg p-3">
        <div>
          <span className="font-sans text-[#64748B] block">MCP Tool</span>
          <span className="text-[#172B4D] font-medium">{appr.toolName}</span>
        </div>
        <div>
          <span className="font-sans text-[#64748B] block">Approval ID</span>
          <span className="text-[#172B4D]">{appr.id}</span>
        </div>
        {typeof appr.relevantAmount === 'number' && (
          <div>
            <span className="font-sans text-[#64748B] block">Financial Impact</span>
            <span className="text-[#172B4D] font-semibold">
              {formatINR(appr.relevantAmount)}
            </span>
          </div>
        )}
        {appr.sourceDocumentName && (
          <div>
            <span className="font-sans text-[#64748B] block">Source Document</span>
            <span className="text-[#172B4D] truncate block">
              {appr.sourceDocumentName}
            </span>
          </div>
        )}
      </div>

      <p className="text-xs text-[#334155] leading-relaxed">
        <span className="font-semibold text-[#172B4D]">Reason: </span>
        {appr.justification}
      </p>

      {appr.taxImpactSummary && (
        <div className="text-xs text-[#172B4D] bg-blue-50/70 border border-blue-200 rounded-lg px-3 py-2 font-mono tabular-nums">
          <span className="font-sans font-semibold text-[#2563EB]">
            Deterministic Tax Impact:{' '}
          </span>
          {appr.taxImpactSummary}
        </div>
      )}

      {appr.diffs.length > 0 && (
        <div className="bg-white border border-[#E2E8F0] rounded-lg divide-y divide-[#E2E8F0] text-xs font-mono tabular-nums">
          {appr.diffs.map((d) => (
            <div
              key={d.field}
              className="px-3 py-2 flex items-center justify-between gap-2"
            >
              <span className="font-sans text-[#334155]">{d.label}</span>
              <span>
                <span className="text-[#64748B] line-through mr-2">
                  {d.previousValue}
                </span>
                <span className="text-[#2563EB] font-semibold">
                  {d.proposedValue}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {appr.status === 'pending' ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            variant="primary"
            size="md"
            loading={resolvingId === appr.id}
            icon={<Check className="w-3.5 h-3.5" />}
            onClick={() => handleInlineDecision(appr.id, 'approve')}
          >
            Approve &amp; Continue Agent
          </Button>
          <Button
            variant="danger"
            size="md"
            disabled={resolvingId === appr.id}
            icon={<X className="w-3.5 h-3.5" />}
            onClick={() => handleInlineDecision(appr.id, 'reject')}
          >
            Reject
          </Button>
          <Button
            variant="outline"
            size="md"
            disabled={resolvingId === appr.id}
            icon={<Ban className="w-3.5 h-3.5" />}
            onClick={() => handleInlineDecision(appr.id, 'cancel')}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="text-xs font-medium text-[#334155]">
          {appr.executionResultSummary}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {activeSession.unsupportedScenarios.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertOctagon className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-semibold text-rose-900">
                Unsupported ITR-1 (Sahaj) Scenario — Agent Halted ({activeSession.agentState})
              </div>
              {activeSession.unsupportedScenarios.map((flag) => (
                <p key={flag.code} className="text-rose-800 mt-1">
                  {flag.title}: {flag.reason} (Required Form: {flag.recommendedItrForm})
                </p>
              ))}
            </div>
          </div>
          <Button variant="danger" onClick={onClearUnsupportedFlags}>
            Acknowledge &amp; Clear Flag
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 Columns: White Conversational Workspace */}
        <div className="lg:col-span-8 bg-white border border-[#E2E8F0] rounded-xl shadow-[0_1px_2px_rgba(23,43,77,0.04)] flex flex-col h-[760px]">
          {/* Header */}
          <div className="px-6 py-4 border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3 shrink-0 bg-white rounded-t-xl">
            <div>
              <h1 className="text-base font-bold text-[#172B4D]">
                AI Filing Assistant
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#64748B] mt-0.5 font-mono tabular-nums">
                <span className="font-semibold text-[#2563EB]">
                  {activeSession.agentState}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-sans">
                  {AGENT_STATE_DESCRIPTIONS[activeSession.agentState]}
                </span>
                <span aria-hidden="true">·</span>
                <span>{providerLabel}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="secondary"
                size="sm"
                icon={<Activity className="w-3.5 h-3.5" />}
                onClick={onNavigateToActivityMonitor}
              >
                Agent Activity
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={<FileSpreadsheet className="w-3.5 h-3.5 text-[#2563EB]" />}
                onClick={onNavigateToItrForm}
              >
                ITR-1 Form (v{activeDraft.version})
              </Button>
            </div>
          </div>

          {/* Starter Prompts Strip */}
          <div className="px-6 py-2.5 border-b border-[#E2E8F0] bg-[#F8FAFC] flex items-center gap-2 overflow-x-auto shrink-0">
            {DEMO_CONVERSATION_STARTERS.map((starter) => (
              <button
                key={starter}
                type="button"
                disabled={sending}
                onClick={() => handleSend(starter)}
                className="px-3 py-1.5 text-xs text-[#172B4D] bg-white border border-[#E2E8F0] rounded-lg hover:border-[#2563EB] hover:text-[#2563EB] transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
              >
                {starter.length > 52 ? `${starter.slice(0, 52)}...` : starter}
              </button>
            ))}
          </div>

          {/* Chat Message Stream */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white">
            {/* Session Onboarding Card */}
            <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-mono text-[#2563EB] font-semibold">
                    {activeSession.assessmentYear} · {activeSession.financialYear} ·{' '}
                    {activeSession.itrFormType}
                  </div>
                  <h2 className="text-base font-bold text-[#172B4D] mt-0.5">
                    Autonomous Income Tax Preparation
                  </h2>
                  <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
                    Instruct TaxShield MCP in plain language. Every tool call is mediated by SecurityGateway, tax math is computed deterministically from YAML rules, and financial mutations require your explicit approval.
                  </p>
                </div>

                {documents.length === 0 && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      icon={<Download className="w-3.5 h-3.5" />}
                      onClick={onDownloadSyntheticFiles}
                    >
                      Download 4 Demo Docs
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={loadingDemo}
                      onClick={handleUploadSynthetic}
                    >
                      Load Synthetic Demo Pack
                    </Button>
                  </div>
                )}
              </div>

              {documents.length > 0 ? (
                <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-[#F8FAFC] border-b border-[#E2E8F0] flex items-center justify-between text-[11px] font-semibold text-[#64748B]">
                    <span>Loaded Session Documents ({documents.length})</span>
                    <span className="font-mono text-[#0D9488]">Live Extracted Evidence</span>
                  </div>
                  <div className="divide-y divide-[#E2E8F0] text-xs">
                    {[...documents].reverse().map((doc) => (
                      <div
                        key={doc.id}
                        className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />
                          <span className="font-medium text-[#172B4D] truncate">
                            {DOCUMENT_CATEGORY_LABELS[doc.category]}
                          </span>
                          <span className="text-[#CBD5E1] hidden sm:inline">·</span>
                          <span className="text-[11px] text-[#64748B] font-mono truncate">
                            {doc.fileName}
                          </span>
                        </div>
                        <span className="font-mono tabular-nums text-[11.5px] font-medium text-[#172B4D] shrink-0">
                          {summarizeDocumentLiveFigures(doc)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="px-4 py-3 rounded-lg bg-white border border-[#E2E8F0] text-xs text-[#64748B]">
                  No documents are loaded in this session yet. Attach your Form 16, bank statements, FD certificates, or investment proofs below, or click <strong>Load Synthetic Demo Pack</strong> above.
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="text-xs text-[#64748B]">
                  Suggested instruction:{' '}
                  <span className="font-mono text-[#172B4D]">
                    “Prepare my income tax return.”
                  </span>
                </div>
                <Button
                  variant="primary"
                  size="md"
                  disabled={sending}
                  icon={<Sparkles className="w-3.5 h-3.5" />}
                  onClick={() => handleSend('Prepare my income tax return.')}
                >
                  Prepare my income tax return.
                </Button>
              </div>
            </div>

            {/* Conversational Messages */}
            {nonWelcomeMessages.map((msg, msgIdx) => {
              const linkedApprovals = (msg.pendingApprovalIds ?? [])
                .map((id) => approvals.find((a) => a.id === id))
                .filter((a): a is NonNullable<typeof a> => Boolean(a));
              const isTechExpanded = Boolean(expandedTechIds[msg.id]);
              const isLatestAssistant =
                msg.role === 'assistant' && msgIdx === nonWelcomeMessages.length - 1;

              const hasTechMetadata = Boolean(
                (msg.executionPlan && msg.executionPlan.steps.length > 0) ||
                  (msg.toolTraces && msg.toolTraces.length > 0) ||
                  (msg.citations && msg.citations.length > 0)
              );

              const showClarificationActions =
                msg.role === 'assistant' &&
                linkedApprovals.length === 0 &&
                pendingSessionApprovals.length === 0 &&
                ((msg.clarificationQuestions && msg.clarificationQuestions.length > 0) ||
                  (isLatestAssistant &&
                    activeSession.agentState === 'WAITING_FOR_USER_CLARIFICATION'));

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div className="text-[11px] text-[#64748B] mb-1.5 font-mono tabular-nums flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-[#172B4D] font-sans">
                      {msg.role === 'user'
                        ? 'You'
                        : msg.isAutoResumedTurn
                          ? 'TaxShield MCP · Auto-Continued'
                          : 'TaxShield MCP'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatShortTime(msg.timestamp)}</span>
                    {msg.agentStateAfterTurn && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#2563EB]">{msg.agentStateAfterTurn}</span>
                      </>
                    )}
                    {msg.isDeterministicFallback && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Rule Planner</span>
                      </>
                    )}
                  </div>

                  {msg.attachedDocuments && msg.attachedDocuments.length > 0 && (
                    <div className="mb-1.5 text-xs text-[#64748B] font-mono">
                      Attached: {msg.attachedDocuments.join(' · ')}
                    </div>
                  )}

                  {/* Strictly Light-Themed Message Surfaces */}
                  {msg.role === 'user' ? (
                    <div className="max-w-2xl rounded-xl px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap bg-blue-50 border border-blue-200 text-[#172B4D] font-medium">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="max-w-2xl w-full rounded-xl px-5 py-4 bg-white border border-[#E2E8F0] shadow-[0_1px_2px_rgba(23,43,77,0.03)]">
                      <MarkdownMessage content={msg.content} />
                    </div>
                  )}

                  {/* Structured Reconciliation Clarification Card & Real Action Buttons */}
                  {showClarificationActions && (
                    <div className="mt-3 max-w-2xl w-full bg-[#F8FAFC] border border-blue-200 rounded-xl p-4 space-y-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-[#172B4D]">
                          Reconciliation Variances Requiring Your Confirmation
                        </div>
                        <span className="font-mono text-[11px] text-[#2563EB]">
                          Stages via SecurityGateway
                        </span>
                      </div>

                      {actionableReconciliationItems.length > 0 && (
                        <div className="overflow-x-auto bg-white border border-[#E2E8F0] rounded-lg">
                          <table className="w-full text-left border-collapse text-xs tabular-nums">
                            <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B]">
                              <tr>
                                <th className="py-2 px-3 font-semibold text-[#172B4D]">
                                  Item
                                </th>
                                <th className="py-2 px-3 font-semibold text-[#172B4D]">
                                  Source
                                </th>
                                <th className="py-2 px-3 font-semibold text-[#172B4D] text-right">
                                  Extracted
                                </th>
                                <th className="py-2 px-3 font-semibold text-[#172B4D]">
                                  Statutory Treatment
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E2E8F0]">
                              {actionableReconciliationItems.map((item) => {
                                const field = item.recommendedAction?.fieldToUpdate;
                                const treatment =
                                  field === 'savingsInterest'
                                    ? 'Savings interest · Eligible u/s 80TTA (up to ₹10k in Old Regime)'
                                    : field === 'fdInterest'
                                      ? 'Fixed deposit interest · Taxable Schedule OS (Non-80TTA)'
                                      : field === 'section80C'
                                        ? 'Chapter VI-A u/s 80C (up to ₹1.5L in Old Regime)'
                                        : item.reconciliationRule;
                                return (
                                  <tr key={item.id}>
                                    <td className="py-2 px-3 font-medium text-[#172B4D]">
                                      {item.title}
                                    </td>
                                    <td className="py-2 px-3 font-mono text-[11px] text-[#64748B]">
                                      {item.sourceBDocName}
                                      {item.sourceBPage ? ` · p.${item.sourceBPage}` : ''}
                                    </td>
                                    <td className="py-2 px-3 font-mono font-semibold text-[#172B4D] text-right whitespace-nowrap">
                                      {formatINR(
                                        item.recommendedAction?.proposedValue ??
                                          item.varianceAmount
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-[11.5px] text-[#64748B]">
                                      {treatment}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <Button
                          variant="primary"
                          size="md"
                          loading={stagingClarification === 'all'}
                          disabled={sending || stagingClarification !== null}
                          icon={<Check className="w-3.5 h-3.5" />}
                          onClick={handleConfirmIncludeAll}
                        >
                          Confirm &amp; Include All
                        </Button>

                        <Button
                          variant="outline"
                          size="md"
                          loading={stagingClarification === 'interest'}
                          disabled={sending || stagingClarification !== null}
                          onClick={handleIncludeInterestOnly}
                        >
                          Include Bank &amp; FD Interest Only
                        </Button>

                        <Button
                          variant="outline"
                          size="md"
                          disabled={sending}
                          icon={<Edit3 className="w-3.5 h-3.5" />}
                          onClick={handleFocusUpdateInfo}
                        >
                          Update Information
                        </Button>

                        <Button
                          variant="secondary"
                          size="md"
                          disabled={sending}
                          icon={<Calculator className="w-3.5 h-3.5" />}
                          onClick={handleCompareRegimesAction}
                        >
                          Compare Tax Regimes
                        </Button>
                      </div>
                    </div>
                  )}

                  {linkedApprovals.map((appr) => renderApprovalCard(appr))}

                  {/* Expandable Light-Mode Technical Execution Trace */}
                  {hasTechMetadata && (
                    <div className="mt-2 max-w-2xl w-full">
                      <button
                        type="button"
                        onClick={() => toggleTechDetails(msg.id)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#64748B] hover:text-[#2563EB] cursor-pointer"
                      >
                        {isTechExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                        <span>
                          Execution Trace (
                          {msg.toolTraces?.length ?? msg.executionPlan?.steps.length ?? 0}{' '}
                          MCP operations
                          {msg.citations?.length
                            ? ` · ${msg.citations.length} YAML rules`
                            : ''}
                          )
                        </span>
                      </button>

                      {isTechExpanded && (
                        <div className="mt-2 p-3.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] space-y-3 text-xs">
                          {msg.executionPlan && msg.executionPlan.steps.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="font-semibold text-[#172B4D]">
                                Orchestrator Plan ({msg.executionPlan.llmEngineUsed})
                              </div>
                              {msg.executionPlan.steps.map((step) => (
                                <div
                                  key={`${step.stepNumber}-${step.toolName}`}
                                  className="flex items-center justify-between gap-3 text-xs"
                                >
                                  <span className="text-[#334155] truncate">
                                    {step.stepNumber}.{' '}
                                    <span className="font-mono font-medium text-[#2563EB]">
                                      {step.toolName}
                                    </span>{' '}
                                    — {step.objective}
                                  </span>
                                  <span
                                    className={`font-mono text-[11px] shrink-0 ${
                                      step.status === 'completed'
                                        ? 'text-emerald-700'
                                        : step.status === 'held_for_approval'
                                          ? 'text-amber-700'
                                          : step.status === 'failed'
                                            ? 'text-rose-700'
                                            : 'text-[#64748B]'
                                    }`}
                                  >
                                    {step.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          {msg.toolTraces && msg.toolTraces.length > 0 && (
                            <div className="pt-2 border-t border-[#E2E8F0] space-y-1.5 font-mono">
                              <div className="font-sans font-semibold text-[#172B4D]">
                                MCP SecurityGateway Traces
                              </div>
                              {msg.toolTraces.map((tr) => (
                                <div
                                  key={tr.id}
                                  className="flex items-center justify-between gap-2 text-[11px] text-[#334155] tabular-nums"
                                >
                                  <span className="truncate">
                                    {tr.toolName} → {tr.gatewayDecision}
                                    {tr.piiMaskedCount > 0
                                      ? ` (${tr.piiMaskedCount} PII masked)`
                                      : ''}
                                  </span>
                                  <span className="text-[#64748B] shrink-0">
                                    {tr.durationMs} ms
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          {msg.citations && msg.citations.length > 0 && (
                            <div className="pt-2 border-t border-[#E2E8F0] space-y-1.5">
                              <div className="font-semibold text-[#172B4D]">
                                Statutory YAML Rules Referenced
                              </div>
                              {msg.citations.map((cit) => (
                                <div key={cit.id} className="text-[11.5px] text-[#64748B]">
                                  <span className="font-semibold text-[#172B4D]">
                                    {cit.section} ({cit.title}):
                                  </span>{' '}
                                  {cit.statutoryLimit}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {unlinkedPendingApprovals.map((appr) => (
              <div key={appr.id} className="flex flex-col items-start">
                <div className="text-[11px] text-[#64748B] mb-1 font-mono tabular-nums">
                  SecurityGateway · {formatShortTime(appr.createdAt)} · WAITING_FOR_HUMAN_APPROVAL
                </div>
                {renderApprovalCard(appr)}
              </div>
            ))}

            {sending && optimisticText && (
              <div className="flex flex-col items-end">
                <div className="text-[11px] text-[#64748B] mb-1 font-mono tabular-nums">
                  You · sending...
                </div>
                <div className="max-w-2xl rounded-xl px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap bg-blue-50 border border-blue-200 text-[#172B4D] opacity-90">
                  {optimisticText}
                </div>
              </div>
            )}

            {sending && (
              <div className="flex items-center gap-2 text-xs text-[#64748B] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3.5 py-2.5 w-fit">
                <Loader2 className="w-4 h-4 animate-spin text-[#2563EB]" />
                <span>Executing controlled MCP tools via SecurityGateway...</span>
              </div>
            )}

            {error && (
              <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Attached Files Strip */}
          {attachedFiles.length > 0 && (
            <div className="px-4 py-2 bg-[#F8FAFC] border-t border-[#E2E8F0] flex flex-wrap items-center gap-2 text-xs">
              {attachedFiles.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-[#E2E8F0] rounded-md text-[#172B4D]"
                >
                  <span className="truncate max-w-[180px]">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachedFile(i)}
                    aria-label={`Remove ${f.name}`}
                    className="text-[#64748B] hover:text-rose-600 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Accessible Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="p-4 border-t border-[#E2E8F0] bg-white rounded-b-xl flex items-center gap-2.5 shrink-0"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,image/png,image/jpeg,image/webp,.txt,.json"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              variant="secondary"
              size="md"
              icon={<Paperclip className="w-3.5 h-3.5" />}
              onClick={() => fileInputRef.current?.click()}
              title="Attach Form 16, Bank Statement, FD Certificate, or Proofs"
            >
              Attach
            </Button>

            <input
              ref={composerInputRef}
              type="text"
              aria-label="Message TaxShield MCP Assistant"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask TaxShield MCP to prepare your return, explain variances, or add deductions..."
              className="flex-1 px-4 py-2 text-xs text-[#172B4D] bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB]"
            />

            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={sending || (!input.trim() && attachedFiles.length === 0)}
              icon={<Send className="w-3.5 h-3.5" />}
            >
              Send
            </Button>
          </form>
        </div>

        {/* Right 4 Columns: Companion Activity, Provenance & Statutory YAML Rules */}
        <div className="lg:col-span-4 bg-white border border-[#E2E8F0] rounded-xl shadow-[0_1px_2px_rgba(23,43,77,0.04)] overflow-hidden flex flex-col h-[760px]">
          <div className="p-3 border-b border-[#E2E8F0] bg-[#F8FAFC] shrink-0">
            <div className="flex items-center gap-1 p-1 bg-white border border-[#E2E8F0] rounded-lg">
              <button
                type="button"
                onClick={() => setRightTab('timeline')}
                className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  rightTab === 'timeline'
                    ? 'bg-blue-50 text-[#2563EB] font-semibold'
                    : 'text-[#64748B] hover:text-[#172B4D]'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                Activity
              </button>
              <button
                type="button"
                onClick={() => setRightTab('provenance')}
                className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  rightTab === 'provenance'
                    ? 'bg-blue-50 text-[#2563EB] font-semibold'
                    : 'text-[#64748B] hover:text-[#172B4D]'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Provenance ({ledger.length})
              </button>
              <button
                type="button"
                onClick={() => setRightTab('rag')}
                className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  rightTab === 'rag'
                    ? 'bg-blue-50 text-[#2563EB] font-semibold'
                    : 'text-[#64748B] hover:text-[#172B4D]'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                YAML Rules
              </button>
            </div>
          </div>

          {rightTab === 'timeline' && (
            <div className="flex-1 overflow-y-auto divide-y divide-[#E2E8F0]">
              {auditLogs.map((entry) => (
                <div key={entry.id} className="p-4 hover:bg-[#F8FAFC]">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono font-semibold text-[#172B4D]">
                      {entry.toolName}
                    </span>
                    <span className="text-[11px] font-mono tabular-nums text-[#64748B]">
                      {formatShortTime(entry.timestamp)}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono mt-1 text-[#2563EB]">
                    {entry.decision}
                    {entry.piiFieldsMasked > 0
                      ? ` · ${entry.piiFieldsMasked} PII redacted`
                      : ''}
                  </div>
                  <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
                    {entry.details}
                  </p>
                </div>
              ))}
            </div>
          )}

          {rightTab === 'provenance' && (
            <div className="flex-1 overflow-y-auto divide-y divide-[#E2E8F0] text-xs">
              <div className="p-4 bg-[#F8FAFC]">
                <div className="font-semibold text-[#172B4D]">
                  1. Document-Extracted ({docExtractedEntries.length})
                </div>
                <p className="text-[11px] text-[#64748B] mt-0.5">
                  Parsed directly from PDFs / OCR with page evidence
                </p>
                <div className="mt-2.5 space-y-2">
                  {docExtractedEntries.length === 0 ? (
                    <div className="text-[#64748B]">No extracted document facts yet.</div>
                  ) : (
                    docExtractedEntries.map((e) => (
                      <div key={e.id} className="flex justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[#172B4D] truncate">{e.label}</div>
                          <div className="text-[11px] text-[#64748B] font-mono truncate">
                            {e.sourceDocumentName} · p.{e.pageNumber ?? 1}
                          </div>
                        </div>
                        <span className="font-mono tabular-nums font-medium text-[#172B4D] shrink-0">
                          {formatINR(e.amount)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="p-4 bg-white">
                <div className="font-semibold text-[#172B4D]">
                  2. User-Provided / Approved ({userProvidedEntries.length})
                </div>
                <p className="text-[11px] text-[#64748B] mt-0.5">
                  Confirmed via chat &amp; SecurityGateway human approval
                </p>
                <div className="mt-2.5 space-y-2">
                  {userProvidedEntries.length === 0 ? (
                    <div className="text-[#64748B]">No user-confirmed additions yet.</div>
                  ) : (
                    userProvidedEntries.map((e) => (
                      <div key={e.id} className="flex justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[#172B4D] truncate">{e.label}</div>
                          <div className="text-[11px] text-[#64748B] truncate">
                            {e.notes}
                          </div>
                        </div>
                        <span className="font-mono tabular-nums font-medium text-[#2563EB] shrink-0">
                          {formatINR(e.amount)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="p-4 bg-[#F8FAFC]">
                <div className="font-semibold text-[#172B4D]">
                  3. System-Calculated ({systemCalculatedEntries.length})
                </div>
                <p className="text-[11px] text-[#64748B] mt-0.5">
                  Computed strictly by Deterministic YAML Engine
                </p>
                <div className="mt-2.5 space-y-2">
                  {systemCalculatedEntries.length === 0 ? (
                    <div className="text-[#64748B]">
                      Run calculation or approve an update.
                    </div>
                  ) : (
                    systemCalculatedEntries.map((e) => (
                      <div key={e.id} className="flex justify-between gap-2">
                        <span className="text-[#172B4D]">{e.label}</span>
                        <span className="font-mono tabular-nums font-semibold text-[#172B4D]">
                          {formatINR(e.amount)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {rightTab === 'rag' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <form
                onSubmit={handleRagSearchSubmit}
                className="p-3 border-b border-[#E2E8F0] flex items-center gap-2 shrink-0 bg-white"
              >
                <input
                  type="text"
                  value={ragQuery}
                  onChange={(e) => setRagQuery(e.target.value)}
                  placeholder="Search Sec 87A, 115BAC, 80C, 80TTA..."
                  className="flex-1 px-3 py-1.5 text-xs text-[#172B4D] border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB]"
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  loading={searchingRag}
                  icon={<Search className="w-3.5 h-3.5" />}
                  title="Search statutory rules"
                >
                  Find
                </Button>
              </form>
              <div className="flex-1 overflow-y-auto divide-y divide-[#E2E8F0]">
                {ragResults.map((rule) => (
                  <div key={rule.id} className="p-4 text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-[#2563EB]">{rule.section}</span>
                      <span className="text-[11px] font-mono text-[#64748B]">
                        {rule.assessmentYear}
                      </span>
                    </div>
                    <div className="font-semibold text-[#172B4D] mt-0.5">
                      {rule.title}
                    </div>
                    <div className="text-[11px] text-[#0D9488] font-medium mt-1">
                      {rule.statutoryLimit}
                    </div>
                    <p className="text-[#64748B] mt-1.5 leading-relaxed">
                      {rule.summary}
                    </p>
                    <div className="text-[11px] text-[#64748B] mt-1">
                      Docs: {rule.documentRequirement} · {rule.officialSource}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
