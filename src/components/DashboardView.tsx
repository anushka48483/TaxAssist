import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Download,
  FileCheck2,
  FileText,
  Scale,
  Upload,
} from 'lucide-react';
import { WorkspaceSnapshot } from '../shared/types';
import { formatINR, formatShortTime, maskPan } from '../utils/format';
import { Button, MetricCard, PageHeader, StatusIndicator, SurfaceCard } from './DesignSystem';

export type GuidedStepId =
  | 'personal-info'
  | 'upload-docs'
  | 'review-extracted'
  | 'resolve-differences'
  | 'tax-calculation'
  | 'review-download';

interface DashboardViewProps {
  snapshot: WorkspaceSnapshot;
  onContinueFiling: (targetStep: GuidedStepId) => void;
  onOpenDocuments: () => void;
  onOpenTaxSummary: () => void;
  onOpenReturn: () => void;
  onOpenAssistant: () => void;
  onStartDemo: () => Promise<void>;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  snapshot,
  onContinueFiling,
  onOpenDocuments,
  onOpenTaxSummary,
  onOpenReturn,
  onOpenAssistant,
  onStartDemo,
}) => {
  const {
    profile,
    documents,
    activeDraft,
    reconciliation,
    approvals,
    liveEvents = [],
  } = snapshot;

  const pendingApprovals = approvals.filter((a) => a.status === 'pending');
  const pendingFieldConfirmations = Object.values(snapshot.fieldStates ?? {}).filter(
    (f) => f.status === 'pending_confirmation' || f.status === 'needs_review'
  );
  const lowConfidenceDocs = documents.filter((d) => d.needsUserReview);
  const unresolvedDifferences =
    pendingApprovals.length +
    pendingFieldConfirmations.length +
    (reconciliation.conflictCount > 0 && pendingFieldConfirmations.length === 0 ? reconciliation.conflictCount : 0);

  const activeRegime =
    activeDraft.selectedRegime === 'new'
      ? activeDraft.taxSummary.newRegime
      : activeDraft.taxSummary.oldRegime;

  const missingPersonalKeys = [
    !profile.fullName,
    !profile.pan,
    !profile.dateOfBirth,
    !profile.aadhaarLast4,
    !profile.email,
    !profile.phone,
    !profile.bankName,
    !profile.bankAccountNumber,
    !profile.bankIfsc,
  ].filter(Boolean).length;
  const hasPersonalInfo = missingPersonalKeys === 0;
  const hasDocuments = documents.length > 0;
  const hasExtracted = documents.some((d) => d.processingStatus === 'extracted');
  const hasResolvedDifferences =
    hasExtracted &&
    pendingApprovals.length === 0 &&
    pendingFieldConfirmations.length === 0 &&
    reconciliation.conflictCount === 0;
  const hasTaxComputed = activeDraft.inputs.grossSalary > 0;
  const isReadyToDownload =
    activeDraft.status === 'validated_ready' ||
    (hasTaxComputed && activeDraft.validation.errorCount === 0 && hasResolvedDifferences);

  const checklist: Array<{
    stepId: GuidedStepId;
    title: string;
    detail: string;
    done: boolean;
    needsAttention?: boolean;
  }> = [
    {
      stepId: 'upload-docs',
      title: '1. Upload Tax Documents',
      detail: hasDocuments
        ? `${documents.length} document${documents.length === 1 ? '' : 's'} uploaded · auto-filling ITR-1`
        : 'Upload Form 16, bank statement, FD certificate, or 26AS — we extract everything automatically',
      done: hasDocuments,
    },
    {
      stepId: 'review-extracted',
      title: '2. Verify & Edit Extracted Details',
      detail: hasExtracted
        ? lowConfidenceDocs.length > 0
          ? `${lowConfidenceDocs.length} document needs a quick check`
          : 'Check extracted values & edit anything wrong directly in the form'
        : 'Waiting for document upload',
      done: hasExtracted && lowConfidenceDocs.length === 0,
      needsAttention: lowConfidenceDocs.length > 0,
    },
    {
      stepId: 'personal-info',
      title: '3. Missing Personal & Bank Details',
      detail: hasPersonalInfo
        ? `${profile.fullName} · PAN ${maskPan(profile.pan)} · Bank ready`
        : hasDocuments
          ? `${missingPersonalKeys} detail(s) not found in documents — fill only what is missing`
          : 'Auto-filled from documents; enter only what is missing',
      done: hasPersonalInfo,
      needsAttention: hasDocuments && !hasPersonalInfo,
    },
    {
      stepId: 'resolve-differences',
      title: '4. Tell AI What to Perform & Confirm',
      detail: hasResolvedDifferences
        ? 'All instructions applied and items confirmed'
        : pendingApprovals.length + pendingFieldConfirmations.length > 0
          ? `${pendingFieldConfirmations.length + pendingApprovals.length} item(s) waiting for your confirmation`
          : 'Write your goal in plain English (e.g. prepare my return or compare regimes)',
      done: hasResolvedDifferences,
      needsAttention: hasExtracted && !hasResolvedDifferences,
    },
    {
      stepId: 'tax-calculation',
      title: '5. Check Old vs New Tax Regime',
      detail: hasTaxComputed
        ? `${activeDraft.taxSummary.recommendedRegime.toUpperCase()} Regime saves ${formatINR(activeDraft.taxSummary.netSavingsInRecommended)}`
        : 'Tax will calculate as soon as income details are ready',
      done: hasTaxComputed,
    },
    {
      stepId: 'review-download',
      title: '6. Review & Download ITR-1 Draft',
      detail: isReadyToDownload
        ? `Draft v${activeDraft.version} ready to review and download`
        : 'Complete steps above to unlock final draft',
      done: activeDraft.status === 'validated_ready',
    },
  ];

  const completedCount = checklist.filter((c) => c.done).length;

  // Determine the single smartest next step for the "Continue Filing" primary CTA
  const nextStep: GuidedStepId = !hasDocuments
    ? 'upload-docs'
    : lowConfidenceDocs.length > 0
      ? 'review-extracted'
      : !hasPersonalInfo
        ? 'personal-info'
        : !hasResolvedDifferences
          ? 'resolve-differences'
          : !hasTaxComputed
            ? 'tax-calculation'
            : 'review-download';

  const nextActionLabel = !hasDocuments
    ? 'Upload Your Documents'
    : lowConfidenceDocs.length > 0
      ? 'Verify Extracted Details'
      : !hasPersonalInfo
        ? `Complete ${missingPersonalKeys} Missing Detail${missingPersonalKeys === 1 ? '' : 's'}`
        : pendingApprovals.length > 0 || pendingFieldConfirmations.length > 0
          ? 'Instruct AI & Confirm Items'
          : activeDraft.status === 'validated_ready'
            ? 'Review & Download ITR-1'
            : 'Continue Filing';

  const recentFeed = [...liveEvents].reverse().slice(0, 6);

  return (
    <div className="space-y-6">
      {/* Guided Taxpayer Status Header */}
      <PageHeader
        eyebrow={
          <>
            <span>AY 2026-27 (FY 2025-26)</span>
            <span aria-hidden="true">·</span>
            <span>ITR-1 SAHAJ</span>
            <span aria-hidden="true">·</span>
            <span>{completedCount} OF {checklist.length} STEPS COMPLETE</span>
          </>
        }
        title="Your Income Tax Filing Overview"
        description={
          !hasDocuments
            ? 'Start by uploading your Form 16, bank statements, FD certificates, or investment proofs. TaxShield extracts every detail automatically and only asks for what is missing.'
            : unresolvedDifferences > 0
              ? `We auto-filled details from your documents and found ${pendingFieldConfirmations.length + pendingApprovals.length} item(s) awaiting your review or confirmation.`
              : `Your ITR-1 calculations are up to date under the ${activeDraft.selectedRegime.toUpperCase()} Regime. Review your return and download your local draft whenever you are ready.`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            {!hasDocuments && (
              <Button variant="outline" onClick={onStartDemo}>
                Try Sample Documents
              </Button>
            )}
            <Button
              variant="primary"
              size="lg"
              onClick={() => onContinueFiling(nextStep)}
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              {nextActionLabel}
            </Button>
          </div>
        }
      />

      {/* Unsupported Scenario Notice if Applicable */}
      {snapshot.activeSession.unsupportedScenarios.length > 0 && (
        <SurfaceCard className="border-rose-200 bg-rose-50/70">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <h2 className="text-sm font-semibold text-rose-900">
                This income type is outside ITR-1 (Sahaj)
              </h2>
              <p className="text-rose-800 leading-relaxed">
                {snapshot.activeSession.unsupportedScenarios[0].reason} Recommended form:{' '}
                <span className="font-semibold">
                  {snapshot.activeSession.unsupportedScenarios[0].recommendedItrForm}
                </span>
                .
              </p>
            </div>
          </div>
        </SurfaceCard>
      )}

      {/* 4 Clean Consumer Financial Numbers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Gross Total Income"
          value={formatINR(activeRegime.grossTotalIncome)}
          subtext={`Salary ${formatINR(activeRegime.netSalaryIncome)} + Other ${formatINR(activeRegime.incomeFromOtherSources)}`}
          onClick={() => onContinueFiling('review-extracted')}
        />
        <MetricCard
          label="Total Deductions Claimed"
          value={formatINR(
            activeRegime.standardDeduction + activeRegime.totalChapterVIADeductions
          )}
          subtext={`Std Ded ${formatINR(activeRegime.standardDeduction)} · VI-A ${formatINR(activeRegime.totalChapterVIADeductions)}`}
          onClick={onOpenTaxSummary}
        />
        <MetricCard
          label={activeRegime.refundDue > 0 ? 'Estimated Tax Refund' : 'Estimated Tax Payable'}
          value={
            activeRegime.refundDue > 0
              ? formatINR(activeRegime.refundDue)
              : formatINR(activeRegime.netTaxPayable)
          }
          subtext={`Tax ${formatINR(activeRegime.totalTaxLiability)} · TDS ${formatINR(activeRegime.tdsCredited)}`}
          tone={activeRegime.refundDue > 0 ? 'positive' : 'blue'}
          onClick={onOpenTaxSummary}
        />
        <MetricCard
          label="Recommended Tax Regime"
          value={
            activeDraft.taxSummary.recommendedRegime === 'new'
              ? 'New Regime'
              : 'Old Regime'
          }
          subtext={
            activeDraft.taxSummary.netSavingsInRecommended > 0
              ? `Saves ${formatINR(activeDraft.taxSummary.netSavingsInRecommended)} vs other regime`
              : 'Equal tax under both regimes'
          }
          tone="blue"
          onClick={onOpenTaxSummary}
        />
      </div>

      {/* Main Two-Column Consumer Body */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Cols: 6-Step Filing Progress Checklist */}
        <SurfaceCard noPadding className="lg:col-span-7">
          <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[#172B4D]">
                Your Guided Filing Checklist
              </h2>
              <p className="text-xs text-[#64748B] mt-0.5">
                Click any step to review or edit details directly in your live ITR-1 form.
              </p>
            </div>
            <StatusIndicator
              tone={completedCount === checklist.length ? 'success' : 'info'}
              label={`${completedCount}/${checklist.length} Done`}
            />
          </div>

          <div className="divide-y divide-[#E2E8F0]">
            {checklist.map((item) => (
              <button
                key={item.stepId}
                type="button"
                onClick={() => onContinueFiling(item.stepId)}
                className="w-full px-6 py-4 flex items-center justify-between gap-4 text-left hover:bg-[#F8FAFC] transition-colors cursor-pointer"
              >
                <div className="flex items-start gap-3 min-w-0">
                  {item.done ? (
                    <CheckCircle2 className="w-4 h-4 text-[#0D9488] shrink-0 mt-0.5" />
                  ) : item.needsAttention ? (
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="w-4 h-4 text-[#94A3B8] shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#172B4D]">
                      {item.title}
                    </div>
                    <div className="text-xs text-[#64748B] mt-0.5 truncate">
                      {item.detail}
                    </div>
                  </div>
                </div>

                <span
                  className={`text-xs font-medium shrink-0 inline-flex items-center gap-1 ${
                    item.needsAttention
                      ? 'text-amber-700'
                      : item.done
                        ? 'text-[#0D9488]'
                        : 'text-[#2563EB]'
                  }`}
                >
                  <span>
                    {item.needsAttention ? 'Review' : item.done ? 'View' : 'Start'}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </button>
            ))}
          </div>
        </SurfaceCard>

        {/* Right 5 Cols: Needs Attention + Quick Shortcuts + Recent Updates */}
        <div className="lg:col-span-5 space-y-6">
          {(pendingFieldConfirmations.length > 0 || pendingApprovals.length > 0) && (
            <SurfaceCard className="border-amber-200 bg-amber-50/40 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[#172B4D]">
                  Items Waiting for Your Confirmation
                </h2>
                <StatusIndicator
                  tone="warning"
                  label={`${pendingFieldConfirmations.length + pendingApprovals.length} Pending`}
                />
              </div>
              <p className="text-xs text-[#64748B] leading-relaxed">
                We found additional financial items in your uploaded documents. Review and confirm them before generating your final ITR-1 draft.
              </p>
              <ul className="space-y-2 text-xs">
                {pendingFieldConfirmations.slice(0, 4).map((f) => (
                  <li
                    key={f.fieldKey}
                    className="flex items-center justify-between gap-2 bg-white border border-amber-200/80 rounded-lg px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-[#172B4D] truncate">{f.label}</div>
                      <div className="text-[11px] text-[#64748B] truncate">
                        From {f.sourceDocument || 'uploaded document'}
                      </div>
                    </div>
                    <span className="font-mono font-semibold text-[#172B4D] tabular-nums shrink-0">
                      {typeof f.stagedValue === 'number'
                        ? formatINR(f.stagedValue)
                        : String(f.stagedValue ?? '—')}
                    </span>
                  </li>
                ))}
              </ul>
              <Button
                variant="primary"
                size="sm"
                className="w-full"
                onClick={() => onContinueFiling('resolve-differences')}
              >
                Review &amp; Confirm in Live Form
              </Button>
            </SurfaceCard>
          )}

          <SurfaceCard className="space-y-3">
            <h2 className="text-sm font-semibold text-[#172B4D]">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={onOpenDocuments}
                className="p-3 rounded-lg border border-[#E2E8F0] hover:border-blue-300 hover:bg-[#F8FAFC] text-left transition-colors cursor-pointer"
              >
                <Upload className="w-4 h-4 text-[#2563EB] mb-1.5" />
                <div className="text-xs font-semibold text-[#172B4D]">My Documents</div>
                <div className="text-[11px] text-[#64748B] mt-0.5">
                  {documents.length} uploaded
                </div>
              </button>
              <button
                type="button"
                onClick={onOpenTaxSummary}
                className="p-3 rounded-lg border border-[#E2E8F0] hover:border-blue-300 hover:bg-[#F8FAFC] text-left transition-colors cursor-pointer"
              >
                <Scale className="w-4 h-4 text-[#0D9488] mb-1.5" />
                <div className="text-xs font-semibold text-[#172B4D]">Tax Summary</div>
                <div className="text-[11px] text-[#64748B] mt-0.5">
                  Old vs New regime
                </div>
              </button>
              <button
                type="button"
                onClick={onOpenReturn}
                className="p-3 rounded-lg border border-[#E2E8F0] hover:border-blue-300 hover:bg-[#F8FAFC] text-left transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4 text-[#2563EB] mb-1.5" />
                <div className="text-xs font-semibold text-[#172B4D]">My Return</div>
                <div className="text-[11px] text-[#64748B] mt-0.5">
                  Draft v{activeDraft.version}
                </div>
              </button>
              <button
                type="button"
                onClick={onOpenAssistant}
                className="p-3 rounded-lg border border-[#E2E8F0] hover:border-blue-300 hover:bg-[#F8FAFC] text-left transition-colors cursor-pointer"
              >
                <FileText className="w-4 h-4 text-[#0D9488] mb-1.5" />
                <div className="text-xs font-semibold text-[#172B4D]">Ask Assistant</div>
                <div className="text-[11px] text-[#64748B] mt-0.5">
                  Plain-English help
                </div>
              </button>
            </div>
          </SurfaceCard>

          <SurfaceCard className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#172B4D]">Recent Updates</h2>
              <span className="text-[11px] text-[#64748B]">Live session log</span>
            </div>
            {recentFeed.length === 0 ? (
              <div className="py-4 text-xs text-[#64748B] flex items-center gap-2">
                <FileCheck2 className="w-4 h-4 text-[#94A3B8]" />
                <span>Updates appear here automatically as you upload documents.</span>
              </div>
            ) : (
              <div className="space-y-2.5">
                {recentFeed.map((ev) => (
                  <div
                    key={ev.eventId}
                    className="flex items-start justify-between gap-3 text-xs pb-2.5 border-b border-[#E2E8F0] last:border-b-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-[#172B4D] truncate">
                        {ev.title}
                      </div>
                      <div className="text-[11px] text-[#64748B] truncate mt-0.5">
                        {ev.message}
                      </div>
                    </div>
                    <span className="text-[11px] font-mono text-[#64748B] tabular-nums shrink-0">
                      {formatShortTime(ev.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
};
