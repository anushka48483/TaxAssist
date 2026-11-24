import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { TaxComparisonSummary, TaxRegime } from '../shared/types';
import { formatINR } from '../utils/format';
import { Button, SegmentedControl } from './DesignSystem';

interface TaxBreakdownModalProps {
  open: boolean;
  onClose: () => void;
  summary: TaxComparisonSummary;
  selectedRegime: TaxRegime;
}

export const TaxBreakdownModal: React.FC<TaxBreakdownModalProps> = ({
  open,
  onClose,
  summary,
  selectedRegime,
}) => {
  const [slabTab, setSlabTab] = useState<TaxRegime>(selectedRegime);

  useEffect(() => {
    setSlabTab(selectedRegime);
  }, [selectedRegime, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const { newRegime, oldRegime, recommendedRegime, netSavingsInRecommended } = summary;
  const activeSlabCalc = slabTab === 'new' ? newRegime : oldRegime;

  const rows: Array<{
    label: string;
    newVal: number;
    oldVal: number;
    bold?: boolean;
    highlight?: boolean;
  }> = [
    { label: 'Gross Salary', newVal: newRegime.grossSalary, oldVal: oldRegime.grossSalary },
    { label: 'Less: HRA & Exempt Allowances', newVal: -newRegime.exemptAllowances, oldVal: -oldRegime.exemptAllowances },
    { label: 'Less: Standard Deduction', newVal: -newRegime.standardDeduction, oldVal: -oldRegime.standardDeduction },
    { label: 'Less: Professional Tax', newVal: -newRegime.professionalTaxDeduction, oldVal: -oldRegime.professionalTaxDeduction },
    { label: 'Net Salary Income', newVal: newRegime.netSalaryIncome, oldVal: oldRegime.netSalaryIncome, bold: true },
    { label: 'Savings Bank Interest', newVal: newRegime.savingsInterest, oldVal: oldRegime.savingsInterest },
    { label: 'Fixed Deposit Interest', newVal: newRegime.fdInterest, oldVal: oldRegime.fdInterest },
    { label: 'Other Income', newVal: newRegime.otherIncome, oldVal: oldRegime.otherIncome },
    { label: 'Gross Total Income', newVal: newRegime.grossTotalIncome, oldVal: oldRegime.grossTotalIncome, bold: true },
    { label: 'Less: Section 80C', newVal: -newRegime.eligible80C, oldVal: -oldRegime.eligible80C },
    { label: 'Less: NPS (80CCD(1) & 80CCD(1B))', newVal: -(newRegime.eligible80CCD1 + newRegime.eligible80CCD1B), oldVal: -(oldRegime.eligible80CCD1 + oldRegime.eligible80CCD1B) },
    { label: 'Less: Employer NPS (80CCD(2))', newVal: -newRegime.eligible80CCD2, oldVal: -oldRegime.eligible80CCD2 },
    { label: 'Less: Health Insurance (80D)', newVal: -newRegime.eligible80D, oldVal: -oldRegime.eligible80D },
    { label: 'Less: Savings Interest (80TTA)', newVal: -newRegime.eligible80TTA, oldVal: -oldRegime.eligible80TTA },
    { label: 'Taxable Income (Rounded)', newVal: newRegime.taxableIncome, oldVal: oldRegime.taxableIncome, bold: true, highlight: true },
    { label: 'Tax Before Rebate', newVal: newRegime.taxBeforeRebate, oldVal: oldRegime.taxBeforeRebate },
    { label: 'Less: Section 87A Rebate', newVal: -newRegime.rebate87A, oldVal: -oldRegime.rebate87A },
    { label: 'Health & Education Cess (4%)', newVal: newRegime.healthAndEducationCess, oldVal: oldRegime.healthAndEducationCess },
    { label: 'Total Tax Liability', newVal: newRegime.totalTaxLiability, oldVal: oldRegime.totalTaxLiability, bold: true, highlight: true },
    { label: 'Less: TDS & Advance Tax Paid', newVal: -(newRegime.tdsCredited + newRegime.advanceTaxPaid), oldVal: -(oldRegime.tdsCredited + oldRegime.advanceTaxPaid) },
  ];

  const formatCell = (val: number) => {
    if (val < 0) return `−${formatINR(Math.abs(val))}`;
    return formatINR(val);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tax-breakdown-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#172B4D]/25"
    >
      <div className="bg-white border border-[#E2E8F0] rounded-xl max-w-3xl w-full max-h-[88vh] flex flex-col shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-start justify-between gap-4 shrink-0">
          <div>
            <h2 id="tax-breakdown-title" className="text-base font-semibold text-[#172B4D]">
              Tax Calculation Breakdown ({summary.assessmentYear})
            </h2>
            <p className="text-xs text-[#64748B] mt-0.5">
              {netSavingsInRecommended > 0
                ? `${recommendedRegime === 'new' ? 'New Regime' : 'Old Regime'} saves ${formatINR(netSavingsInRecommended)} compared to the alternative.`
                : 'Both regimes result in identical tax liability for your current numbers.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close breakdown"
            className="p-1.5 text-[#64748B] hover:text-[#172B4D] rounded-lg hover:bg-[#F8FAFC] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="border border-[#E2E8F0] rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold text-[#64748B]">
                    Component
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-[#172B4D]">
                    New Regime {selectedRegime === 'new' ? '(Selected)' : ''}
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-[#172B4D]">
                    Old Regime {selectedRegime === 'old' ? '(Selected)' : ''}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {rows.map((row) => (
                  <tr
                    key={row.label}
                    className={row.highlight ? 'bg-[#F8FAFC]' : 'bg-white'}
                  >
                    <td
                      className={`px-4 py-2 ${
                        row.bold ? 'font-semibold text-[#172B4D]' : 'text-[#64748B]'
                      }`}
                    >
                      {row.label}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono tabular-nums ${
                        row.bold ? 'font-semibold text-[#172B4D]' : 'text-[#172B4D]'
                      }`}
                    >
                      {formatCell(row.newVal)}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono tabular-nums ${
                        row.bold ? 'font-semibold text-[#172B4D]' : 'text-[#172B4D]'
                      }`}
                    >
                      {formatCell(row.oldVal)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[#F8FAFC] font-semibold">
                  <td className="px-4 py-2.5 text-[#172B4D]">
                    Net Refund Due / Balance Payable
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[#0D9488]">
                    {newRegime.refundDue > 0
                      ? `Refund ${formatINR(newRegime.refundDue)}`
                      : newRegime.netTaxPayable > 0
                        ? `Pay ${formatINR(newRegime.netTaxPayable)}`
                        : '₹0'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[#0D9488]">
                    {oldRegime.refundDue > 0
                      ? `Refund ${formatINR(oldRegime.refundDue)}`
                      : oldRegime.netTaxPayable > 0
                        ? `Pay ${formatINR(oldRegime.netTaxPayable)}`
                        : '₹0'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-[#172B4D]">
                Slab-by-Slab Tax Breakdown
              </h3>
              <SegmentedControl
                ariaLabel="Select regime slabs"
                value={slabTab}
                onChange={setSlabTab}
                options={[
                  { value: 'new', label: 'New Regime Slabs' },
                  { value: 'old', label: 'Old Regime Slabs' },
                ]}
              />
            </div>

            <div className="border border-[#E2E8F0] rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold text-[#64748B]">
                      Income Bracket
                    </th>
                    <th className="text-right px-4 py-2 font-semibold text-[#64748B]">
                      Rate
                    </th>
                    <th className="text-right px-4 py-2 font-semibold text-[#64748B]">
                      Taxed Amount
                    </th>
                    <th className="text-right px-4 py-2 font-semibold text-[#64748B]">
                      Tax
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {activeSlabCalc.slabBreakdown.map((slab) => (
                    <tr key={slab.slabLabel}>
                      <td className="px-4 py-2 text-[#172B4D]">{slab.slabLabel}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums text-[#64748B]">
                        {slab.ratePercent}%
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums text-[#172B4D]">
                        {formatINR(slab.taxableInSlab)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums font-medium text-[#172B4D]">
                        {formatINR(slab.taxAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="px-6 py-3.5 border-t border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] font-mono text-[#64748B]">
            Calculated deterministically from {summary.ruleEngineVersion}
          </span>
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
};
