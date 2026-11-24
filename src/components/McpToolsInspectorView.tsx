import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Lock,
  Search,
  ShieldAlert,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import {
  McpToolDefinition,
  McpToolName,
  WorkspaceSnapshot,
} from '../shared/types';
import { formatShortTime, redactSensitiveText } from '../utils/format';
import {
  EmptyState,
  PageHeader,
  StatusIndicator,
  SurfaceCard,
} from './DesignSystem';

interface McpToolsInspectorViewProps {
  snapshot: WorkspaceSnapshot;
}

type ToolDomain =
  | 'all'
  | 'document'
  | 'financial'
  | 'tax'
  | 'return'
  | 'security';

const SENSITIVE_APPROVAL_TOOLS = new Set<McpToolName>([
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

function getToolDomain(name: McpToolName): Exclude<ToolDomain, 'all'> {
  if (
    [
      'upload_document',
      'inspect_documents',
      'extract_document_facts',
      'get_document_details',
    ].includes(name)
  ) {
    return 'document';
  }
  if (
    [
      'get_financial_summary',
      'reconcile_documents',
      'add_income_information',
      'add_deduction_information',
      'update_return_information',
    ].includes(name)
  ) {
    return 'financial';
  }
  if (
    [
      'retrieve_tax_rules',
      'calculate_tax',
      'compare_tax_regimes',
      'validate_return',
    ].includes(name)
  ) {
    return 'tax';
  }
  if (
    [
      'inspect_return',
      'generate_return_draft',
      'export_return_json',
      'get_return_status',
    ].includes(name)
  ) {
    return 'return';
  }
  return 'security';
}

interface ToolInvocationRecord {
  id: string;
  timestamp: string;
  actor: string;
  decision: string;
  status: string;
  durationMs?: number;
  piiMaskedCount: number;
  redactedArgs: string;
  redactedResponse: string;
  approvalId?: string;
}

export const McpToolsInspectorView: React.FC<McpToolsInspectorViewProps> = ({
  snapshot,
}) => {
  const [catalog, setCatalog] = useState<McpToolDefinition[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [domainFilter, setDomainFilter] = useState<ToolDomain>('all');
  const [onlyInvoked, setOnlyInvoked] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/mcp/tools')
      .then((res) => res.json())
      .then((data) => {
        if (active && Array.isArray(data.tools)) {
          setCatalog(data.tools as McpToolDefinition[]);
        }
      })
      .finally(() => {
        if (active) setLoadingCatalog(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const recordsByTool = useMemo(() => {
    const map = new Map<McpToolName, ToolInvocationRecord[]>();

    const pushRec = (toolName: McpToolName, rec: ToolInvocationRecord) => {
      const existing = map.get(toolName) ?? [];
      existing.push(rec);
      map.set(toolName, existing);
    };

    for (const msg of snapshot.chatHistory) {
      for (const trace of msg.toolTraces ?? []) {
        pushRec(trace.toolName, {
          id: trace.id,
          timestamp: trace.timestamp || msg.timestamp,
          actor: 'ai_agent',
          decision: trace.gatewayDecision,
          status:
            trace.gatewayDecision === 'HELD_FOR_HUMAN_APPROVAL'
              ? 'held_for_approval'
              : trace.errorCode
                ? 'blocked_or_failed'
                : 'executed',
          durationMs: trace.durationMs,
          piiMaskedCount: trace.piiMaskedCount,
          redactedArgs: redactSensitiveText(trace.maskedArgsPreview || '{}'),
          redactedResponse: redactSensitiveText(
            trace.maskedResponsePreview || trace.summary
          ),
          approvalId: trace.approvalRequestId,
        });
      }
    }

    for (const audit of snapshot.auditLogs) {
      if (audit.toolName === 'document_acl_change') continue;
      const isHumanOrDecision =
        audit.actor !== 'ai_agent' ||
        audit.decision === 'APPROVED_AND_EXECUTED' ||
        audit.decision === 'REJECTED_BY_HUMAN' ||
        audit.decision === 'CANCELLED_BY_USER' ||
        audit.operation === 'initialize_session';

      if (isHumanOrDecision || (map.get(audit.toolName)?.length ?? 0) === 0) {
        pushRec(audit.toolName, {
          id: audit.id,
          timestamp: audit.timestamp,
          actor: audit.actor,
          decision: audit.decision,
          status: audit.executionStatus,
          piiMaskedCount: audit.piiFieldsMasked,
          redactedArgs: redactSensitiveText(audit.maskedPayloadPreview),
          redactedResponse: redactSensitiveText(audit.details),
          approvalId: audit.approvalRequestId,
        });
      }
    }

    for (const [k, list] of map.entries()) {
      list.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      map.set(k, list);
    }

    return map;
  }, [snapshot.chatHistory, snapshot.auditLogs]);

  const invokedToolsCount = useMemo(() => {
    let count = 0;
    for (const t of catalog) {
      if ((recordsByTool.get(t.name)?.length ?? 0) > 0) count++;
    }
    return count;
  }, [catalog, recordsByTool]);

  const filteredTools = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.filter((tool) => {
      const domain = getToolDomain(tool.name);
      if (domainFilter !== 'all' && domain !== domainFilter) return false;
      const recs = recordsByTool.get(tool.name) ?? [];
      if (onlyInvoked && recs.length === 0) return false;
      if (!q) return true;
      return (
        tool.name.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q)
      );
    });
  }, [catalog, domainFilter, onlyInvoked, search, recordsByTool]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow={
          <>
            <span>{catalog.length || 22} REGISTERED MCP TOOLS</span>
            <span aria-hidden="true">·</span>
            <span>{invokedToolsCount} INVOKED IN ACTIVE SESSION</span>
            <span aria-hidden="true">·</span>
            <span>STRICT PII REDACTION ACTIVE</span>
          </>
        }
        title="MCP Tool Catalog & SecurityGateway Inspector"
        description="Inspect all 22 controlled Model Context Protocol tools across Document, Financial, Tax, Return, and Security domains, alongside JSON schemas, approval policies, and redacted session execution payloads."
        actions={
          <div className="px-3.5 py-2 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] flex items-center gap-2 text-xs text-[#172B4D]">
            <Lock className="w-3.5 h-3.5 text-[#0D9488] shrink-0" />
            <span>Raw PAN, bank accounts &amp; secrets redacted</span>
          </div>
        }
        footer={
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ['all', `All (${catalog.length || 22})`],
                  ['document', 'Document (4)'],
                  ['financial', 'Financial (5)'],
                  ['tax', 'Tax Engine (4)'],
                  ['return', 'ITR-1 Return (4)'],
                  ['security', 'Security (5)'],
                ] as const
              ).map(([key, label]) => {
                const active = domainFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDomainFilter(key)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                      active
                        ? 'bg-blue-50 text-[#2563EB] border-blue-200 font-semibold'
                        : 'bg-white text-[#64748B] border-[#E2E8F0] hover:text-[#172B4D] hover:bg-[#F8FAFC]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}

              <label className="ml-2 inline-flex items-center gap-1.5 text-xs text-[#172B4D] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={onlyInvoked}
                  onChange={(e) => setOnlyInvoked(e.target.checked)}
                  className="rounded border-[#E2E8F0] text-[#2563EB]"
                />
                <span>Invoked in session only ({invokedToolsCount})</span>
              </label>
            </div>

            <div className="relative w-full lg:w-72 shrink-0">
              <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search 22 MCP tools..."
                className="w-full pl-8 pr-3 py-1.5 text-xs text-[#172B4D] bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>
        }
      />

      {/* Tool List & Expandable Execution Inspector */}
      {loadingCatalog ? (
        <div className="space-y-3">
          <div className="h-20 bg-white border border-[#E2E8F0] rounded-xl animate-pulse" />
          <div className="h-20 bg-white border border-[#E2E8F0] rounded-xl animate-pulse" />
          <div className="h-20 bg-white border border-[#E2E8F0] rounded-xl animate-pulse" />
        </div>
      ) : (
        <SurfaceCard noPadding>
          {filteredTools.length === 0 ? (
            <EmptyState
              icon={<Wrench className="w-5 h-5" />}
              title="No MCP tools match the current filter"
              description="Clear the search input or domain filter above to inspect all 22 registered tools."
            />
          ) : (
            <div className="divide-y divide-[#E2E8F0]">
              {filteredTools.map((tool) => {
                const records = recordsByTool.get(tool.name) ?? [];
                const invoked = records.length > 0;
                const latest = records[0];
                const isExpanded = expandedTool === tool.name;
                const requiresApproval = SENSITIVE_APPROVAL_TOOLS.has(
                  tool.name
                );
                const humanOnly = HUMAN_ONLY_TOOLS.has(tool.name);
                const domain = getToolDomain(tool.name);
                const schemaProps = Object.keys(
                  tool.inputSchema?.properties ?? {}
                );

                return (
                  <div
                    key={tool.name}
                    className={invoked ? 'bg-blue-50/20' : 'bg-white'}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedTool(isExpanded ? null : tool.name)
                      }
                      className="w-full text-left p-5 hover:bg-[#F8FAFC]/80 transition-colors flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 cursor-pointer"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="mt-0.5">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-[#2563EB]" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-[#64748B]" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <Wrench className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />
                            <span className="font-mono font-semibold text-[#172B4D]">
                              {tool.name}
                            </span>
                            <span className="uppercase tracking-wider text-[10px] font-semibold px-2 py-0.5 rounded bg-[#F8FAFC] border border-[#E2E8F0] text-[#64748B]">
                              {domain}
                            </span>
                            {humanOnly ? (
                              <StatusIndicator
                                tone="error"
                                label="Human-Only Gate"
                                hideIcon
                              />
                            ) : requiresApproval ? (
                              <StatusIndicator
                                tone="warning"
                                label="Requires Human Approval"
                                hideIcon
                              />
                            ) : (
                              <StatusIndicator
                                tone="neutral"
                                label="Controlled Read / Deterministic"
                                hideIcon
                              />
                            )}
                          </div>

                          <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
                            {tool.description}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0 pl-7 lg:pl-0 text-xs font-mono tabular-nums">
                        {invoked ? (
                          <div className="text-right">
                            <div className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                              <span>Invoked {records.length}x</span>
                            </div>
                            {latest && (
                              <div className="text-[11px] text-[#64748B] mt-0.5">
                                {latest.decision} ·{' '}
                                {formatShortTime(latest.timestamp)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-[#64748B]">
                            Not invoked in session
                          </span>
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-6 pb-5 pt-1 ml-7 space-y-4 text-xs">
                        {/* Schema & Security Policy Summary */}
                        <div className="p-4 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <div className="text-[11px] text-[#64748B]">
                              Input Parameters
                            </div>
                            <div className="font-mono text-[#172B4D] mt-0.5">
                              {schemaProps.length > 0
                                ? schemaProps.join(', ')
                                : 'None (Session-scoped)'}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-[#64748B]">
                              Approval Policy
                            </div>
                            <div className="font-medium text-[#172B4D] mt-0.5 flex items-center gap-1.5">
                              {humanOnly ? (
                                <>
                                  <ShieldAlert className="w-3.5 h-3.5 text-rose-700" />
                                  <span>Agent self-invocation blocked</span>
                                </>
                              ) : requiresApproval ? (
                                <>
                                  <ShieldAlert className="w-3.5 h-3.5 text-amber-700" />
                                  <span>
                                    Held at SecurityGateway until approved
                                  </span>
                                </>
                              ) : (
                                <>
                                  <ShieldCheck className="w-3.5 h-3.5 text-[#0D9488]" />
                                  <span>Schema + ACL verified execution</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-[#64748B]">
                              Session Invocations
                            </div>
                            <div className="font-mono tabular-nums text-[#172B4D] font-semibold mt-0.5">
                              {records.length} execution record(s)
                            </div>
                          </div>
                        </div>

                        {/* Real Execution Records for This Tool */}
                        {records.length === 0 ? (
                          <div className="p-4 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-[#64748B]">
                            This MCP tool has not been invoked during the
                            current active filing session yet.
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            <div className="font-semibold text-[#172B4D]">
                              Session Execution History (PII Redacted)
                            </div>
                            {records.map((rec) => (
                              <div
                                key={rec.id}
                                className="p-4 rounded-lg border border-[#E2E8F0] bg-white space-y-2.5 font-mono"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-semibold text-[#2563EB]">
                                      {rec.decision}
                                    </span>
                                    <span
                                      aria-hidden="true"
                                      className="text-[#E2E8F0]"
                                    >
                                      ·
                                    </span>
                                    <span className="text-[#64748B]">
                                      Actor: {rec.actor}
                                    </span>
                                    {rec.piiMaskedCount > 0 && (
                                      <>
                                        <span
                                          aria-hidden="true"
                                          className="text-[#E2E8F0]"
                                        >
                                          ·
                                        </span>
                                        <span className="text-[#0D9488] font-medium">
                                          {rec.piiMaskedCount} PII field(s)
                                          masked
                                        </span>
                                      </>
                                    )}
                                    {rec.approvalId && (
                                      <>
                                        <span
                                          aria-hidden="true"
                                          className="text-[#E2E8F0]"
                                        >
                                          ·
                                        </span>
                                        <span className="text-amber-800">
                                          Approval: {rec.approvalId}
                                        </span>
                                      </>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2 text-[#64748B] tabular-nums">
                                    {typeof rec.durationMs === 'number' && (
                                      <span className="inline-flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {rec.durationMs} ms
                                      </span>
                                    )}
                                    <span>
                                      {formatShortTime(rec.timestamp)}
                                    </span>
                                  </div>
                                </div>

                                <div className="p-2.5 rounded bg-[#F8FAFC] border border-[#E2E8F0]">
                                  <div className="font-sans text-[11px] text-[#64748B]">
                                    Arguments (Redacted)
                                  </div>
                                  <div className="text-[#172B4D] text-[11.5px] break-all mt-0.5">
                                    {rec.redactedArgs}
                                  </div>
                                </div>

                                <div className="p-2.5 rounded bg-[#F8FAFC] border border-[#E2E8F0]">
                                  <div className="font-sans text-[11px] text-[#64748B]">
                                    Gateway / Tool Response (Redacted)
                                  </div>
                                  <div className="text-[#172B4D] text-[11.5px] break-all mt-0.5">
                                    {rec.redactedResponse}
                                  </div>
                                </div>
                              </div>
                            ))}
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
      )}
    </div>
  );
};
