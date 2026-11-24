import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Calculator,
  CheckCircle2,
  Cpu,
  Database,
  FileCheck2,
  FileSpreadsheet,
  Layout,
  Network,
  ShieldCheck,
  User,
  Wrench,
} from 'lucide-react';
import { AgentExecutionState, WorkspaceSnapshot } from '../shared/types';
import { buildSessionActivityEvents } from '../utils/activityEvents';
import { formatINR, formatShortTime } from '../utils/format';
import {
  Button,
  PageHeader,
  StatusIndicator,
  SurfaceCard,
} from './DesignSystem';

interface SystemArchitectureViewProps {
  snapshot: WorkspaceSnapshot;
  onNavigateToMonitor: () => void;
  onNavigateToMcpTools: () => void;
  onNavigateToItrForm: () => void;
}

interface ArchNode {
  id: string;
  stepNumber: string;
  name: string;
  roleSummary: string;
  icon: React.ComponentType<{ className?: string }>;
  isActiveNow: boolean;
  hasExecuted: boolean;
  liveMetric: string;
  evidenceLines: string[];
}

function getActiveNodeIdsForState(state: AgentExecutionState): Set<string> {
  switch (state) {
    case 'PLANNING':
      return new Set(['orchestrator', 'llm-adapter']);
    case 'EXECUTING_TOOLS':
      return new Set([
        'mcp-client',
        'security-gateway',
        'mcp-tools',
        'tax-engine',
      ]);
    case 'WAITING_FOR_USER_CLARIFICATION':
      return new Set(['user', 'frontend', 'orchestrator']);
    case 'WAITING_FOR_HUMAN_APPROVAL':
      return new Set(['security-gateway', 'user']);
    case 'HALTED_UNSUPPORTED_SCENARIO':
      return new Set(['validation-audit']);
    case 'COMPLETED':
      return new Set(['itr1-generator', 'validation-audit']);
    case 'ERROR':
      return new Set(['orchestrator', 'security-gateway']);
    case 'IDLE':
    default:
      return new Set(['frontend', 'orchestrator']);
  }
}

export const SystemArchitectureView: React.FC<SystemArchitectureViewProps> = ({
  snapshot,
  onNavigateToMonitor,
  onNavigateToMcpTools,
  onNavigateToItrForm,
}) => {
  const {
    activeSession,
    activeDraft,
    documents,
    ledger,
    approvals,
    auditLogs,
    auditChainValid,
    chatHistory,
    llmStatus,
    ruleVerification,
  } = snapshot;

  const events = useMemo(
    () => buildSessionActivityEvents(snapshot),
    [snapshot]
  );

  const userTurns = chatHistory.filter((m) => m.role === 'user');
  const aiTurns = chatHistory.filter(
    (m) => m.role === 'assistant' && !m.id.startsWith('msg-welcome-')
  );
  const allTraces = chatHistory.flatMap((m) => m.toolTraces ?? []);
  const taxToolCalls = allTraces.filter(
    (t) => t.toolName === 'calculate_tax' || t.toolName === 'compare_tax_regimes'
  );
  const totalPiiRedacted = auditLogs.reduce(
    (acc, a) => acc + a.piiFieldsMasked,
    0
  );

  const activeNodeSet = getActiveNodeIdsForState(activeSession.agentState);

  const providerName =
    llmStatus.activeProvider === 'ollama_qwen3'
      ? `Ollama (${llmStatus.configuredModel})`
      : llmStatus.activeProvider === 'gemini_cloud'
        ? `Gemini (${llmStatus.configuredModel})`
        : 'Deterministic Fallback Planner';

  const nodes: ArchNode[] = [
    {
      id: 'user',
      stepNumber: '01',
      name: 'User',
      roleSummary:
        'Uploads financial evidence, instructs the agent in natural language, clarifies variances, and approves or rejects staged mutations.',
      icon: User,
      isActiveNow: activeNodeSet.has('user'),
      hasExecuted:
        userTurns.length > 0 ||
        documents.length > 0 ||
        approvals.some((a) => Boolean(a.decidedAt)),
      liveMetric: `${userTurns.length} prompt(s) · ${documents.length} doc(s)`,
      evidenceLines: [
        `Uploaded documents in session: ${
          documents.map((d) => d.fileName).join(', ') || 'None yet'
        }`,
        `Natural-language prompts sent: ${userTurns.length}`,
        `Human approval decisions recorded: ${
          approvals.filter((a) => Boolean(a.decidedAt)).length
        }`,
      ],
    },
    {
      id: 'frontend',
      stepNumber: '02',
      name: 'Frontend',
      roleSummary:
        'Renders sanitized Markdown, live activity streams, MCP execution inspector, and auto-populated ITR-1 schedules over SSE + REST.',
      icon: Layout,
      isActiveNow: activeNodeSet.has('frontend'),
      hasExecuted: true,
      liveMetric: `Session ${activeSession.id.slice(0, 14)}`,
      evidenceLines: [
        `Bound to active session: ${activeSession.title}`,
        `Sanitized Markdown + interactive clarification actions enabled`,
        `Real-time SSE (/api/events) + workspace snapshot sync active`,
      ],
    },
    {
      id: 'orchestrator',
      stepNumber: '03',
      name: 'AI Orchestrator',
      roleSummary:
        'Maintains explicit 8-state execution machine, formulates tool plans, requests clarifications, and auto-resumes after human approvals.',
      icon: Bot,
      isActiveNow: activeNodeSet.has('orchestrator'),
      hasExecuted: aiTurns.length > 0,
      liveMetric: `State: ${activeSession.agentState}`,
      evidenceLines: [
        `Current explicit state: ${activeSession.agentState}`,
        `Orchestrator turns completed: ${aiTurns.length}`,
        `Auto-resumed post-approval turns: ${
          aiTurns.filter((t) => t.isAutoResumedTurn).length
        }`,
      ],
    },
    {
      id: 'llm-adapter',
      stepNumber: '04',
      name: 'LLM Adapter',
      roleSummary:
        'Routes PII-masked context to local Ollama (Qwen3), Gemini Cloud, or labelled Deterministic Fallback without ever computing final taxes.',
      icon: Cpu,
      isActiveNow: activeNodeSet.has('llm-adapter'),
      hasExecuted: aiTurns.length > 0,
      liveMetric: providerName,
      evidenceLines: [
        `Active runtime adapter: ${providerName}`,
        `PII masking before LLM context: ${
          snapshot.gatewayConfig.enforcePiiMaskingToLlm
            ? 'Enforced'
            : 'Disabled'
        }`,
        `Zero direct database or tax arithmetic authority granted to LLM`,
      ],
    },
    {
      id: 'mcp-client',
      stepNumber: '05',
      name: 'MCP Client',
      roleSummary:
        'Dispatches structured JSON-RPC tool invocations over Model Context Protocol InMemoryTransport with loop-prevention signatures.',
      icon: Network,
      isActiveNow: activeNodeSet.has('mcp-client'),
      hasExecuted: allTraces.length > 0,
      liveMetric: `${allTraces.length} MCP call(s)`,
      evidenceLines: [
        `Protocol transport: @modelcontextprotocol/sdk InMemoryTransport`,
        `Agent tool invocations dispatched in session: ${allTraces.length}`,
        `Bounded per-turn duplicate call guard: Active`,
      ],
    },
    {
      id: 'security-gateway',
      stepNumber: '06',
      name: 'SecurityGateway',
      roleSummary:
        'Enforces Zod schemas, path-traversal checks, per-document ACLs, PII redaction, and idempotent human-in-the-loop approval staging.',
      icon: ShieldCheck,
      isActiveNow: activeNodeSet.has('security-gateway'),
      hasExecuted: auditLogs.length > 0,
      liveMetric: `${approvals.length} gate(s) · ${totalPiiRedacted} PII masked`,
      evidenceLines: [
        `Write approval gate: ${
          snapshot.gatewayConfig.requireHumanApprovalForWrites
            ? 'Mandatory Human Approval'
            : 'Custom'
        }`,
        `Approval requests staged in session: ${approvals.length} (${
          approvals.filter((a) => a.status === 'pending').length
        } pending)`,
        `Sensitive PII fields redacted in audit payloads: ${totalPiiRedacted}`,
      ],
    },
    {
      id: 'mcp-tools',
      stepNumber: '07',
      name: 'MCP Tools (22)',
      roleSummary:
        'Executes 22 controlled tools across Document Intelligence, Financial Reconciliation, Statutory RAG, Tax Calculation, and Return Export.',
      icon: Wrench,
      isActiveNow: activeNodeSet.has('mcp-tools'),
      hasExecuted: allTraces.length > 0 || documents.length > 0,
      liveMetric: `22 registered · ${
        new Set(allTraces.map((t) => t.toolName)).size
      } used`,
      evidenceLines: [
        `Registered MCP server tools: 22 across 5 security-scoped domains`,
        `Distinct tools executed by agent in this session: ${
          Array.from(new Set(allTraces.map((t) => t.toolName))).join(', ') ||
          'None yet'
        }`,
        `Self-approval tools (approve_operation / reject_operation) restricted to human actor`,
      ],
    },
    {
      id: 'financial-ledger',
      stepNumber: '08',
      name: 'Financial Ledger',
      roleSummary:
        'Stores SQLite provenance entries strictly separating document_extracted, user_provided, and system_calculated facts (and Savings vs FD interest).',
      icon: Database,
      isActiveNow: activeNodeSet.has('financial-ledger'),
      hasExecuted: ledger.length > 0,
      liveMetric: `${ledger.length} provenance entries`,
      evidenceLines: [
        `Document-extracted facts: ${
          ledger.filter((l) => l.sourceType === 'document_extracted').length
        }`,
        `User-provided / approved facts: ${
          ledger.filter((l) => l.sourceType === 'user_provided').length
        }`,
        `System-calculated metrics: ${
          ledger.filter((l) => l.sourceType === 'system_calculated').length
        }`,
      ],
    },
    {
      id: 'tax-engine',
      stepNumber: '09',
      name: 'Deterministic Tax Engine',
      roleSummary:
        'Computes Old vs New (115BAC) slabs, Section 87A ₹12L rebate, marginal relief, 80C/80D/80TTA caps, 4% cess, and u/s 288A/288B rounding from YAML.',
      icon: Calculator,
      isActiveNow: activeNodeSet.has('tax-engine'),
      hasExecuted: activeDraft.inputs.grossSalary > 0 || taxToolCalls.length > 0,
      liveMetric: `New ${formatINR(
        activeDraft.taxSummary.newRegime.totalTaxLiability
      )} vs Old ${formatINR(
        activeDraft.taxSummary.oldRegime.totalTaxLiability
      )}`,
      evidenceLines: [
        `Rule specification: rules/AY2026-27.yaml (v${ruleVerification.rulesVersion})`,
        `New Regime Tax: ${formatINR(
          activeDraft.taxSummary.newRegime.totalTaxLiability
        )} · Old Regime Tax: ${formatINR(
          activeDraft.taxSummary.oldRegime.totalTaxLiability
        )}`,
        `Recommended Regime: ${activeDraft.taxSummary.recommendedRegime.toUpperCase()} (saves ${formatINR(
          activeDraft.taxSummary.netSavingsInRecommended
        )})`,
      ],
    },
    {
      id: 'itr1-generator',
      stepNumber: '10',
      name: 'ITR-1 Draft Generator',
      roleSummary:
        'Builds versioned local ITR-1 (Sahaj) schedules (Sections A–G) and downloadable JSON without ever submitting to an external portal.',
      icon: FileSpreadsheet,
      isActiveNow: activeNodeSet.has('itr1-generator'),
      hasExecuted: activeDraft.version > 1,
      liveMetric: `Draft v${activeDraft.version} (${activeDraft.status})`,
      evidenceLines: [
        `Active draft snapshot: Draft v${activeDraft.version} (${activeDraft.selectedRegime.toUpperCase()} Regime)`,
        `Draft lifecycle status: ${activeDraft.status}`,
        `Submission boundary: LOCAL_DRAFT_NOT_FILED (offline review & export only)`,
      ],
    },
    {
      id: 'validation-audit',
      stepNumber: '11',
      name: 'Validation & Audit Trail',
      roleSummary:
        'Verifies mandatory ITR-1 rules, halts unsupported scenarios, and maintains a tamper-evident SHA-256 hash-chained SQLite audit log.',
      icon: FileCheck2,
      isActiveNow: activeNodeSet.has('validation-audit'),
      hasExecuted: auditLogs.length > 0,
      liveMetric: `${activeDraft.validation.passCount} passed · ${auditLogs.length} hashes`,
      evidenceLines: [
        `ITR-1 validation: ${activeDraft.validation.passCount} passed, ${activeDraft.validation.warningCount} warnings, ${activeDraft.validation.errorCount} errors`,
        `SHA-256 audit hash chain integrity: ${
          auditChainValid ? 'VERIFIED INTACT' : 'WARNING'
        } (${auditLogs.length} entries)`,
        `Unsupported scope flags: ${activeSession.unsupportedScenarios.length}`,
      ],
    },
  ];

  const [selectedNodeId, setSelectedNodeId] =
    useState<string>('security-gateway');
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? nodes[0];

  return (
    <div className="space-y-6">
      {/* Architecture Header */}
      <PageHeader
        eyebrow={
          <>
            <span>11-LAYER CONTROLLED AGENTIC PIPELINE</span>
            <span aria-hidden="true">·</span>
            <span>ACTIVE STATE: {activeSession.agentState}</span>
            <span aria-hidden="true">·</span>
            <span>{events.length} REAL EXECUTION EVENTS</span>
          </>
        }
        title="System Architecture & Live Pipeline Telemetry"
        description="Clean architectural blueprint showing how TaxShield MCP isolates LLM orchestration from deterministic tax arithmetic, enforces SecurityGateway human approvals, and maintains tamper-evident audit logs."
        actions={
          <>
            <Button variant="secondary" onClick={onNavigateToMonitor}>
              Activity Monitor
            </Button>
            <Button variant="outline" onClick={onNavigateToMcpTools}>
              22 MCP Tools
            </Button>
            <Button
              variant="primary"
              onClick={onNavigateToItrForm}
              rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
            >
              ITR-1 Form Preview
            </Button>
          </>
        }
      />

      {/* Clean White Canvas 11-Node Architecture Flow Grid */}
      <SurfaceCard className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E2E8F0]">
          <div>
            <h2 className="text-sm font-semibold text-[#172B4D]">
              End-to-End Agentic Data Flow (Click any node to inspect live
              session telemetry)
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium text-[#64748B]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB]" />
              Active Stage
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0D9488]" />
              Executed in Session
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
              Standby
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {nodes.map((node, index) => {
            const Icon = node.icon;
            const isSelected = selectedNode.id === node.id;

            return (
              <button
                key={node.id}
                type="button"
                onClick={() => setSelectedNodeId(node.id)}
                className={`text-left p-5 rounded-xl transition-colors flex flex-col justify-between gap-4 cursor-pointer ${
                  isSelected
                    ? 'bg-blue-50/60 border-2 border-[#2563EB] shadow-[0_2px_8px_rgba(37,99,235,0.08)]'
                    : node.isActiveNow
                      ? 'bg-blue-50/30 border border-blue-300 hover:border-[#2563EB]'
                      : node.hasExecuted
                        ? 'bg-white border border-[#E2E8F0] hover:border-blue-300 hover:bg-[#F8FAFC]/60'
                        : 'bg-[#F8FAFC] border border-[#E2E8F0] hover:bg-white'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[11px] font-semibold text-[#64748B]">
                        {node.stepNumber}
                      </span>
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          node.isActiveNow || isSelected
                            ? 'text-[#2563EB]'
                            : node.hasExecuted
                              ? 'text-[#0D9488]'
                              : 'text-[#64748B]'
                        }`}
                      />
                      <span className="text-sm font-semibold text-[#172B4D] truncate">
                        {node.name}
                      </span>
                    </div>

                    {node.isActiveNow ? (
                      <StatusIndicator
                        tone="info"
                        label="Active"
                        hideIcon
                        mono
                      />
                    ) : node.hasExecuted ? (
                      <CheckCircle2 className="w-4 h-4 text-[#0D9488] shrink-0" />
                    ) : (
                      <span className="font-mono text-[10px] text-[#64748B]">
                        Standby
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-[#64748B] leading-relaxed">
                    {node.roleSummary}
                  </p>
                </div>

                <div className="pt-3 border-t border-[#E2E8F0] flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                  <span className="text-[#172B4D] font-medium truncate">
                    {node.liveMetric}
                  </span>
                  {index < nodes.length - 1 && (
                    <span className="text-[#2563EB] font-semibold shrink-0">
                      → {nodes[index + 1].stepNumber}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </SurfaceCard>

      {/* Selected Component Live Evidence & Recent Pipeline Trace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <SurfaceCard className="lg:col-span-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E2E8F0]">
            <div>
              <div className="text-[11px] font-mono text-[#64748B]">
                Selected Architecture Layer · Step {selectedNode.stepNumber}
              </div>
              <h2 className="text-base font-semibold text-[#172B4D] mt-0.5">
                {selectedNode.name}
              </h2>
            </div>
            <StatusIndicator
              tone="info"
              label={selectedNode.liveMetric}
              hideIcon
              mono
            />
          </div>

          <p className="text-xs text-[#64748B] leading-relaxed">
            {selectedNode.roleSummary}
          </p>

          <div className="space-y-2 pt-1">
            <div className="text-xs font-semibold text-[#172B4D]">
              Live Session Telemetry for {selectedNode.name}
            </div>
            {selectedNode.evidenceLines.map((line) => (
              <div
                key={line}
                className="px-3.5 py-2.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#172B4D] font-mono"
              >
                {line}
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard noPadding className="lg:col-span-6">
          <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#172B4D]">
              Latest Cross-Component Pipeline Events
            </h2>
            <span className="text-xs text-[#64748B] font-mono tabular-nums">
              {events.length} total
            </span>
          </div>

          <div className="divide-y divide-[#E2E8F0] max-h-[340px] overflow-y-auto bg-white">
            {[...events]
              .reverse()
              .slice(0, 8)
              .map((ev) => (
                <div key={ev.id} className="px-6 py-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#172B4D]">
                      {ev.operationName}
                    </span>
                    <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
                      {formatShortTime(ev.timestamp)}
                    </span>
                  </div>
                  <div className="text-[#64748B] mt-0.5 truncate">
                    {ev.description}
                  </div>
                </div>
              ))}
          </div>
        </SurfaceCard>
      </div>

      {/* Architectural Separation of Concerns Rationale */}
      <SurfaceCard className="bg-[#F8FAFC]">
        <h3 className="text-sm font-semibold text-[#172B4D]">
          Architectural Design Principles
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3 text-xs text-[#64748B] leading-relaxed">
          <div className="p-4 rounded-lg bg-white border border-[#E2E8F0]">
            <div className="font-semibold text-[#172B4D] mb-1">
              1. Zero LLM Tax Arithmetic
            </div>
            The AI Orchestrator plans workflows and reconciles evidence, while
            100% of slab rates, u/s 87A rebates, marginal relief, and rounding
            execute in the deterministic YAML engine.
          </div>
          <div className="p-4 rounded-lg bg-white border border-[#E2E8F0]">
            <div className="font-semibold text-[#172B4D] mb-1">
              2. Mandatory SecurityGateway
            </div>
            Sensitive MCP writes cannot mutate SQLite state directly; they stage
            idempotent approval requests and disallow agent self-approval.
          </div>
          <div className="p-4 rounded-lg bg-white border border-[#E2E8F0]">
            <div className="font-semibold text-[#172B4D] mb-1">
              3. Verifiable Provenance &amp; Auditability
            </div>
            Every ITR-1 line item links back to its source document, page, or
            statutory formula, backed by a SHA-256 hash-chained audit trail.
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
};
