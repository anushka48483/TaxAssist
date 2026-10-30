import React, { useState } from 'react';
import { CheckCircle2, Lock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { SecurityAuditEntry, WorkspaceSnapshot } from '../shared/types';
import { formatDateTime } from '../utils/format';
import {
  Button,
  EmptyState,
  LightCodeBlock,
  PageHeader,
  SegmentedControl,
  SemanticTone,
  StatusIndicator,
  SurfaceCard,
} from './DesignSystem';

interface AuditTrailViewProps {
  snapshot: WorkspaceSnapshot;
  onTestPiiMasking: (
    text: string
  ) => Promise<{ maskedText: string; maskedCount: number }>;
}

function getAuditStatusTone(
  status: SecurityAuditEntry['executionStatus']
): SemanticTone {
  if (status === 'executed') return 'success';
  if (status === 'held_for_approval') return 'warning';
  return 'error';
}

export const AuditTrailView: React.FC<AuditTrailViewProps> = ({
  snapshot,
  onTestPiiMasking,
}) => {
  const { auditLogs, auditChainValid } = snapshot;

  const [filter, setFilter] = useState<
    'all' | 'executed' | 'held' | 'blocked'
  >('all');
  const [selectedLogId, setSelectedLogId] = useState<string>(
    auditLogs[0]?.id ?? ''
  );

  const [sampleInput, setSampleInput] = useState(
    'PAN SYNTP1234K, TAN BLRA99120F, Account 409988112233, Phone 9876543210, Email rohan.synthetic@example.in'
  );
  const [maskedResult, setMaskedResult] = useState(
    'PAN SYNTP****K, TAN BLRA9****F, Account XXXXXXXX2233, Phone XXXXXX3210, Email ro***@example.in'
  );
  const [maskedCount, setMaskedCount] = useState(5);

  const filteredLogs = auditLogs.filter((entry) => {
    if (filter === 'executed') return entry.executionStatus === 'executed';
    if (filter === 'held') return entry.executionStatus === 'held_for_approval';
    if (filter === 'blocked') {
      return (
        entry.executionStatus === 'blocked' ||
        entry.executionStatus === 'rejected' ||
        entry.executionStatus === 'cancelled' ||
        entry.executionStatus === 'failed'
      );
    }
    return true;
  });

  const activeEntry: SecurityAuditEntry | null =
    filteredLogs.find((l) => l.id === selectedLogId) || filteredLogs[0] || null;

  const totalPiiRedacted = auditLogs.reduce(
    (acc, l) => acc + l.piiFieldsMasked,
    0
  );

  const handleRunRedactionCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await onTestPiiMasking(sampleInput);
    setMaskedResult(res.maskedText);
    setMaskedCount(res.maskedCount);
  };

  return (
    <div className="space-y-6">
      {/* Cryptographic Hash-Chain & PII Redaction Status Header */}
      <PageHeader
        eyebrow={
          <>
            <span>SHA-256 HASH-CHAINED LEDGER</span>
            <span aria-hidden="true">·</span>
            <span>ZERO RAW PII IN LOGS</span>
            <span aria-hidden="true">·</span>
            <span>{totalPiiRedacted} SENSITIVE FIELDS REDACTED</span>
          </>
        }
        title="SecurityGateway Audit Trail & Tamper-Evident Chain"
        description="Every MCP tool invocation, SecurityGateway decision, and human approval is recorded in an append-only SHA-256 hash chain with automatic PII scrubbing."
        actions={
          <div
            className={`px-4 py-2 rounded-lg border text-xs font-semibold flex items-center gap-2 shrink-0 ${
              auditChainValid
                ? 'bg-emerald-50/90 border-emerald-200 text-emerald-800'
                : 'bg-rose-50/90 border-rose-200 text-rose-800'
            }`}
          >
            {auditChainValid ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Hash Chain Verified ({auditLogs.length} Links Intact)</span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0" />
                <span>Hash Chain Integrity Warning</span>
              </>
            )}
          </div>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              ariaLabel="Filter audit trail entries"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `All Events (${auditLogs.length})` },
                {
                  value: 'executed',
                  label: `Executed (${
                    auditLogs.filter((l) => l.executionStatus === 'executed')
                      .length
                  })`,
                },
                {
                  value: 'held',
                  label: `Held for Approval (${
                    auditLogs.filter(
                      (l) => l.executionStatus === 'held_for_approval'
                    ).length
                  })`,
                },
                {
                  value: 'blocked',
                  label: `Blocked / Rejected (${
                    auditLogs.filter((l) =>
                      ['blocked', 'rejected', 'cancelled', 'failed'].includes(
                        l.executionStatus
                      )
                    ).length
                  })`,
                },
              ]}
            />

            <div className="text-xs text-[#64748B] font-mono tabular-nums">
              Active Session: {snapshot.activeSessionId}
            </div>
          </div>
        }
      />

      {/* Split Audit Log Table & Entry Cryptographic Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <SurfaceCard noPadding className="lg:col-span-7">
          <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#172B4D]">
              Chronological Gateway Audit Table ({filteredLogs.length})
            </h2>
            <span className="text-xs text-[#64748B]">
              Select any row to inspect SHA-256 link &amp; redacted payload
            </span>
          </div>

          {filteredLogs.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="w-5 h-5" />}
              title="No audit events match this filter"
              description="Switch to All Events above to view the full hash-chained ledger."
            />
          ) : (
            <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Actor</th>
                    <th className="py-3 px-4">Tool &amp; Operation</th>
                    <th className="py-3 px-4">Approval / Status</th>
                    <th className="py-3 px-4">SHA-256 Hash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] bg-white">
                  {filteredLogs.map((entry) => {
                    const isSelected = activeEntry?.id === entry.id;
                    return (
                      <tr
                        key={entry.id}
                        onClick={() => setSelectedLogId(entry.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-50/60'
                            : 'bg-white hover:bg-[#F8FAFC]'
                        }`}
                      >
                        <td className="py-3 px-4 font-mono tabular-nums text-[11px] text-[#64748B] whitespace-nowrap">
                          {formatDateTime(entry.timestamp)}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-[#172B4D] whitespace-nowrap">
                          {entry.actor}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-mono font-semibold text-[#172B4D]">
                            {entry.toolName}
                          </div>
                          <div className="text-[11px] text-[#64748B] truncate max-w-[220px]">
                            {entry.operation}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <StatusIndicator
                            tone={getAuditStatusTone(entry.executionStatus)}
                            label={entry.decision}
                            mono
                          />
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-[#2563EB] whitespace-nowrap">
                          {entry.integrityHash.slice(0, 12)}…
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SurfaceCard>

        {/* Right 5 Columns: Entry Hash Inspector + Live Redaction Tester */}
        <div className="lg:col-span-5 space-y-6">
          <SurfaceCard className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#2563EB]" />
                <h2 className="text-sm font-semibold text-[#172B4D]">
                  Redacted Event &amp; Hash-Chain Inspector
                </h2>
              </div>
              {activeEntry && (
                <span className="text-[11px] font-mono text-[#64748B]">
                  {activeEntry.id}
                </span>
              )}
            </div>

            {!activeEntry ? (
              <p className="text-xs text-[#64748B]">
                Select an audit entry on the left to inspect its cryptographic
                chain.
              </p>
            ) : (
              <div className="space-y-3.5 text-xs">
                <p className="text-[#64748B] leading-relaxed">
                  {activeEntry.details}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] font-mono tabular-nums">
                  <div>
                    <div className="font-sans text-[11px] text-[#64748B]">
                      Tool / Operation
                    </div>
                    <div className="text-[#172B4D] font-semibold mt-0.5 break-all">
                      {activeEntry.toolName} ({activeEntry.operation})
                    </div>
                  </div>
                  <div>
                    <div className="font-sans text-[11px] text-[#64748B]">
                      Execution Status
                    </div>
                    <div className="text-[#172B4D] font-semibold mt-0.5">
                      {activeEntry.executionStatus} ({activeEntry.piiFieldsMasked}{' '}
                      PII masked)
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="font-sans text-[11px] text-[#64748B]">
                      Previous Link SHA-256 Hash
                    </div>
                    <div className="text-[#64748B] text-[11px] mt-0.5 break-all">
                      {activeEntry.previousHash}
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="font-sans text-[11px] text-[#64748B]">
                      Entry Integrity SHA-256 Hash
                    </div>
                    <div className="text-[#2563EB] font-semibold text-[11px] mt-0.5 break-all">
                      {activeEntry.integrityHash}
                    </div>
                  </div>
                </div>

                {activeEntry.approvalRequestId && (
                  <div className="text-xs font-mono text-[#172B4D] bg-blue-50/70 border border-blue-200 rounded-lg px-3.5 py-2">
                    Linked Approval Request ID: {activeEntry.approvalRequestId}
                  </div>
                )}

                <LightCodeBlock
                  title="PII-Redacted Arguments Preview"
                  code={activeEntry.maskedPayloadPreview}
                  maxHeightClass="max-h-[240px]"
                />
              </div>
            )}
          </SurfaceCard>

          <SurfaceCard className="space-y-3">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#0D9488]" />
              <h2 className="text-sm font-semibold text-[#172B4D]">
                PII Redaction Gate Verifier
              </h2>
            </div>
            <p className="text-xs text-[#64748B]">
              Verify how PAN, TAN, bank account numbers, phone numbers, and
              emails are scrubbed before any audit write or external LLM call.
            </p>
            <form onSubmit={handleRunRedactionCheck} className="space-y-3 text-xs">
              <textarea
                rows={3}
                value={sampleInput}
                onChange={(e) => setSampleInput(e.target.value)}
                className="w-full p-2.5 font-mono text-xs text-[#172B4D] bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB]"
              />
              <Button type="submit" variant="primary" className="w-full">
                Run Redaction Filter ({maskedCount} PII tokens scrubbed)
              </Button>
            </form>
            <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] font-mono text-xs text-[#172B4D] break-words">
              {maskedResult}
            </div>
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
};
