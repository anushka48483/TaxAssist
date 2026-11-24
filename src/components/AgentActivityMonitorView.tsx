import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  RefreshCw,
  Search,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { AgentExecutionState, WorkspaceSnapshot } from '../shared/types';
import {
  ActivityStageCategory,
  buildSessionActivityEvents,
  DerivedActivityEvent,
} from '../utils/activityEvents';
import { formatShortTime } from '../utils/format';
import {
  Button,
  EmptyState,
  MetricCard,
  PageHeader,
  SemanticTone,
  StatusIndicator,
  SurfaceCard,
} from './DesignSystem';

interface AgentActivityMonitorViewProps {
  snapshot: WorkspaceSnapshot;
  lastSyncedAt: string;
  onRefresh: () => Promise<void>;
  onNavigateToAssistant: () => void;
  onNavigateToItrForm: () => void;
  onNavigateToApprovals: () => void;
}

const STATE_DETAILS: Record<
  AgentExecutionState,
  { label: string; description: string; tone: SemanticTone; boxClass: string }
> = {
  IDLE: {
    label: 'IDLE',
    description: 'Ready for natural-language instructions or document uploads.',
    tone: 'neutral',
    boxClass: 'bg-[#F8FAFC] text-[#172B4D] border-[#E2E8F0]',
  },
  PLANNING: {
    label: 'PLANNING',
    description: 'Formulating dynamic MCP tool execution sequence.',
    tone: 'info',
    boxClass: 'bg-blue-50/70 text-[#172B4D] border-blue-200',
  },
  EXECUTING_TOOLS: {
    label: 'EXECUTING_TOOLS',
    description: 'Invoking controlled MCP tools via SecurityGateway.',
    tone: 'teal',
    boxClass: 'bg-teal-50/70 text-[#172B4D] border-teal-200',
  },
  WAITING_FOR_USER_CLARIFICATION: {
    label: 'WAITING_FOR_USER_CLARIFICATION',
    description:
      'Awaiting taxpayer confirmation on cross-document variances or missing info.',
    tone: 'warning',
    boxClass: 'bg-amber-50/80 text-amber-950 border-amber-200',
  },
  WAITING_FOR_HUMAN_APPROVAL: {
    label: 'WAITING_FOR_HUMAN_APPROVAL',
    description:
      'Paused at SecurityGateway — waiting for explicit human approval.',
    tone: 'warning',
    boxClass: 'bg-amber-50/80 text-amber-950 border-amber-200',
  },
  HALTED_UNSUPPORTED_SCENARIO: {
    label: 'HALTED_UNSUPPORTED_SCENARIO',
    description:
      'Safely halted — detected tax scenario outside ITR-1 (Sahaj) scope.',
    tone: 'error',
    boxClass: 'bg-rose-50/80 text-rose-950 border-rose-200',
  },
  COMPLETED: {
    label: 'COMPLETED',
    description:
      'All reconciliation, deterministic tax calculations, and ITR-1 validations complete.',
    tone: 'success',
    boxClass: 'bg-emerald-50/70 text-[#172B4D] border-emerald-200',
  },
  ERROR: {
    label: 'ERROR',
    description: 'Encountered a recoverable execution error.',
    tone: 'error',
    boxClass: 'bg-rose-50/80 text-rose-950 border-rose-200',
  },
};

const STAGE_LABELS: Record<ActivityStageCategory | 'all', string> = {
  all: 'All Operations',
  user_interaction: 'User & Clarifications',
  planning: 'Agent Planning',
  document_intelligence: 'Document Extraction',
  mcp_execution: 'MCP Tool Calls',
  security_gateway: 'SecurityGateway',
  human_approval: 'Human Approvals',
  tax_engine: 'Tax Engine',
  draft_validation: 'ITR-1 Draft & Validation',
};

function getEventTone(status: DerivedActivityEvent['status']): SemanticTone {
  switch (status) {
    case 'completed':
      return 'success';
    case 'pending_approval':
    case 'clarification_needed':
      return 'warning';
    case 'rejected':
    case 'blocked':
    case 'failed':
      return 'error';
  }
}

export const AgentActivityMonitorView: React.FC<
  AgentActivityMonitorViewProps
> = ({
  snapshot,
  lastSyncedAt,
  onRefresh,
  onNavigateToAssistant,
  onNavigateToItrForm,
  onNavigateToApprovals,
}) => {
  const [stageFilter, setStageFilter] = useState<ActivityStageCategory | 'all'>(
    'all'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);

  const allEvents = useMemo(
    () => buildSessionActivityEvents(snapshot),
    [snapshot]
  );

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...allEvents]
      .reverse()
      .filter((ev) => {
        if (stageFilter !== 'all' && ev.stage !== stageFilter) return false;
        if (!q) return true;
        return (
          ev.operationName.toLowerCase().includes(q) ||
          ev.description.toLowerCase().includes(q) ||
          (ev.toolName ?? '').toLowerCase().includes(q)
        );
      });
  }, [allEvents, stageFilter, searchQuery]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const currentState = snapshot.activeSession.agentState;
  const stateMeta = STATE_DETAILS[currentState] ?? STATE_DETAILS.IDLE;
  const pendingApprovals = snapshot.approvals.filter(
    (a) => a.status === 'pending'
  );

  const toolCallCount = snapshot.chatHistory.reduce(
    (sum, m) => sum + (m.toolTraces?.length ?? 0),
    0
  );

  const renderStatusIcon = (status: DerivedActivityEvent['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />;
      case 'pending_approval':
      case 'clarification_needed':
        return <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />;
      case 'rejected':
      case 'blocked':
        return <AlertOctagon className="w-4 h-4 text-rose-700 shrink-0" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-rose-700 shrink-0" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Session Telemetry */}
      <PageHeader
        eyebrow={
          <>
            <span>SESSION {snapshot.activeSession.id}</span>
            <span aria-hidden="true">·</span>
            <span>SYNCED {formatShortTime(lastSyncedAt)}</span>
            <span aria-hidden="true">·</span>
            <span>LIVE BACKEND TELEMETRY</span>
          </>
        }
        title="Agent Activity & Execution Timeline"
        description="Chronological operational trace of user instructions, dynamic orchestrator planning, MCP tool invocations, SecurityGateway validations, human approvals, and deterministic tax computations."
        actions={
          <>
            <Button
              variant="secondary"
              loading={refreshing}
              onClick={handleManualRefresh}
              icon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              Sync Now
            </Button>
            <Button variant="outline" onClick={onNavigateToItrForm}>
              ITR-1 Form Preview
            </Button>
            <Button
              variant="primary"
              onClick={onNavigateToAssistant}
              rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
            >
              Open AI Assistant
            </Button>
          </>
        }
        footer={
          <div className="space-y-4">
            {/* Prominent Current Orchestrator State Banner */}
            <div
              className={`rounded-xl border px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${stateMeta.boxClass}`}
            >
              <div className="flex items-start gap-3">
                <Activity className="w-5 h-5 text-[#2563EB] shrink-0 mt-0.5" />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wider font-semibold text-[#64748B]">
                      Current Orchestrator State
                    </span>
                    <StatusIndicator
                      tone={stateMeta.tone}
                      label={stateMeta.label}
                      mono
                    />
                  </div>
                  <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
                    {stateMeta.description}
                  </p>
                </div>
              </div>

              {pendingApprovals.length > 0 && (
                <Button
                  variant="primary"
                  onClick={onNavigateToApprovals}
                  rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                >
                  Review {pendingApprovals.length} Pending Approval
                  {pendingApprovals.length > 1 ? 's' : ''}
                </Button>
              )}
            </div>

            {/* Real Session Counters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <MetricCard
                label="Recorded Operations"
                value={String(allEvents.length)}
              />
              <MetricCard
                label="Agent MCP Tool Calls"
                value={String(toolCallCount)}
                tone="blue"
              />
              <MetricCard
                label="Approval Gates Triggered"
                value={String(snapshot.approvals.length)}
              />
              <MetricCard
                label="Active Draft Snapshot"
                value={`v${snapshot.activeDraft.version} (${snapshot.activeDraft.selectedRegime.toUpperCase()})`}
              />
            </div>
          </div>
        }
      />

      {/* Filter & Search Bar + Chronological Event Stream */}
      <SurfaceCard noPadding>
        <div className="p-4 border-b border-[#E2E8F0] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-[#F8FAFC]">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
            {(
              Object.keys(STAGE_LABELS) as Array<ActivityStageCategory | 'all'>
            ).map((key) => {
              const active = stageFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStageFilter(key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-blue-50 text-[#2563EB] border-blue-200 font-semibold'
                      : 'bg-white text-[#64748B] border-[#E2E8F0] hover:text-[#172B4D] hover:bg-[#F8FAFC]'
                  }`}
                >
                  {STAGE_LABELS[key]}
                </button>
              );
            })}
          </div>

          <div className="relative w-full lg:w-72 shrink-0">
            <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by tool or operation..."
              className="w-full pl-8 pr-3 py-1.5 text-xs text-[#172B4D] bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB]"
            />
          </div>
        </div>

        {filteredEvents.length === 0 ? (
          <EmptyState
            icon={<Activity className="w-5 h-5" />}
            title="No execution events match the selected filter yet"
            description="Send an instruction such as “Prepare my income tax return.” in the AI Filing Assistant to observe real-time planning, document reconciliation, and MCP tool execution."
            action={
              <Button variant="primary" onClick={onNavigateToAssistant}>
                Go to AI Filing Assistant
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-[#E2E8F0] bg-white">
            {filteredEvents.map((ev) => {
              const hasDetails = Boolean(
                ev.inputSummary || ev.outputSummary || ev.errorDetails
              );
              const isExpanded = Boolean(expandedIds[ev.id]);

              return (
                <div
                  key={ev.id}
                  className="p-4 sm:px-6 hover:bg-[#F8FAFC]/80 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="mt-0.5">{renderStatusIcon(ev.status)}</div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold text-[#172B4D]">
                            {ev.operationName}
                          </span>
                          {ev.toolName && (
                            <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-blue-50/80 text-[#2563EB] border border-blue-200 font-medium">
                              {ev.toolName}
                            </span>
                          )}
                          <StatusIndicator
                            tone={getEventTone(ev.status)}
                            label={ev.status.replace(/_/g, ' ')}
                            hideIcon
                            mono
                          />
                        </div>

                        <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
                          {ev.description}
                        </p>

                        {hasDetails && (
                          <button
                            type="button"
                            onClick={() => toggleExpand(ev.id)}
                            className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[#2563EB] hover:underline cursor-pointer"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {isExpanded
                                ? 'Hide Input / Output Summary'
                                : 'Inspect Input / Output Summary'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="text-right font-mono tabular-nums text-[11px] text-[#64748B] shrink-0 space-y-0.5">
                      <div>{formatShortTime(ev.timestamp)}</div>
                      {typeof ev.durationMs === 'number' && (
                        <div className="inline-flex items-center gap-1 text-[#64748B]">
                          <Clock className="w-3 h-3" />
                          <span>{ev.durationMs} ms</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {isExpanded && hasDetails && (
                    <div className="mt-3 ml-7 p-4 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] space-y-2.5 text-xs font-mono">
                      {ev.inputSummary && (
                        <div>
                          <div className="font-sans text-[11px] font-semibold text-[#64748B] mb-0.5">
                            Redacted Input Summary
                          </div>
                          <div className="text-[#172B4D] break-all">
                            {ev.inputSummary}
                          </div>
                        </div>
                      )}
                      {ev.outputSummary && (
                        <div>
                          <div className="font-sans text-[11px] font-semibold text-[#64748B] mb-0.5">
                            Redacted Output Summary
                          </div>
                          <div className="text-[#172B4D] break-all">
                            {ev.outputSummary}
                          </div>
                        </div>
                      )}
                      {ev.errorDetails && (
                        <div>
                          <div className="font-sans text-[11px] font-semibold text-rose-700 mb-0.5">
                            Error / Policy Code
                          </div>
                          <div className="text-rose-800 break-all">
                            {ev.errorDetails}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};
