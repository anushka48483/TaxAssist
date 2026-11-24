import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Lock, ShieldCheck, X } from 'lucide-react';
import { ApprovalRequest, ReturnDraft } from '../shared/types';
import { formatINR } from '../utils/format';
import { Button } from './DesignSystem';

interface ApprovalConfirmationModalProps {
  open: boolean;
  mode: 'approval_request' | 'finalize_return';
  approval?: ApprovalRequest | null;
  draft: ReturnDraft;
  loading?: boolean;
  onConfirm: () => Promise<void>;
  onReject?: () => Promise<void>;
  onClose: () => void;
}

export const ApprovalConfirmationModal: React.FC<ApprovalConfirmationModalProps> = ({
  open,
  mode,
  approval,
  draft,
  loading = false,
  onConfirm,
  onReject,
  onClose,
}) => {
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    setShowDetails(false);
  }, [open, approval?.id, mode]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, loading, onClose]);

  if (!open) return null;

  const selectedCalc =
    draft.selectedRegime === 'new'
      ? draft.taxSummary.newRegime
      : draft.taxSummary.oldRegime;

  const isFinalize = mode === 'finalize_return';
  const title = isFinalize
    ? 'Confirm & Finalize Your Return'
    : 'Confirm Change to Your Return';
  const summaryText = isFinalize
    ? `You are authorizing TaxShield to lock your ITR-1 draft under the ${
        draft.selectedRegime === 'new' ? 'New Regime' : 'Old Regime'
      } with a total tax of ${formatINR(selectedCalc.totalTaxLiability)}. This creates a local filing package only and does not submit to the government portal.`
    : approval?.summary || 'Please confirm whether you want to apply this change to your tax return.';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#172B4D]/25"
    >
      <div className="bg-white border border-[#E2E8F0] rounded-xl max-w-lg w-full shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-blue-50 text-[#2563EB] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </span>
            <div>
              <h2 id="approval-modal-title" className="text-base font-semibold text-[#172B4D]">
                {title}
              </h2>
              <p className="text-[11px] text-[#64748B]">
                Human approval required before saving changes
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            aria-label="Close confirmation dialog"
            className="p-1.5 text-[#64748B] hover:text-[#172B4D] rounded-lg hover:bg-[#F8FAFC] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-[#172B4D] leading-relaxed">{summaryText}</p>

          {isFinalize ? (
            <div className="grid grid-cols-3 gap-3 p-3.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs">
              <div>
                <div className="text-[11px] text-[#64748B]">Taxable Income</div>
                <div className="font-semibold font-mono tabular-nums text-[#172B4D] mt-0.5">
                  {formatINR(selectedCalc.taxableIncome)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#64748B]">Total Tax</div>
                <div className="font-semibold font-mono tabular-nums text-[#172B4D] mt-0.5">
                  {formatINR(selectedCalc.totalTaxLiability)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#64748B]">
                  {selectedCalc.refundDue > 0 ? 'Net Refund' : 'Balance Payable'}
                </div>
                <div className="font-semibold font-mono tabular-nums text-[#0D9488] mt-0.5">
                  {formatINR(
                    selectedCalc.refundDue > 0
                      ? selectedCalc.refundDue
                      : selectedCalc.netTaxPayable
                  )}
                </div>
              </div>
            </div>
          ) : (
            approval?.diffs &&
            approval.diffs.length > 0 && (
              <div className="border border-[#E2E8F0] rounded-lg divide-y divide-[#E2E8F0] text-xs">
                {approval.diffs.map((diff) => (
                  <div
                    key={diff.field}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                  >
                    <span className="text-[#64748B]">{diff.label}</span>
                    <span className="font-mono tabular-nums text-[#172B4D] font-medium">
                      {typeof diff.previousValue === 'number'
                        ? formatINR(diff.previousValue)
                        : String(diff.previousValue)}{' '}
                      →{' '}
                      <span className="text-[#2563EB] font-semibold">
                        {typeof diff.proposedValue === 'number'
                          ? formatINR(diff.proposedValue)
                          : String(diff.proposedValue)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Optional Technical Inspection Disclosure */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#64748B] hover:text-[#172B4D] cursor-pointer"
            >
              {showDetails ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              <span>Inspect details</span>
            </button>

            {showDetails && (
              <div className="mt-2 p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] space-y-1.5 text-[11px] text-[#64748B]">
                <div className="flex items-center gap-1.5 text-[#172B4D] font-medium">
                  <Lock className="w-3 h-3 text-[#2563EB]" />
                  <span>SecurityGateway Permission Check</span>
                </div>
                <div>
                  Tool:{' '}
                  <span className="font-mono text-[#172B4D]">
                    {approval?.toolName || 'generate_return_draft'}
                  </span>
                </div>
                {approval?.justification && <div>Reason: {approval.justification}</div>}
                {approval?.sourceDocumentName && (
                  <div>Source: {approval.sourceDocumentName}</div>
                )}
                <div>Audit logging: SHA-256 hash-chained &amp; PII-redacted</div>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-3.5 border-t border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-end gap-2.5">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          {onReject && !isFinalize && (
            <Button variant="danger" size="sm" onClick={onReject} disabled={loading}>
              Decline Change
            </Button>
          )}
          <Button variant="primary" size="sm" loading={loading} onClick={onConfirm}>
            {isFinalize ? 'Approve & Finalize Return' : 'Approve & Apply'}
          </Button>
        </div>
      </div>
    </div>
  );
};
