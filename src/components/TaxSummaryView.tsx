import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Calculator,
  CheckCircle2,
  Info,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import {
  RegimeTaxComputation,
  ReturnFinancialInputs,
  TaxComparisonSummary,
  TaxRegime,
  WorkspaceSnapshot,
} from '../shared/types';
import { formatINR } from '../utils/format';
import {
  Button,
  PageHeader,
  SegmentedControl,
  StatusIndicator,
  SurfaceCard,
} from './DesignSystem';

interface TaxSummaryViewProps {
  snapshot: WorkspaceSnapshot;
  onCalculatePreview: (
    inputs: ReturnFinancialInputs
  ) => Promise<TaxComparisonSummary>;
  onStageUpdate: (
    inputs: Partial<ReturnFinancialInputs>,
    reason: string,
    selectedRegime?: TaxRegime
  ) => Promise<void>;
  onNavigateToApprovals: () => void;
}

export const TaxSummaryView: React.FC<TaxSummaryViewProps> = ({
  snapshot,
  onCalculatePreview,
  onStageUpdate,
  onNavigateToApprovals,
}) => {
  const { activeDraft, ruleVerification } = snapshot;
  const [simInputs, setSimInputs] = useState<ReturnFinancialInputs>(
    activeDraft.inputs
  );
  const [simRegime, setSimRegime] = useState<TaxRegime>(
    activeDraft.selectedRegime
  );
  const [previewSummary, setPreviewSummary] = useState<TaxComparisonSummary>(
    activeDraft.taxSummary
  );
  const [staging, setStaging] = useState(false);
  const [stagedBanner, setStagedBanner] = useState<string | null>(null);
  const [slabRegimeTab, setSlabRegimeTab] = useState<TaxRegime>('new');

  useEffect(() => {
    setSimInputs(activeDraft.inputs);
    setSimRegime(activeDraft.selectedRegime);
    setPreviewSummary(activeDraft.taxSummary);
  }, [
    activeDraft.id,
    activeDraft.inputs,
    activeDraft.selectedRegime,
    activeDraft.taxSummary,
  ]);

  const handleFieldChange = async (
    field: keyof ReturnFinancialInputs,
    raw: string
  ) => {
    const val = Math.max(0, Number(raw.replace(/[^0-9]/g, '')) || 0);
    const next = { ...simInputs, [field]: val };
    setSimInputs(next);
    const computed = await onCalculatePreview(next);
    setPreviewSummary(computed);
  };

  const handleBooleanChange = async (
    field: keyof ReturnFinancialInputs,
    checked: boolean
  ) => {
    const next = { ...simInputs, [field]: checked };
    setSimInputs(next);
    const computed = await onCalculatePreview(next);
    setPreviewSummary(computed);
  };

  const handleReset = () => {
    setSimInputs(activeDraft.inputs);
    setSimRegime(activeDraft.selectedRegime);
    setPreviewSummary(activeDraft.taxSummary);
    setStagedBanner(null);
  };

  const handleStageChanges = async () => {
    setStaging(true);
    setStagedBanner(null);
    try {
      await onStageUpdate(
        simInputs,
        `Taxpayer staged deterministic computation update (${simRegime.toUpperCase()} regime selected).`,
        simRegime
      );
      setStagedBanner(
        'Staged updated income, deductions, and regime selection in the SecurityGateway Approval Center.'
      );
    } finally {
      setStaging(false);
    }
  };

  const {
    newRegime,
    oldRegime,
    recommendedRegime,
    netSavingsInRecommended,
    ruleEngineVersion,
  } = previewSummary;

  const buildRecommendationReason = (): string => {
    if (netSavingsInRecommended === 0) {
      return 'Both tax regimes result in identical total tax liability for the current income and deduction profile.';
    }
    if (recommendedRegime === 'new') {
      return `New Tax Regime u/s 115BAC(1A) saves ${formatINR(
        netSavingsInRecommended
      )} because expanded progressive slabs, ₹75,000 standard deduction${
        newRegime.rebate87A > 0
          ? `, and Section 87A rebate (${formatINR(newRegime.rebate87A)})`
          : ''
      } outweigh Old Regime Chapter VI-A deductions (${formatINR(
        oldRegime.totalChapterVIADeductions
      )}).`;
    }
    return `Old Tax Regime saves ${formatINR(
      netSavingsInRecommended
    )} because eligible HRA/exemptions (${formatINR(
      oldRegime.exemptAllowances
    )}) and Chapter VI-A deductions (${formatINR(
      oldRegime.totalChapterVIADeductions
    )}) reduce taxable income to ${formatINR(oldRegime.taxableIncome)}.`;
  };

  const comparisonRows: Array<{
    label: string;
    newVal: number;
    oldVal: number;
    bold?: boolean;
    highlight?: boolean;
  }> = [
    {
      label: 'Gross Salary u/s 17(1)',
      newVal: newRegime.grossSalary,
      oldVal: oldRegime.grossSalary,
    },
    {
      label: 'Less: Exempt Allowances (HRA u/s 10(13A))',
      newVal: -newRegime.exemptAllowances,
      oldVal: -oldRegime.exemptAllowances,
    },
    {
      label: 'Less: Standard Deduction u/s 16(ia)',
      newVal: -newRegime.standardDeduction,
      oldVal: -oldRegime.standardDeduction,
    },
    {
      label: 'Less: Professional Tax u/s 16(iii)',
      newVal: -newRegime.professionalTaxDeduction,
      oldVal: -oldRegime.professionalTaxDeduction,
    },
    {
      label: 'Net Salary Income (Schedule S)',
      newVal: newRegime.netSalaryIncome,
      oldVal: oldRegime.netSalaryIncome,
      bold: true,
    },
    {
      label: 'Savings Bank Interest (Schedule OS)',
      newVal: newRegime.savingsInterest,
      oldVal: oldRegime.savingsInterest,
    },
    {
      label: 'Fixed Deposit Interest (Schedule OS · Non-80TTA)',
      newVal: newRegime.fdInterest,
      oldVal: oldRegime.fdInterest,
    },
    {
      label: 'Other Taxable Income',
      newVal: newRegime.otherIncome,
      oldVal: oldRegime.otherIncome,
    },
    {
      label: 'Gross Total Income (GTI)',
      newVal: newRegime.grossTotalIncome,
      oldVal: oldRegime.grossTotalIncome,
      bold: true,
    },
    {
      label: 'Less: Section 80C + 80CCD(1) (Combined ₹1.5L Cap)',
      newVal: -(newRegime.eligible80C + newRegime.eligible80CCD1),
      oldVal: -(oldRegime.eligible80C + oldRegime.eligible80CCD1),
    },
    {
      label: 'Less: Section 80CCD(1B) Self NPS (Cap ₹50,000)',
      newVal: -newRegime.eligible80CCD1B,
      oldVal: -oldRegime.eligible80CCD1B,
    },
    {
      label: 'Less: Section 80CCD(2) Employer NPS (Both Regimes)',
      newVal: -newRegime.eligible80CCD2,
      oldVal: -oldRegime.eligible80CCD2,
    },
    {
      label: 'Less: Section 80D Health Insurance (Self + Parents)',
      newVal: -newRegime.eligible80D,
      oldVal: -oldRegime.eligible80D,
    },
    {
      label: 'Less: Section 80TTA Savings Interest (Cap ₹10,000)',
      newVal: -newRegime.eligible80TTA,
      oldVal: -oldRegime.eligible80TTA,
    },
    {
      label: 'Net Taxable Income (Rounded u/s 288A)',
      newVal: newRegime.taxableIncome,
      oldVal: oldRegime.taxableIncome,
      bold: true,
    },
    {
      label: 'Slab Tax Before Rebate',
      newVal: newRegime.taxBeforeRebate,
      oldVal: oldRegime.taxBeforeRebate,
    },
    {
      label: `Less: Rebate u/s 87A${
        newRegime.marginalReliefApplied || oldRegime.marginalReliefApplied
          ? ' (Marginal Relief Checked)'
          : ''
      }`,
      newVal: -newRegime.rebate87A,
      oldVal: -oldRegime.rebate87A,
    },
    {
      label: 'Add: Health & Education Cess @ 4%',
      newVal: newRegime.healthAndEducationCess,
      oldVal: oldRegime.healthAndEducationCess,
    },
    {
      label: 'Total Tax Liability',
      newVal: newRegime.totalTaxLiability,
      oldVal: oldRegime.totalTaxLiability,
      bold: true,
      highlight: true,
    },
    {
      label: 'Less: Verified TDS + Advance Tax Paid',
      newVal: -(newRegime.tdsCredited + newRegime.advanceTaxPaid),
      oldVal: -(oldRegime.tdsCredited + oldRegime.advanceTaxPaid),
    },
  ];

  const activeSlabBreakdown =
    slabRegimeTab === 'new'
      ? newRegime.slabBreakdown
      : oldRegime.slabBreakdown;

  const numericFields: Array<[keyof ReturnFinancialInputs, string]> = [
    ['grossSalary', 'Gross Salary u/s 17(1)'],
    ['basicSalary', 'Basic Salary Component'],
    ['hraExemption', 'HRA Exemption u/s 10(13A)'],
    ['professionalTax', 'Professional Tax u/s 16(iii)'],
    ['savingsInterest', 'Savings Bank Interest (80TTA)'],
    ['fdInterest', 'Fixed Deposit Interest (Non-80TTA)'],
    ['otherIncome', 'Other Taxable Income (OS)'],
    ['section80C', 'Section 80C Investments'],
    ['section80CCD1', 'Section 80CCD(1) Employee NPS'],
    ['section80CCD1B', 'Section 80CCD(1B) Self NPS'],
    ['section80CCD2', 'Section 80CCD(2) Employer NPS'],
    ['section80D', 'Section 80D Health (Self/Family)'],
    ['section80DParents', 'Section 80D Health (Parents)'],
    ['tdsClaimed', 'Verified TDS Credit (26AS)'],
    ['advanceTax', 'Advance / Self-Assessment Tax'],
  ];

  const renderRegimeSummaryCard = (
    regimeKey: TaxRegime,
    title: string,
    subtitle: string,
    calc: RegimeTaxComputation
  ) => {
    const isRecommended = recommendedRegime === regimeKey;
    const isSelected = simRegime === regimeKey;

    return (
      <div
        className={`rounded-xl overflow-hidden transition-colors ${
          isRecommended
            ? 'bg-white border-2 border-[#2563EB] shadow-[0_2px_8px_rgba(37,99,235,0.08)]'
            : 'bg-white border border-[#E2E8F0]'
        }`}
      >
        <div
          className={`px-6 py-4 border-b flex flex-wrap items-center justify-between gap-2 ${
            isRecommended
              ? 'bg-blue-50/70 border-blue-200'
              : 'bg-[#F8FAFC] border-[#E2E8F0]'
          }`}
        >
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-[#172B4D]">{title}</h2>
              {isRecommended && (
                <StatusIndicator tone="info" label="Recommended Optimal" />
              )}
            </div>
            <p className="text-xs text-[#64748B] mt-0.5">{subtitle}</p>
          </div>

          <Button
            size="sm"
            variant={isSelected ? 'primary' : 'outline'}
            onClick={() => setSimRegime(regimeKey)}
            icon={
              isSelected ? <CheckCircle2 className="w-3.5 h-3.5" /> : undefined
            }
          >
            {isSelected ? 'Selected for Draft' : 'Select Regime'}
          </Button>
        </div>

        <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <div className="text-[#64748B]">Gross Total Income</div>
            <div className="text-sm font-bold text-[#172B4D] font-mono tabular-nums mt-1">
              {formatINR(calc.grossTotalIncome)}
            </div>
          </div>
          <div>
            <div className="text-[#64748B]">Eligible Deductions</div>
            <div className="text-sm font-bold text-[#172B4D] font-mono tabular-nums mt-1">
              {formatINR(calc.totalChapterVIADeductions)}
            </div>
          </div>
          <div>
            <div className="text-[#64748B]">Net Taxable Income</div>
            <div className="text-sm font-bold text-[#2563EB] font-mono tabular-nums mt-1">
              {formatINR(calc.taxableIncome)}
            </div>
          </div>
          <div>
            <div className="text-[#64748B]">Total Tax Liability</div>
            <div className="text-sm font-bold text-[#172B4D] font-mono tabular-nums mt-1">
              {formatINR(calc.totalTaxLiability)}
            </div>
          </div>
        </div>

        <div className="px-6 py-3 bg-[#F8FAFC] border-t border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
          <span className="text-[#64748B]">
            Std Ded {formatINR(calc.standardDeduction)} · Rebate 87A{' '}
            {formatINR(calc.rebate87A)} · Cess{' '}
            {formatINR(calc.healthAndEducationCess)}
          </span>
          <span
            className={`font-bold ${
              calc.refundDue > 0
                ? 'text-emerald-700'
                : calc.netTaxPayable > 0
                  ? 'text-rose-700'
                  : 'text-[#172B4D]'
            }`}
          >
            {calc.refundDue > 0
              ? `Refund Due: ${formatINR(calc.refundDue)}`
              : `Balance Payable: ${formatINR(calc.netTaxPayable)}`}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Deterministic Engine Header */}
      <PageHeader
        eyebrow={
          <>
            <span>{ruleEngineVersion}</span>
            <span aria-hidden="true">·</span>
            <span>rules/AY2026-27.yaml</span>
            <span aria-hidden="true">·</span>
            <span>100% DETERMINISTIC ENGINE (ZERO LLM MATH)</span>
          </>
        }
        title="Deterministic Tax Computation & Regime Comparison (AY 2026-27)"
        description={buildRecommendationReason()}
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleReset}
              icon={<RotateCcw className="w-3.5 h-3.5" />}
            >
              Reset to Saved Draft
            </Button>
            <Button
              variant="primary"
              loading={staging}
              onClick={handleStageChanges}
              icon={<ShieldCheck className="w-3.5 h-3.5" />}
            >
              Stage into Return via Gateway
            </Button>
          </>
        }
      />

      {stagedBanner && (
        <div className="px-5 py-3.5 rounded-xl bg-blue-50/90 border border-blue-200 flex flex-wrap items-center justify-between gap-3 text-xs text-[#172B4D]">
          <span>{stagedBanner}</span>
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

      {/* Side-by-Side Regime Summary Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {renderRegimeSummaryCard(
          'new',
          'New Tax Regime u/s 115BAC(1A)',
          'Default AY 2026-27 regime · ₹75,000 standard deduction · Rebate up to ₹12L taxable income',
          newRegime
        )}
        {renderRegimeSummaryCard(
          'old',
          'Old Tax Regime',
          'Allows HRA u/s 10(13A), ₹50,000 standard deduction, 80C, 80D, 80CCD(1B) & 80TTA',
          oldRegime
        )}
      </div>

      {/* Main Workspace Grid: Simulator + Full Statutory Comparison Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 5 Columns: Interactive Deterministic Inputs & Slab Breakdown */}
        <SurfaceCard className="lg:col-span-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E2E8F0]">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[#2563EB]" />
              <h2 className="text-sm font-semibold text-[#172B4D]">
                Interactive Financial Simulator (INR)
              </h2>
            </div>
            <SegmentedControl
              ariaLabel="Select active regime for staging"
              value={simRegime}
              onChange={setSimRegime}
              options={[
                { value: 'new', label: 'New Regime' },
                { value: 'old', label: 'Old Regime' },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
            {numericFields.map(([key, label]) => (
              <div
                key={key}
                className={key === 'advanceTax' ? 'sm:col-span-2' : ''}
              >
                <label className="block font-medium text-[#172B4D] mb-1">
                  {label}
                </label>
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={(simInputs[key] as number | undefined) ?? 0}
                  onChange={(e) => handleFieldChange(key, e.target.value)}
                  className="w-full px-3 py-2 font-mono tabular-nums text-[#172B4D] bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB]"
                />
              </div>
            ))}
          </div>

          <div className="pt-2 space-y-2.5 text-xs border-t border-[#E2E8F0]">
            <label className="flex items-center justify-between gap-2 cursor-pointer pt-2">
              <span className="text-[#172B4D]">
                Senior Citizen Parents (60+ yrs → ₹50,000 80D Parent Cap)
              </span>
              <input
                type="checkbox"
                checked={Boolean(simInputs.hasSeniorParents)}
                onChange={(e) =>
                  handleBooleanChange('hasSeniorParents', e.target.checked)
                }
                className="rounded border-[#E2E8F0] text-[#2563EB]"
              />
            </label>
            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <span className="text-[#172B4D]">
                Central/State Govt Employer (14% 80CCD(2) Cap in Old Regime)
              </span>
              <input
                type="checkbox"
                checked={Boolean(simInputs.isGovernmentEmployer)}
                onChange={(e) =>
                  handleBooleanChange('isGovernmentEmployer', e.target.checked)
                }
                className="rounded border-[#E2E8F0] text-[#2563EB]"
              />
            </label>
          </div>

          {/* Slab-by-Slab Breakdown Table */}
          <div className="pt-4 border-t border-[#E2E8F0]">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-xs font-semibold text-[#172B4D]">
                Progressive Slab Computation
              </h3>
              <SegmentedControl
                ariaLabel="Inspect progressive slabs"
                value={slabRegimeTab}
                onChange={setSlabRegimeTab}
                options={[
                  { value: 'new', label: 'New Slabs' },
                  { value: 'old', label: 'Old Slabs' },
                ]}
              />
            </div>

            <div className="rounded-lg border border-[#E2E8F0] overflow-hidden">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B]">
                    <th className="py-2 px-3 text-left font-medium">
                      Income Slab
                    </th>
                    <th className="py-2 px-3 text-right font-medium">
                      Taxable
                    </th>
                    <th className="py-2 px-3 text-right font-medium">Rate</th>
                    <th className="py-2 px-3 text-right font-medium">Tax</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] font-mono tabular-nums bg-white">
                  {activeSlabBreakdown.map((row) => (
                    <tr key={row.slabLabel}>
                      <td className="py-2 px-3 text-[#172B4D] font-sans">
                        {row.slabLabel}
                      </td>
                      <td className="py-2 px-3 text-right text-[#64748B]">
                        {formatINR(row.taxableInSlab)}
                      </td>
                      <td className="py-2 px-3 text-right text-[#64748B]">
                        {row.ratePercent}%
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-[#172B4D]">
                        {formatINR(row.taxAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </SurfaceCard>

        {/* Right 7 Columns: Side-by-Side Statutory Comparison Matrix + Rule Provenance */}
        <div className="lg:col-span-7 space-y-6">
          <SurfaceCard noPadding>
            <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[#172B4D]">
                Statutory Line-by-Line Computation Matrix
              </h2>
              <StatusIndicator
                tone="info"
                label={`Active Choice: ${simRegime.toUpperCase()}`}
                mono
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]">
                    <th className="py-3 px-6 font-semibold">
                      Computation Line Item
                    </th>
                    <th
                      className={`py-3 px-5 font-semibold text-right ${
                        recommendedRegime === 'new' ? 'text-[#2563EB]' : ''
                      }`}
                    >
                      New Regime {recommendedRegime === 'new' ? '· Optimal' : ''}
                    </th>
                    <th
                      className={`py-3 px-6 font-semibold text-right ${
                        recommendedRegime === 'old' ? 'text-[#2563EB]' : ''
                      }`}
                    >
                      Old Regime {recommendedRegime === 'old' ? '· Optimal' : ''}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] bg-white">
                  {comparisonRows.map((row) => (
                    <tr
                      key={row.label}
                      className={
                        row.highlight
                          ? 'bg-[#F8FAFC] font-bold'
                          : row.bold
                            ? 'font-semibold bg-[#F8FAFC]/60'
                            : 'hover:bg-[#F8FAFC]/50'
                      }
                    >
                      <td className="py-2.5 px-6 text-[#172B4D]">{row.label}</td>
                      <td className="py-2.5 px-5 text-right font-mono tabular-nums text-[#172B4D]">
                        {formatINR(row.newVal)}
                      </td>
                      <td className="py-2.5 px-6 text-right font-mono tabular-nums text-[#172B4D]">
                        {formatINR(row.oldVal)}
                      </td>
                    </tr>
                  ))}

                  {/* Final Settlement Row — Strictly Light Blue Fintech Accent */}
                  <tr className="bg-blue-50/80 border-t-2 border-blue-200 text-[#172B4D] font-bold">
                    <td className="py-3.5 px-6">
                      Final Settlement u/s 288B (Refund Due / Balance Payable)
                    </td>
                    <td
                      className={`py-3.5 px-5 text-right font-mono tabular-nums ${
                        newRegime.refundDue > 0
                          ? 'text-emerald-700'
                          : newRegime.netTaxPayable > 0
                            ? 'text-rose-700'
                            : 'text-[#172B4D]'
                      }`}
                    >
                      {newRegime.refundDue > 0
                        ? `Refund ${formatINR(newRegime.refundDue)}`
                        : `Payable ${formatINR(newRegime.netTaxPayable)}`}
                    </td>
                    <td
                      className={`py-3.5 px-6 text-right font-mono tabular-nums ${
                        oldRegime.refundDue > 0
                          ? 'text-emerald-700'
                          : oldRegime.netTaxPayable > 0
                            ? 'text-rose-700'
                            : 'text-[#172B4D]'
                      }`}
                    >
                      {oldRegime.refundDue > 0
                        ? `Refund ${formatINR(oldRegime.refundDue)}`
                        : `Payable ${formatINR(oldRegime.netTaxPayable)}`}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </SurfaceCard>

          {/* Transparent YAML Rule Verification Metadata */}
          <SurfaceCard className="text-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold text-[#172B4D]">
                <Info className="w-4 h-4 text-[#2563EB] shrink-0" />
                <span>
                  Rule Source Transparency ({ruleVerification.governingAct} · v
                  {ruleVerification.rulesVersion})
                </span>
              </div>
              <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
                Verified on {ruleVerification.verifiedOn}
              </span>
            </div>
            <p className="text-[#64748B] leading-relaxed">
              Loaded from{' '}
              <code className="font-mono text-[#172B4D] bg-[#F8FAFC] px-1.5 py-0.5 rounded border border-[#E2E8F0]">
                rules/AY2026-27.yaml
              </code>{' '}
              ({ruleVerification.totalSourcesCited} CBDT statutory citations).
              {ruleVerification.verificationWarning
                ? ` ${ruleVerification.verificationWarning}`
                : ''}
            </p>
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
};
