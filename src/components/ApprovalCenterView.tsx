import React, { useState } from 'react';
import {
  Ban,
  Check,
  Lock,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  ApprovalRequest,
  SecurityGatewayConfig,
  WorkspaceSnapshot,
} from '../shared/types';
import { formatDateTime, formatINR } from '../utils/format';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  SegmentedControl,
  StatusIndicator,
  SurfaceCard,
} from './DesignSystem';

interface ApprovalCenterViewProps {
  snapshot: WorkspaceSnapshot;
  onResolveApproval: (
    approvalId: string,
    action: 'approve' | 'reject' | 'cancel',
    decisionNote?: string
  ) => Promise<void>;
  onUpdateGatewayConfig: (
    partial: Partial<SecurityGatewayConfig>
  ) => Promise<void>;
  onTestPiiMasking: (
    text: string
  ) => Promise<{ maskedText: string; maskedCount: number }>;
}

export const ApprovalCenterView: React.FC<ApprovalCenterViewProps> = ({
  snapshot,
  onResolveApproval,
  onUpdateGatewayConfig,
  onTestPiiMasking,
}) => {
  const { approvals, gatewayConfig } = snapshot;

  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [stagedDecision, setStagedDecision] = useState<{
    req: ApprovalRequest;
    action: 'approve' | 'reject' | 'cancel';
  } | null>(null);
  const [decisionNote, setDecisionNote] = useState('');

  const [piiSampleInput, setPiiSampleInput] = useState(
    'Employee PAN SYNTP1234K, Employer TAN BLRA99120F, SBI Account 409988112233, Email rohan.synthetic@example.in'
  );
  const [piiMaskedOutput, setPiiMaskedOutput] = useState<string>(
    'Employee PAN SYNTP****K, Employer TAN BLRA9****F, SBI Account XXXXXXXX2233, Email ro***@example.in'
  );
  const [piiCount, setPiiCount] = useState<number>(4);

  const pendingList = approvals.filter((a) => a.status === 'pending');
  const historyList = approvals.filter((a) => a.status !== 'pending');

  const openConfirmDecision = (
    req: ApprovalRequest,
    action: 'approve' | 'reject' | 'cancel'
  ) => {
    setDecisionNote('');
    setStagedDecision({ req, action });
  };

  const handleConfirmDecision = async () => {
    if (!stagedDecision) return;
    setResolvingId(stagedDecision.req.id);
    setErrorMsg(null);
    try {
      await onResolveApproval(
        stagedDecision.req.id,
        stagedDecision.action,
        decisionNote.trim() || undefined
      );
      setStagedDecision(null);
      setDecisionNote('');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to resolve approval.'
      );
    } finally {
      setResolvingId(null);
    }
  };

  const handleRunMaskTest = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await onTestPiiMasking(piiSampleInput);
    setPiiMaskedOutput(res.maskedText);
    setPiiCount(res.maskedCount);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow={
          <>
            <span>SECURITYGATEWAY AUTHORIZATION QUEUE</span>
            <span aria-hidden="true">·</span>
            <span>{pendingList.length} PENDING</span>
            <span aria-hidden="true">·</span>
            <span>IDEMPOTENT EXECUTION</span>
          </>
        }
        title="Human-in-the-Loop Approval Center"
        description="Every sensitive financial write or ITR-1 snapshot generation is paused at SecurityGateway. Approving executes the staged MCP mutation once and automatically resumes the AI orchestrator; Rejecting or Cancelling leaves the return unchanged."
        actions={
          <SegmentedControl
            ariaLabel="Approval queue tabs"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'pending', label: `Pending (${pendingList.length})` },
              {
                value: 'history',
                label: `Executed & Resolved (${historyList.length})`,
              },
            ]}
          />
        }
      />

      {errorMsg && (
        <div className="px-5 py-3 rounded-xl bg-rose-50/90 border border-rose-200 text-xs text-rose-800">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8">
          <SurfaceCard noPadding>
            {tab === 'pending' && (
              <div>
                <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-[#172B4D]">
                    Pending Sensitive Operations
                  </h2>
                  <StatusIndicator
                    tone={pendingList.length > 0 ? 'warning' : 'success'}
                    label={
                      pendingList.length > 0
                        ? `${pendingList.length} Awaiting Human Authorization`
                        : 'Queue Clear'
                    }
                  />
                </div>

                {pendingList.length === 0 ? (
                  <EmptyState
                    icon={<ShieldCheck className="w-5 h-5" />}
                    title="No pending operations in SecurityGateway"
                    description="Sensitive MCP calls (add_income_information, add_deduction_information, update_return_information, generate_return_draft) appear here for explicit human review."
                  />
                ) : (
                  <div className="divide-y divide-[#E2E8F0]">
                    {pendingList.map((req) => (
                      <div key={req.id} className="p-6 bg-white space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusIndicator
                                tone="warning"
                                label="Sensitive Write Gate"
                              />
                              <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-blue-50/80 text-[#2563EB] border border-blue-200 font-medium">
                                {req.toolName}
                              </span>
                              <span className="text-[11px] font-mono text-[#64748B] tabular-nums">
                                ID: {req.id} · Key: {req.idempotencyKey}
                              </span>
                            </div>

                            <h3 className="text-sm font-semibold text-[#172B4D]">
                              {req.summary}
                            </h3>
                            <p className="text-xs text-[#64748B] leading-relaxed">
                              <span className="font-semibold text-[#172B4D]">
                                Reason:{' '}
                              </span>
                              {req.justification}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <Button
                              variant="primary"
                              loading={resolvingId === req.id}
                              onClick={() => openConfirmDecision(req, 'approve')}
                              icon={<Check className="w-3.5 h-3.5" />}
                            >
                              Approve &amp; Execute
                            </Button>
                            <Button
                              variant="danger"
                              disabled={resolvingId === req.id}
                              onClick={() => openConfirmDecision(req, 'reject')}
                              icon={<X className="w-3.5 h-3.5" />}
                            >
                              Reject
                            </Button>
                            <Button
                              variant="outline"
                              disabled={resolvingId === req.id}
                              onClick={() => openConfirmDecision(req, 'cancel')}
                              icon={<Ban className="w-3.5 h-3.5" />}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>

                        {/* Metadata Bar: Financial Impact, Source Document, Security Status */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3.5 text-xs">
                          <div>
                            <div className="text-[11px] text-[#64748B]">
                              Financial Impact
                            </div>
                            <div className="text-[#172B4D] font-bold font-mono tabular-nums mt-0.5">
                              {typeof req.relevantAmount === 'number'
                                ? formatINR(req.relevantAmount)
                                : 'Draft Snapshot Generation'}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-[#64748B]">
                              Source Document / Input
                            </div>
                            <div className="text-[#172B4D] font-medium font-mono mt-0.5 truncate">
                              {req.sourceDocumentName ??
                                'Taxpayer Session Input'}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-[#64748B]">
                              Security &amp; Risk Policy
                            </div>
                            <div className="text-amber-800 font-medium mt-0.5 flex items-center gap-1">
                              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                              <span>Agent cannot self-approve</span>
                            </div>
                          </div>

                          {req.taxImpactSummary && (
                            <div className="sm:col-span-3 pt-2.5 border-t border-[#E2E8F0] text-[#2563EB] font-mono tabular-nums">
                              <span className="font-sans font-semibold text-[#172B4D]">
                                Deterministic Tax Impact:{' '}
                              </span>
                              {req.taxImpactSummary}
                            </div>
                          )}
                        </div>

                        {/* Before / After Diffs */}
                        {req.diffs.length > 0 && (
                          <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
                            <table className="w-full text-xs text-left border-collapse">
                              <thead>
                                <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B]">
                                  <th className="py-2.5 px-4 font-semibold">
                                    Return Field
                                  </th>
                                  <th className="py-2.5 px-4 font-semibold text-right">
                                    Current Value
                                  </th>
                                  <th className="py-2.5 px-4 font-semibold text-right">
                                    Proposed Value
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#E2E8F0] font-mono tabular-nums bg-white">
                                {req.diffs.map((d) => (
                                  <tr key={d.field}>
                                    <td className="py-2.5 px-4 font-sans text-[#172B4D] font-medium">
                                      {d.label}
                                    </td>
                                    <td className="py-2.5 px-4 text-right text-[#64748B]">
                                      {d.previousValue}
                                    </td>
                                    <td className="py-2.5 px-4 text-right font-bold text-[#2563EB]">
                                      {d.proposedValue}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        <div className="text-[11px] text-[#64748B] font-mono tabular-nums">
                          Created {formatDateTime(req.createdAt)}
                          {req.expiresAt
                            ? ` · Expires ${formatDateTime(req.expiresAt)}`
                            : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'history' && (
              <div>
                <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-[#172B4D]">
                    Executed &amp; Resolved Decisions
                  </h2>
                  <span className="text-xs text-[#64748B] font-mono tabular-nums">
                    {historyList.length} records
                  </span>
                </div>

                {historyList.length === 0 ? (
                  <EmptyState
                    icon={<ShieldCheck className="w-5 h-5" />}
                    title="No resolved approval records yet"
                    description="Completed, rejected, and cancelled approval decisions are logged here with timestamps."
                  />
                ) : (
                  <div className="divide-y divide-[#E2E8F0] bg-white">
                    {historyList.map((item) => {
                      const tone =
                        item.status === 'executed' || item.status === 'approved'
                          ? 'success'
                          : item.status === 'cancelled'
                            ? 'neutral'
                            : 'error';
                      return (
                        <div key={item.id} className="p-6 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-[#172B4D]">
                                {item.summary}
                              </span>
                              <span className="font-mono text-[11px] text-[#2563EB]">
                                ({item.toolName})
                              </span>
                            </div>
                            <StatusIndicator
                              tone={tone}
                              label={item.status.toUpperCase()}
                              mono
                            />
                          </div>
                          <p className="text-xs text-[#64748B]">
                            {item.justification}
                          </p>
                          {item.taxImpactSummary && (
                            <p className="text-xs font-mono text-[#2563EB]">
                              {item.taxImpactSummary}
                            </p>
                          )}
                          {item.executionResultSummary && (
                            <p className="text-xs text-[#172B4D] font-medium pt-0.5">
                              {item.executionResultSummary}
                            </p>
                          )}
                          <div className="text-[11px] text-[#64748B] font-mono tabular-nums">
                            Request {item.id} · Decided{' '}
                            {formatDateTime(item.decidedAt ?? item.createdAt)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </SurfaceCard>
        </div>

        {/* Gateway Policies & PII Inspector */}
        <div className="lg:col-span-4 space-y-6">
          <SurfaceCard className="space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-[#E2E8F0]">
              <Lock className="w-4 h-4 text-[#2563EB]" />
              <h2 className="text-sm font-semibold text-[#172B4D]">
                SecurityGateway Policies
              </h2>
            </div>

            {(
              [
                [
                  'requireHumanApprovalForWrites',
                  'Require Approval for Sensitive Writes',
                  'Holds income, deduction, return update, and draft generation.',
                ],
                [
                  'enforcePiiMaskingToLlm',
                  'Enforce PII Redaction in Logs & LLM',
                  'Scrubs PAN, TAN, bank accounts, emails, and phones.',
                ],
                [
                  'enforceDocumentAcl',
                  'Enforce Per-Document Session ACL',
                  'Prevents agent extraction on blocked documents.',
                ],
                [
                  'allowCalculateTaxTool',
                  'Permit Deterministic Tax Tools',
                  'Toggle off to test unauthorized tool rejection.',
                ],
              ] as Array<[keyof SecurityGatewayConfig, string, string]>
            ).map(([key, title, desc]) => (
              <label
                key={key}
                className="flex items-start justify-between gap-3 cursor-pointer"
              >
                <div>
                  <div className="text-xs font-medium text-[#172B4D]">
                    {title}
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">
                    {desc}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={gatewayConfig[key]}
                  onChange={(e) =>
                    onUpdateGatewayConfig({ [key]: e.target.checked })
                  }
                  className="mt-0.5 rounded border-[#E2E8F0] text-[#2563EB]"
                />
              </label>
            ))}
          </SurfaceCard>

          <SurfaceCard className="space-y-3">
            <h2 className="text-sm font-semibold text-[#172B4D]">
              Live PII Masking Verifier
            </h2>
            <p className="text-xs text-[#64748B]">
              Test the backend redaction filter before payloads reach external
              LLM providers or audit logs.
            </p>
            <form onSubmit={handleRunMaskTest} className="space-y-3 text-xs">
              <textarea
                rows={3}
                value={piiSampleInput}
                onChange={(e) => setPiiSampleInput(e.target.value)}
                className="w-full p-2.5 font-mono text-xs text-[#172B4D] bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB]"
              />
              <Button type="submit" variant="primary" className="w-full">
                Verify Redaction ({piiCount} fields masked)
              </Button>
            </form>
            <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] font-mono text-xs text-[#172B4D] break-words">
              {piiMaskedOutput}
            </div>
          </SurfaceCard>
        </div>
      </div>

      {/* Accessible Confirmation Dialog for Sensitive Decisions */}
      <ConfirmDialog
        open={Boolean(stagedDecision)}
        title={
          stagedDecision?.action === 'approve'
            ? 'Approve & Execute Sensitive Operation?'
            : stagedDecision?.action === 'reject'
              ? 'Reject Sensitive Operation?'
              : 'Cancel Staged Operation?'
        }
        description={
          stagedDecision?.action === 'approve'
            ? 'SecurityGateway will execute this idempotent MCP write against your active filing session and automatically resume the AI orchestrator.'
            : stagedDecision?.action === 'reject'
              ? 'The staged mutation will be rejected and recorded in the SHA-256 audit log without altering your return.'
              : 'The staged mutation will be cancelled and removed from the active queue without modifying your return.'
        }
        details={
          stagedDecision ? (
            <div className="space-y-2.5">
              <div className="font-semibold text-[#172B4D]">
                {stagedDecision.req.summary}
              </div>
              <div className="font-mono text-[11px] text-[#64748B]">
                Tool: {stagedDecision.req.toolName} · Approval ID:{' '}
                {stagedDecision.req.id}
              </div>
              <div>
                <label
                  htmlFor="approval-decision-note"
                  className="block text-[11px] font-medium text-[#64748B] mb-1"
                >
                  Optional Audit Decision Note
                </label>
                <input
                  id="approval-decision-note"
                  type="text"
                  value={decisionNote}
                  onChange={(e) => setDecisionNote(e.target.value)}
                  placeholder="e.g., Verified against Form 16 & SBI certificate"
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#E2E8F0] rounded-md focus:outline-none focus:border-[#2563EB]"
                />
              </div>
            </div>
          ) : undefined
        }
        confirmLabel={
          stagedDecision?.action === 'approve'
            ? 'Confirm Approval'
            : stagedDecision?.action === 'reject'
              ? 'Confirm Rejection'
              : 'Confirm Cancellation'
        }
        confirmVariant={
          stagedDecision?.action === 'reject' ? 'danger' : 'primary'
        }
        loading={Boolean(resolvingId)}
        onConfirm={handleConfirmDecision}
        onClose={() => setStagedDecision(null)}
      />
    </div>
  );
};
