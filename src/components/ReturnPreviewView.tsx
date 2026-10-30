import React, { useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  Info,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { TaxRegime, WorkspaceSnapshot } from '../shared/types';
import {
  formatDateTime,
  formatINR,
  maskAccountNumber,
  maskPan,
  redactSensitiveText,
} from '../utils/format';
import {
  Button,
  LightCodeBlock,
  MetricCard,
  PageHeader,
  SegmentedControl,
  StatusIndicator,
  SurfaceCard,
} from './DesignSystem';

interface ReturnPreviewViewProps {
  snapshot: WorkspaceSnapshot;
  onStageGenerateDraft: (
    selectedRegime: TaxRegime,
    releaseNote: string
  ) => Promise<void>;
  onNavigateToApprovals: () => void;
}

export const ReturnPreviewView: React.FC<ReturnPreviewViewProps> = ({
  snapshot,
  onStageGenerateDraft,
  onNavigateToApprovals,
}) => {
  const { drafts, activeDraft, profile, activeSession } = snapshot;

  const [selectedDraftId, setSelectedDraftId] = useState<string>(
    activeDraft.id
  );
  const [viewMode, setViewMode] = useState<'formatted' | 'json'>('formatted');
  const [stagingGen, setStagingGen] = useState(false);
  const [stagedMsg, setStagedMsg] = useState<string | null>(null);

  const inspectedDraft =
    drafts.find((d) => d.id === selectedDraftId) || activeDraft;

  const regCalc =
    inspectedDraft.selectedRegime === 'new'
      ? inspectedDraft.taxSummary.newRegime
      : inspectedDraft.taxSummary.oldRegime;

  const rawJsonString = JSON.stringify(inspectedDraft.itrJson, null, 2);
  const displayJsonString = redactSensitiveText(rawJsonString);

  const handleDownloadJson = () => {
    const blob = new Blob([rawJsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ITR1_AY2026_27_Draft_v${inspectedDraft.version}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleGenerateSnapshot = async () => {
    setStagingGen(true);
    setStagedMsg(null);
    try {
      await onStageGenerateDraft(
        inspectedDraft.taxSummary.recommendedRegime,
        `Formal validated ITR-1 snapshot locked under optimal ${inspectedDraft.taxSummary.recommendedRegime.toUpperCase()} regime.`
      );
      setStagedMsg(
        'Staged generate_return_draft in the SecurityGateway Approval Center. Approve to lock a new ITR-1 JSON snapshot version.'
      );
    } finally {
      setStagingGen(false);
    }
  };

  const unsupportedList = inspectedDraft.validation.unsupportedScenarios ?? [];

  return (
    <div className="space-y-6">
      {/* Explicit Local Draft Non-Submission Guard Banner — Strictly Light Fintech Surface */}
      <div className="bg-blue-50/70 border border-blue-200 text-[#172B4D] rounded-xl px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
        <div className="flex items-start sm:items-center gap-2.5">
          <Info className="w-4 h-4 text-[#2563EB] shrink-0 mt-0.5 sm:mt-0" />
          <div>
            <span className="font-semibold text-[#172B4D]">
              Local Draft Only (Not Filed):{' '}
            </span>
            <span className="text-[#64748B]">
              TaxShield MCP prepares offline validated ITR-1 (Sahaj) JSON drafts
              strictly for taxpayer review. It never submits returns to the
              Income Tax Department e-Filing portal.
            </span>
          </div>
        </div>
        <span className="font-mono text-[11px] font-semibold text-[#2563EB] shrink-0">
          {inspectedDraft.taxSummary.ruleEngineVersion}
        </span>
      </div>

      {/* Unsupported Scenario Guard Banner */}
      {unsupportedList.length > 0 && (
        <div className="bg-rose-50/90 border border-rose-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-rose-900 font-semibold text-sm">
            <AlertOctagon className="w-4 h-4 text-rose-700 shrink-0" />
            ITR-1 Eligibility Blocked — Unsupported Tax Scenario Detected
          </div>
          {unsupportedList.map((flag) => (
            <div key={flag.code} className="text-xs text-rose-800">
              <span className="font-mono font-semibold">{flag.code}</span> ·{' '}
              {flag.title} — Recommended Form:{' '}
              <span className="font-semibold">{flag.recommendedItrForm}</span>.{' '}
              {flag.reason}
            </div>
          ))}
        </div>
      )}

      {/* Header, Version Switcher & Export Actions */}
      <PageHeader
        eyebrow={
          <>
            <span>GENERATED RETURN SNAPSHOT</span>
            <span aria-hidden="true">·</span>
            <span>DRAFT V{inspectedDraft.version}</span>
            <span aria-hidden="true">·</span>
            <span>{activeSession.assessmentYear}</span>
          </>
        }
        title="Generated ITR-1 (Sahaj) Return Summary & JSON Export"
        description="Review validated return schedules, compare historical SQLite draft versions, and export clean ITR-1 JSON for offline verification."
        actions={
          <>
            <select
              aria-label="Select draft version"
              value={inspectedDraft.id}
              onChange={(e) => setSelectedDraftId(e.target.value)}
              className="px-3 py-2 text-xs font-medium text-[#172B4D] bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB]"
            >
              {[...drafts].reverse().map((d) => (
                <option key={d.id} value={d.id}>
                  Draft v{d.version} · {d.selectedRegime.toUpperCase()} Regime
                </option>
              ))}
            </select>

            <Button
              variant="teal"
              loading={stagingGen}
              disabled={unsupportedList.length > 0}
              onClick={handleGenerateSnapshot}
              icon={<ShieldCheck className="w-3.5 h-3.5" />}
            >
              Generate New ITR Snapshot
            </Button>

            <Button
              variant="primary"
              onClick={handleDownloadJson}
              icon={<Download className="w-3.5 h-3.5" />}
            >
              Download ITR-1 JSON
            </Button>
          </>
        }
        footer={
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3.5">
              <MetricCard
                label="Draft Version"
                value={`v${inspectedDraft.version}`}
                subtext={`${inspectedDraft.selectedRegime.toUpperCase()} Regime`}
              />
              <MetricCard
                label="Validation Status"
                value={
                  inspectedDraft.validation.isValid &&
                  unsupportedList.length === 0
                    ? 'Valid'
                    : 'Review Needed'
                }
                tone={
                  inspectedDraft.validation.isValid &&
                  unsupportedList.length === 0
                    ? 'positive'
                    : 'negative'
                }
                subtext={`${inspectedDraft.validation.passCount} checks passed`}
              />
              <MetricCard
                label="Gross Total Income"
                value={formatINR(regCalc.grossTotalIncome)}
                subtext={`Ded ${formatINR(regCalc.totalChapterVIADeductions)}`}
              />
              <MetricCard
                label="Taxable Income"
                value={formatINR(regCalc.taxableIncome)}
                tone="blue"
                subtext="Rounded u/s 288A"
              />
              <MetricCard
                label="Total Tax Liability"
                value={formatINR(regCalc.totalTaxLiability)}
                subtext={`TDS + Adv ${formatINR(
                  regCalc.tdsCredited + regCalc.advanceTaxPaid
                )}`}
              />
              <MetricCard
                label={
                  regCalc.refundDue > 0 ? 'Refund Due' : 'Balance Tax Payable'
                }
                value={
                  regCalc.refundDue > 0
                    ? formatINR(regCalc.refundDue)
                    : formatINR(regCalc.netTaxPayable)
                }
                tone={
                  regCalc.refundDue > 0
                    ? 'positive'
                    : regCalc.netTaxPayable > 0
                      ? 'negative'
                      : 'default'
                }
                subtext="u/s 288B settlement"
              />
            </div>

            {stagedMsg && (
              <div className="px-4 py-3 rounded-lg bg-blue-50/90 border border-blue-200 flex flex-wrap items-center justify-between gap-4 text-xs text-[#172B4D]">
                <span>{stagedMsg}</span>
                <button
                  type="button"
                  onClick={onNavigateToApprovals}
                  className="font-semibold text-[#2563EB] inline-flex items-center gap-1 hover:underline shrink-0 cursor-pointer"
                >
                  Approve in Approval Center
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 4 Columns: Validation Checklist */}
        <SurfaceCard noPadding className="lg:col-span-4">
          <div className="px-5 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC]">
            <h2 className="text-sm font-semibold text-[#172B4D]">
              Mandatory ITR-1 Validation Results
            </h2>
            <div className="text-xs text-[#64748B] mt-0.5 font-mono tabular-nums">
              {inspectedDraft.validation.passCount} Passed ·{' '}
              {inspectedDraft.validation.warningCount} Warnings ·{' '}
              {inspectedDraft.validation.errorCount} Errors
            </div>
          </div>

          <div className="divide-y divide-[#E2E8F0] bg-white">
            {inspectedDraft.validation.issues.map((issue) => (
              <div
                key={issue.code}
                className="p-4 flex items-start gap-2.5 text-xs"
              >
                {issue.severity === 'pass' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                ) : issue.severity === 'warning' ? (
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-mono text-[11px] font-semibold text-[#172B4D]">
                    {issue.code}
                  </div>
                  <p className="text-[#64748B] mt-0.5 leading-relaxed">
                    {issue.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </SurfaceCard>

        {/* Right 8 Columns: Formatted ITR-1 Schedule Preview OR Light-Themed Raw JSON Viewer */}
        <SurfaceCard noPadding className="lg:col-span-8">
          <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-[#172B4D]">
                  ITR-1 (Sahaj) Draft v{inspectedDraft.version} —{' '}
                  {inspectedDraft.selectedRegime.toUpperCase()} Regime
                </h2>
                <StatusIndicator
                  tone={inspectedDraft.validation.isValid ? 'success' : 'warning'}
                  label={inspectedDraft.status}
                />
              </div>
              <div className="text-xs text-[#64748B] mt-0.5">
                Created {formatDateTime(inspectedDraft.createdAt)} ·{' '}
                {inspectedDraft.approvedBy}
              </div>
            </div>

            <SegmentedControl
              ariaLabel="Return display mode"
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: 'formatted', label: 'Structured Summary' },
                { value: 'json', label: 'Raw ITR-1 JSON' },
              ]}
            />
          </div>

          {viewMode === 'formatted' ? (
            <div className="divide-y divide-[#E2E8F0] text-xs bg-white">
              {/* Part A: General Information */}
              <div className="p-6">
                <h3 className="font-semibold text-[#172B4D] mb-3">
                  Part A — Personal &amp; Filing Information (Section 139(1))
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 font-mono tabular-nums">
                  <div>
                    <div className="text-[#64748B] font-sans">Assessee Name</div>
                    <div className="text-[#172B4D] font-semibold mt-0.5">
                      {profile.fullName}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#64748B] font-sans">PAN (Masked)</div>
                    <div className="text-[#172B4D] font-semibold mt-0.5">
                      {maskPan(profile.pan)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#64748B] font-sans">
                      Section 115BAC Opted
                    </div>
                    <div className="text-[#172B4D] font-semibold mt-0.5">
                      {inspectedDraft.selectedRegime === 'new'
                        ? 'Yes (Default New)'
                        : 'No (Opted Old)'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#64748B] font-sans">
                      Employer TAN (Masked)
                    </div>
                    <div className="text-[#172B4D] font-semibold mt-0.5">
                      {maskPan(profile.employerTan)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#64748B] font-sans">
                      Refund Bank IFSC
                    </div>
                    <div className="text-[#172B4D] font-semibold mt-0.5">
                      {profile.bankIfsc}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#64748B] font-sans">
                      Refund Account (Masked)
                    </div>
                    <div className="text-[#172B4D] font-semibold mt-0.5">
                      {maskAccountNumber(profile.bankAccountNumber)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Part B: Gross Total Income & Deductions */}
              <div className="p-6">
                <h3 className="font-semibold text-[#172B4D] mb-3">
                  Part B &amp; C — Income Summary &amp; Chapter VI-A Deductions
                </h3>
                <div className="space-y-2.5 font-mono tabular-nums">
                  <div className="flex justify-between">
                    <span className="font-sans text-[#64748B]">
                      B1. Net Salary Income (Schedule S)
                    </span>
                    <span className="text-[#172B4D] font-medium">
                      {formatINR(regCalc.netSalaryIncome)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-[#64748B]">
                      B3. Income from Other Sources (Savings{' '}
                      {formatINR(regCalc.savingsInterest)} + FD{' '}
                      {formatINR(regCalc.fdInterest)} + Other{' '}
                      {formatINR(regCalc.otherIncome)})
                    </span>
                    <span className="text-[#172B4D] font-medium">
                      {formatINR(regCalc.incomeFromOtherSources)}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold pt-2 border-t border-[#E2E8F0]">
                    <span className="font-sans text-[#172B4D]">
                      B4. Gross Total Income
                    </span>
                    <span className="text-[#172B4D]">
                      {formatINR(regCalc.grossTotalIncome)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-[#64748B]">
                      Part C. Total Chapter VI-A Deductions (80C + 80CCD + 80D +
                      80TTA)
                    </span>
                    <span className="text-[#64748B]">
                      -{formatINR(regCalc.totalChapterVIADeductions)}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold pt-2 border-t border-[#E2E8F0]">
                    <span className="font-sans text-[#172B4D]">
                      C2. Total Taxable Income (u/s 288A)
                    </span>
                    <span className="text-[#2563EB]">
                      {formatINR(regCalc.taxableIncome)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Part D: Computation of Tax Payable / Refund */}
              <div className="p-6 bg-[#F8FAFC]">
                <h3 className="font-semibold text-[#172B4D] mb-3">
                  Part D — Tax Computation, TDS Credit &amp; Final Settlement
                </h3>
                <div className="space-y-2.5 font-mono tabular-nums">
                  <div className="flex justify-between">
                    <span className="font-sans text-[#64748B]">
                      Tax Payable on Total Income
                    </span>
                    <span className="text-[#172B4D]">
                      {formatINR(regCalc.taxBeforeRebate)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-[#64748B]">
                      Rebate u/s 87A
                    </span>
                    <span className="text-[#64748B]">
                      -{formatINR(regCalc.rebate87A)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-[#64748B]">
                      Health &amp; Education Cess @ 4%
                    </span>
                    <span className="text-[#172B4D]">
                      {formatINR(regCalc.healthAndEducationCess)}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span className="font-sans text-[#172B4D]">
                      Gross Tax Liability
                    </span>
                    <span className="text-[#172B4D]">
                      {formatINR(regCalc.totalTaxLiability)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-[#64748B]">
                      Total Taxes Paid (TDS {formatINR(regCalc.tdsCredited)} +
                      Advance Tax {formatINR(regCalc.advanceTaxPaid)})
                    </span>
                    <span className="text-emerald-700 font-medium">
                      -{formatINR(regCalc.tdsCredited + regCalc.advanceTaxPaid)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-bold pt-3 border-t border-[#E2E8F0]">
                    <span className="font-sans text-[#172B4D]">
                      {regCalc.refundDue > 0
                        ? 'D14. Refund Due to Taxpayer (u/s 288B)'
                        : 'D13. Balance Tax Payable (u/s 288B)'}
                    </span>
                    <span
                      className={
                        regCalc.refundDue > 0
                          ? 'text-emerald-700'
                          : regCalc.netTaxPayable > 0
                            ? 'text-rose-700'
                            : 'text-[#172B4D]'
                      }
                    >
                      {regCalc.refundDue > 0
                        ? formatINR(regCalc.refundDue)
                        : formatINR(regCalc.netTaxPayable)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 bg-white">
              <LightCodeBlock
                title={`ITR1_AY2026_27_Draft_v${inspectedDraft.version}.json (PII Redacted Preview)`}
                code={displayJsonString}
                maxHeightClass="max-h-[560px]"
              />
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
};
