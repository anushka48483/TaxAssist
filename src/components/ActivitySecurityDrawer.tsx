import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Lock,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  McpToolDefinition,
  SecurityAuditEntry,
  SecurityGatewayConfig,
  WorkspaceSnapshot,
} from '../shared/types';
import { formatDateTime } from '../utils/format';
import { Button, LightCodeBlock, SegmentedControl } from './DesignSystem';

interface ActivitySecurityDrawerProps {
  open: boolean;
  onClose: () => void;
  snapshot: WorkspaceSnapshot;
  onUpdateGatewayConfig: (partial: Partial<SecurityGatewayConfig>) => Promise<void>;
  onTestPiiMasking: (
    text: string
  ) => Promise<{ maskedText: string; maskedCount: number }>;
  onDownloadAuditBundle: () => void;
}

type DrawerTab = 'audit' | 'permissions' | 'traces';

const WRITE_TOOLS = new Set([
  'upload_document',
  'add_income_information',
  'add_deduction_information',
  'update_return_information',
  'generate_return_draft',
  'request_user_approval',
  'approve_operation',
  'reject_operation',
]);

export const ActivitySecurityDrawer: React.FC<ActivitySecurityDrawerProps> = ({
  open,
  onClose,
  snapshot,
  onUpdateGatewayConfig,
  onTestPiiMasking,
  onDownloadAuditBundle,
}) => {
  const [tab, setTab] = useState<DrawerTab>('audit');
  const [auditFilter, setAuditFilter] = useState<'all' | 'executed' | 'held' | 'blocked'>('all');
  const [selectedAuditId, setSelectedAuditId] = useState<string>(
    snapshot.auditLogs[0]?.id ?? ''
  );
  const [tools, setTools] = useState<McpToolDefinition[]>([]);
  const [updatingConfig, setUpdatingConfig] = useState(false);

  const [samplePii, setSamplePii] = useState(
    'PAN SYNTP1234K, Account 409988112233, Phone 9876543210'
  );
  const [maskedPreview, setMaskedPreview] = useState(
    'PAN SYNTP****K, Account XXXXXXXX2233, Phone XXXXXX3210'
  );
  const [maskedCount, setMaskedCount] = useState(3);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || tools.length > 0) return;
    fetch('/api/mcp/tools')
      .then((r) => r.json())
      .then((d) => setTools((d.tools ?? []) as McpToolDefinition[]))
      .catch(() => {});
  }, [open, tools.length]);

  if (!open) return null;

  const { auditLogs, auditChainValid, gatewayConfig, chatHistory, liveEvents = [] } = snapshot;

  const filteredLogs = auditLogs.filter((entry) => {
    if (auditFilter === 'executed') return entry.executionStatus === 'executed';
    if (auditFilter === 'held') return entry.executionStatus === 'held_for_approval';
    if (auditFilter === 'blocked') {
      return ['blocked', 'rejected', 'cancelled', 'failed'].includes(entry.executionStatus);
    }
    return true;
  });

  const selectedAudit: SecurityAuditEntry | null =
    filteredLogs.find((l) => l.id === selectedAuditId) || filteredLogs[0] || null;

  const allTraces = chatHistory.flatMap((m) => m.toolTraces ?? []);
  const allCitations = Array.from(
    new Map(
      chatHistory
        .flatMap((m) => m.citations ?? [])
        .map((c) => [c.id, c])
    ).values()
  );

  const handleToggleConfig = async (
    key: keyof SecurityGatewayConfig,
    value: boolean
  ) => {
    setUpdatingConfig(true);
    try {
      await onUpdateGatewayConfig({ [key]: value });
    } finally {
      setUpdatingConfig(false);
    }
  };

  const handleTestPii = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await onTestPiiMasking(samplePii);
    setMaskedPreview(res.maskedText);
    setMaskedCount(res.maskedCount);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Activity and Security"
      className="fixed inset-0 z-50 flex justify-end"
    >
      <div className="fixed inset-0 bg-[#172B4D]/25" onClick={onClose} />

      <div className="relative z-10 w-full max-w-2xl bg-white border-l border-[#E2E8F0] shadow-2xl h-full flex flex-col">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between gap-4 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-[#172B4D]">
              Activity &amp; Security
            </h2>
            <p className="text-xs text-[#64748B] mt-0.5">
              Tamper-evident audit log, privacy controls, and rule checks for this session
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<Download className="w-3.5 h-3.5" />}
              onClick={onDownloadAuditBundle}
            >
              Export Log
            </Button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Activity and Security"
              className="p-1.5 text-[#64748B] hover:text-[#172B4D] rounded-lg hover:bg-[#F8FAFC] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="px-6 py-3 border-b border-[#E2E8F0] bg-[#F8FAFC] shrink-0 flex items-center justify-between gap-3 flex-wrap">
          <SegmentedControl
            ariaLabel="Activity and Security sections"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'audit', label: `Audit Trail (${auditLogs.length})` },
              { value: 'permissions', label: 'Permissions & Privacy' },
              { value: 'traces', label: 'Agent & Rule Logs' },
            ]}
          />

          <div
            className={`text-[11px] font-medium inline-flex items-center gap-1.5 ${
              auditChainValid ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {auditChainValid ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Hash chain intact</span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Chain warning</span>
              </>
            )}
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {tab === 'audit' && (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <SegmentedControl
                  ariaLabel="Filter audit events"
                  value={auditFilter}
                  onChange={setAuditFilter}
                  options={[
                    { value: 'all', label: `All (${auditLogs.length})` },
                    {
                      value: 'executed',
                      label: `Executed (${auditLogs.filter((l) => l.executionStatus === 'executed').length})`,
                    },
                    {
                      value: 'held',
                      label: `Pending (${auditLogs.filter((l) => l.executionStatus === 'held_for_approval').length})`,
                    },
                    {
                      value: 'blocked',
                      label: `Blocked (${
                        auditLogs.filter((l) =>
                          ['blocked', 'rejected', 'cancelled', 'failed'].includes(l.executionStatus)
                        ).length
                      })`,
                    },
                  ]}
                />
                <span className="text-[11px] text-[#64748B] font-mono tabular-nums">
                  Zero raw PII stored
                </span>
              </div>

              <div className="border border-[#E2E8F0] rounded-xl divide-y divide-[#E2E8F0] overflow-hidden">
                {filteredLogs.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#64748B]">
                    No matching activity records yet.
                  </div>
                ) : (
                  filteredLogs.slice(0, 40).map((entry) => {
                    const isSelected = selectedAudit?.id === entry.id;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setSelectedAuditId(entry.id)}
                        className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                          isSelected ? 'bg-[#F8FAFC]' : 'bg-white hover:bg-[#F8FAFC]/60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-[#172B4D]">
                              {entry.details}
                            </div>
                            <div className="text-[11px] text-[#64748B] mt-1 font-mono tabular-nums">
                              {formatDateTime(entry.timestamp)} · {entry.toolName} · {entry.actor}
                            </div>
                          </div>
                          <span
                            className={`text-[11px] font-medium shrink-0 ${
                              entry.executionStatus === 'executed'
                                ? 'text-emerald-700'
                                : entry.executionStatus === 'held_for_approval'
                                  ? 'text-amber-700'
                                  : 'text-rose-700'
                            }`}
                          >
                            {entry.executionStatus === 'executed'
                              ? 'Completed'
                              : entry.executionStatus === 'held_for_approval'
                                ? 'Pending Approval'
                                : 'Blocked'}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {selectedAudit && (
                <div className="space-y-2 pt-1">
                  <div className="text-xs font-semibold text-[#172B4D]">
                    Selected Record Integrity &amp; Masked Payload
                  </div>
                  <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-[11px] font-mono text-[#64748B] space-y-1 break-all">
                    <div>Decision: {selectedAudit.decision}</div>
                    <div>Prev Hash: {selectedAudit.previousHash}</div>
                    <div>Hash: {selectedAudit.integrityHash}</div>
                    <div>PII Fields Redacted: {selectedAudit.piiFieldsMasked}</div>
                  </div>
                  <LightCodeBlock
                    title="Redacted Payload Preview"
                    maxHeightClass="max-h-40"
                    code={selectedAudit.maskedPayloadPreview}
                  />
                </div>
              )}
            </>
          )}

          {tab === 'permissions' && (
            <>
              <div className="border border-[#E2E8F0] rounded-xl divide-y divide-[#E2E8F0]">
                {[
                  {
                    key: 'requireHumanApprovalForWrites' as const,
                    title: 'Require approval before saving changes',
                    desc: 'Holds sensitive return writes and final draft generation until you confirm.',
                    value: gatewayConfig.requireHumanApprovalForWrites,
                  },
                  {
                    key: 'enforcePiiMaskingToLlm' as const,
                    title: 'Mask PAN, Aadhaar, phone, and bank numbers before AI processing',
                    desc: 'Automatically redacts personal identifiers before any assistant prompt leaves your workspace.',
                    value: gatewayConfig.enforcePiiMaskingToLlm,
                  },
                  {
                    key: 'enforceDocumentAcl' as const,
                    title: 'Respect document access controls',
                    desc: 'Prevents reading documents marked as restricted from assistant analysis.',
                    value: gatewayConfig.enforceDocumentAcl,
                  },
                ].map((item) => (
                  <label
                    key={item.key}
                    className="px-4 py-3.5 flex items-start justify-between gap-4 cursor-pointer hover:bg-[#F8FAFC]/60"
                  >
                    <div>
                      <div className="text-xs font-semibold text-[#172B4D]">
                        {item.title}
                      </div>
                      <div className="text-[11px] text-[#64748B] mt-0.5 leading-relaxed">
                        {item.desc}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      disabled={updatingConfig}
                      checked={item.value}
                      onChange={(e) => handleToggleConfig(item.key, e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-[#CBD5E1] text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
                    />
                  </label>
                ))}
              </div>

              {/* PII Redaction Verifier */}
              <div className="border border-[#E2E8F0] rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#2563EB]" />
                  <h3 className="text-xs font-semibold text-[#172B4D]">
                    Test Automatic Privacy Masking
                  </h3>
                </div>
                <form onSubmit={handleTestPii} className="space-y-2.5">
                  <input
                    type="text"
                    value={samplePii}
                    onChange={(e) => setSamplePii(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-[#E2E8F0] rounded-lg bg-[#F8FAFC] focus:bg-white focus:outline-none focus:border-[#2563EB]"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[#64748B]">
                      Fields redacted: <strong className="text-[#172B4D]">{maskedCount}</strong>
                    </span>
                    <Button type="submit" variant="secondary" size="sm">
                      Run Masking Check
                    </Button>
                  </div>
                </form>
                <div className="p-2.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-mono text-[#172B4D] break-all">
                  {maskedPreview}
                </div>
              </div>

              {/* Compact 22 MCP Tool Permissions Catalog */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[#172B4D]">
                    MCP Tool Permissions ({tools.length || 22} Registered)
                  </h3>
                  <span className="text-[11px] text-[#64748B]">
                    Read-only runs automatically · Writes require confirmation
                  </span>
                </div>
                <div className="border border-[#E2E8F0] rounded-xl divide-y divide-[#E2E8F0]">
                  {tools.map((tool) => {
                    const isWrite = WRITE_TOOLS.has(tool.name);
                    return (
                      <div
                        key={tool.name}
                        className="px-4 py-2.5 flex items-start justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-mono font-medium text-[#172B4D]">
                            {tool.name}
                          </div>
                          <div className="text-[11px] text-[#64748B] mt-0.5 line-clamp-2">
                            {tool.description}
                          </div>
                        </div>
                        <span
                          className={`text-[11px] font-medium whitespace-nowrap shrink-0 ${
                            isWrite ? 'text-amber-700' : 'text-[#0D9488]'
                          }`}
                        >
                          {isWrite ? 'Approval Required' : 'Read / Safe'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {tab === 'traces' && (
            <>
              {allCitations.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-[#172B4D]">
                    Tax Rules Retrieved in This Session ({allCitations.length})
                  </h3>
                  <div className="border border-[#E2E8F0] rounded-xl divide-y divide-[#E2E8F0]">
                    {allCitations.map((c) => (
                      <div key={c.id} className="px-4 py-3 text-xs space-y-1">
                        <div className="font-semibold text-[#172B4D]">
                          {c.section} · {c.title}
                        </div>
                        <div className="text-[11px] text-[#64748B] leading-relaxed">
                          {c.summary}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-[#172B4D]">
                  Recent Document &amp; Assistant Operations ({liveEvents.length + allTraces.length})
                </h3>
                <div className="border border-[#E2E8F0] rounded-xl divide-y divide-[#E2E8F0]">
                  {liveEvents.length === 0 && allTraces.length === 0 ? (
                    <div className="p-6 text-center text-xs text-[#64748B]">
                      No operations logged yet in this session.
                    </div>
                  ) : (
                    <>
                      {liveEvents
                        .slice(-25)
                        .reverse()
                        .map((ev) => (
                          <div
                            key={ev.eventId}
                            className="px-4 py-2.5 flex items-start justify-between gap-3 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-[#172B4D]">{ev.title}</div>
                              <div className="text-[11px] text-[#64748B] mt-0.5">
                                {ev.message}
                              </div>
                            </div>
                            <span className="text-[11px] font-mono tabular-nums text-[#64748B] shrink-0">
                              {formatDateTime(ev.timestamp)}
                            </span>
                          </div>
                        ))}
                      {allTraces
                        .slice(-15)
                        .reverse()
                        .map((trace) => (
                          <div
                            key={trace.id}
                            className="px-4 py-2.5 flex items-start justify-between gap-3 text-xs bg-[#F8FAFC]/50"
                          >
                            <div className="min-w-0">
                              <div className="font-mono font-medium text-[#172B4D]">
                                {trace.toolName}
                              </div>
                              <div className="text-[11px] text-[#64748B] mt-0.5">
                                {trace.summary}
                              </div>
                            </div>
                            <span className="text-[11px] font-mono tabular-nums text-[#64748B] shrink-0">
                              {trace.durationMs}ms
                            </span>
                          </div>
                        ))}
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-3 border-t border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between text-[11px] text-[#64748B] shrink-0">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#0D9488]" />
            <span>Session {snapshot.activeSessionId}</span>
          </span>
          <span>Draft v{snapshot.activeDraft.version}</span>
        </div>
      </div>
    </div>
  );
};
