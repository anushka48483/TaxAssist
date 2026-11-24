import React, { useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  FileText,
  Layers,
  Scale,
  UserCheck,
} from 'lucide-react';
import {
  FinancialLedgerEntry,
  ReturnFinancialInputs,
  WorkspaceSnapshot,
} from '../shared/types';
import { formatINR } from '../utils/format';
import {
  Button,
  MetricCard,
  PageHeader,
  SemanticTone,
  StatusIndicator,
  SurfaceCard,
} from './DesignSystem';
import { ReconciliationView } from './ReconciliationView';

interface FinancialSummaryViewProps {
  snapshot: WorkspaceSnapshot;
  onStageUpdate: (
    inputs: Partial<ReturnFinancialInputs>,
    reason: string
  ) => Promise<void>;
  onNavigateToApprovals: () => void;
  onNavigateToTaxComputation: () => void;
}

interface ProvenanceLineItem {
  id: string;
  label: string;
  sublabel?: string;
  amount: number;
  isDeductionOrSubtraction?: boolean;
  isSummaryRow?: boolean;
  provenanceType: 'document_extracted' | 'user_provided' | 'system_calculated';
  sourceDocument?: string;
  pageNumber?: number;
  confidencePct?: number;
  notes?: string;
}

function getSourceBadge(
  sourceType: ProvenanceLineItem['provenanceType']
): { tone: SemanticTone; label: string } {
  if (sourceType === 'document_extracted') {
    return { tone: 'info', label: 'Document Extracted' };
  }
  if (sourceType === 'user_provided') {
    return { tone: 'teal', label: 'User Confirmed' };
  }
  return { tone: 'neutral', label: 'Deterministic Engine' };
}

function findMatchingLedgerEntry(
  ledger: FinancialLedgerEntry[],
  keywords: string[]
): FinancialLedgerEntry | undefined {
  return ledger.find((entry) => {
    const hay = `${entry.category} ${entry.label}`.toLowerCase();
    return keywords.some((kw) => hay.includes(kw.toLowerCase()));
  });
}

export const FinancialSummaryView: React.FC<FinancialSummaryViewProps> = ({
  snapshot,
  onStageUpdate,
  onNavigateToApprovals,
  onNavigateToTaxComputation,
}) => {
  const { activeDraft, ledger, documents } = snapshot;
  const { inputs, taxSummary, selectedRegime } = activeDraft;
  const {
    newRegime,
    oldRegime,
    recommendedRegime,
    netSavingsInRecommended,
  } = taxSummary;

  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const activeCalc = selectedRegime === 'new' ? newRegime : oldRegime;

  const maxTaxForBar = Math.max(
    1,
    newRegime.totalTaxLiability,
    oldRegime.totalTaxLiability,
    inputs.tdsClaimed + (inputs.advanceTax ?? 0)
  );

  const docExtracted = ledger.filter(
    (l) => l.sourceType === 'document_extracted'
  );
  const userProvided = ledger.filter((l) => l.sourceType === 'user_provided');
  const systemCalculated = ledger.filter(
    (l) => l.sourceType === 'system_calculated'
  );

  // Locate real extracted document facts where available for confidence scores
  const findDocFact = (keySubstr: string) => {
    for (const doc of documents) {
      const fact = doc.extractedFacts.find((f) =>
        f.field.toLowerCase().includes(keySubstr.toLowerCase())
      );
      if (fact) {
        return {
          docName: fact.documentName || doc.fileName,
          page: fact.pageNumber,
          confidencePct: Math.round(fact.confidence * 100),
        };
      }
    }
    return undefined;
  };

  const salaryFact = findDocFact('salary');
  const savingsFact = findDocFact('savings');
  const fdFact = findDocFact('fd');
  const sec80CFact = findDocFact('80c');
  const sec80DFact = findDocFact('80d');

  const salaryLedger = findMatchingLedgerEntry(ledger, ['salary']);
  const savingsLedger = findMatchingLedgerEntry(ledger, ['savings']);
  const fdLedger = findMatchingLedgerEntry(ledger, ['fixed deposit', 'fd']);
  const otherLedger = findMatchingLedgerEntry(ledger, ['other']);

  const roundingAdjustment =
    activeCalc.totalIncomeBeforeRounding - activeCalc.taxableIncome;

  const salaryItems: ProvenanceLineItem[] = [
    {
      id: 'sal-gross',
      label: 'Gross Salary u/s 17(1)',
      sublabel: 'Basic pay, allowances, and perquisites reported in Form 16 Part B',
      amount: inputs.grossSalary,
      provenanceType: salaryLedger?.sourceType ?? 'document_extracted',
      sourceDocument:
        salaryFact?.docName ?? salaryLedger?.sourceDocumentName ?? 'Form 16',
      pageNumber: salaryFact?.page ?? salaryLedger?.pageNumber ?? 1,
      confidencePct: salaryFact?.confidencePct,
      notes: salaryLedger?.notes,
    },
    {
      id: 'sal-hra',
      label: 'Exempt Allowances u/s 10 (HRA Exemption)',
      sublabel:
        selectedRegime === 'new'
          ? 'Disallowed under New Regime u/s 115BAC(1A)'
          : 'Eligible House Rent Allowance exemption under Old Regime',
      amount: activeCalc.exemptAllowances,
      isDeductionOrSubtraction: true,
      provenanceType:
        inputs.hraExemption > 0 ? 'user_provided' : 'system_calculated',
      notes: `Claimed input: ${formatINR(inputs.hraExemption)} · Allowed in ${selectedRegime.toUpperCase()} regime: ${formatINR(activeCalc.exemptAllowances)}`,
    },
    {
      id: 'sal-std',
      label: 'Standard Deduction u/s 16(ia)',
      sublabel:
        selectedRegime === 'new'
          ? 'Statutory ₹75,000 cap under New Regime (AY 2026-27)'
          : 'Statutory ₹50,000 cap under Old Regime',
      amount: activeCalc.standardDeduction,
      isDeductionOrSubtraction: true,
      provenanceType: 'system_calculated',
      notes: 'Applied deterministically from AY2026-27.yaml salary rules.',
    },
    {
      id: 'sal-pt',
      label: 'Professional Tax u/s 16(iii)',
      sublabel:
        selectedRegime === 'new'
          ? 'Not deductible under New Regime'
          : 'Deductible under Old Regime',
      amount: activeCalc.professionalTaxDeduction,
      isDeductionOrSubtraction: true,
      provenanceType:
        inputs.professionalTax > 0 ? 'document_extracted' : 'system_calculated',
      notes: `Reported professional tax: ${formatINR(inputs.professionalTax)}`,
    },
    {
      id: 'sal-net',
      label: 'Net Salary Income (Schedule S)',
      amount: activeCalc.netSalaryIncome,
      isSummaryRow: true,
      provenanceType: 'system_calculated',
      notes: 'Gross Salary minus eligible u/s 10 exemptions and u/s 16 deductions.',
    },
  ];

  const otherSourceItems: ProvenanceLineItem[] = [
    {
      id: 'os-savings',
      label: 'Savings Bank Interest',
      sublabel:
        'Tracked separately — eligible for Section 80TTA deduction up to ₹10,000 in Old Regime',
      amount: inputs.savingsInterest,
      provenanceType: savingsLedger?.sourceType ?? 'document_extracted',
      sourceDocument:
        savingsFact?.docName ??
        savingsLedger?.sourceDocumentName ??
        'Bank Statement / AIS',
      pageNumber: savingsFact?.page ?? savingsLedger?.pageNumber ?? 1,
      confidencePct: savingsFact?.confidencePct,
      notes: savingsLedger?.notes,
    },
    {
      id: 'os-fd',
      label: 'Fixed Deposit (FD) Interest',
      sublabel:
        'Taxable under Schedule OS in both regimes · Excluded from Section 80TTA',
      amount: inputs.fdInterest,
      provenanceType: fdLedger?.sourceType ?? 'document_extracted',
      sourceDocument:
        fdFact?.docName ??
        fdLedger?.sourceDocumentName ??
        'Interest Certificate / AIS',
      pageNumber: fdFact?.page ?? fdLedger?.pageNumber ?? 1,
      confidencePct: fdFact?.confidencePct,
      notes: fdLedger?.notes,
    },
    {
      id: 'os-other',
      label: 'Other Taxable Income (Supported)',
      sublabel: 'Freelance / miscellaneous non-capital-gains income reported',
      amount: inputs.otherIncome,
      provenanceType:
        inputs.otherIncome > 0
          ? otherLedger?.sourceType ?? 'user_provided'
          : 'system_calculated',
      sourceDocument: otherLedger?.sourceDocumentName,
      notes:
        otherLedger?.notes ??
        'Confirmed miscellaneous income included in Schedule OS.',
    },
    {
      id: 'os-total',
      label: 'Total Income from Other Sources (Schedule OS)',
      amount: activeCalc.incomeFromOtherSources,
      isSummaryRow: true,
      provenanceType: 'system_calculated',
      notes: 'Savings Bank Interest + Fixed Deposit Interest + Other Income.',
    },
  ];

  const deductionItems: ProvenanceLineItem[] = [
    {
      id: 'ded-80c',
      label: 'Section 80C Investments (PPF, ELSS, LIC, EPF)',
      sublabel: `Claimed: ${formatINR(inputs.section80C)} · Combined 80C + 80CCD(1) cap ₹1,50,000 in Old Regime`,
      amount: activeCalc.eligible80C,
      provenanceType: sec80CFact ? 'document_extracted' : 'user_provided',
      sourceDocument: sec80CFact?.docName ?? 'Investment Proofs / Form 16',
      pageNumber: sec80CFact?.page ?? 1,
      confidencePct: sec80CFact?.confidencePct,
      notes:
        selectedRegime === 'new'
          ? 'Disallowed under New Regime u/s 115BAC(1A).'
          : `Allowed ${formatINR(activeCalc.eligible80C)} under Old Regime.`,
    },
    {
      id: 'ded-80d',
      label: 'Section 80D Health Insurance (Self & Parents)',
      sublabel: `Claimed: ${formatINR(
        inputs.section80D + (inputs.section80DParents ?? 0)
      )} ${inputs.hasSeniorParents ? '(Senior Citizen Parents cap ₹50k)' : ''}`,
      amount: activeCalc.eligible80D,
      provenanceType: sec80DFact ? 'document_extracted' : 'user_provided',
      sourceDocument: sec80DFact?.docName ?? 'Health Insurance Receipt',
      pageNumber: sec80DFact?.page ?? 1,
      confidencePct: sec80DFact?.confidencePct,
      notes:
        selectedRegime === 'new'
          ? 'Disallowed under New Regime u/s 115BAC(1A).'
          : `Allowed ${formatINR(activeCalc.eligible80D)} under Old Regime.`,
    },
    {
      id: 'ded-80tta',
      label: 'Section 80TTA Savings Interest Deduction',
      sublabel: 'Computed strictly on Savings Bank Interest (excludes FD interest)',
      amount: activeCalc.eligible80TTA,
      provenanceType: 'system_calculated',
      notes:
        selectedRegime === 'new'
          ? 'Section 80TTA is not available under New Regime.'
          : `Capped at min(₹10,000, Savings Interest ${formatINR(inputs.savingsInterest)}).`,
    },
    {
      id: 'ded-nps',
      label: 'NPS Deductions — 80CCD(1), 80CCD(1B) & Employer 80CCD(2)',
      sublabel:
        'Employer NPS u/s 80CCD(2) is eligible in both regimes (up to 14% New / 10% Old of Basic)',
      amount:
        activeCalc.eligible80CCD1 +
        activeCalc.eligible80CCD1B +
        activeCalc.eligible80CCD2,
      provenanceType: 'system_calculated',
      notes: `80CCD(1): ${formatINR(activeCalc.eligible80CCD1)} · 80CCD(1B): ${formatINR(
        activeCalc.eligible80CCD1B
      )} · 80CCD(2): ${formatINR(activeCalc.eligible80CCD2)}`,
    },
    {
      id: 'ded-total',
      label: `Total Eligible Chapter VI-A Deductions (${selectedRegime.toUpperCase()} Regime)`,
      amount: activeCalc.totalChapterVIADeductions,
      isSummaryRow: true,
      provenanceType: 'system_calculated',
      notes: 'Sum of statutory Chapter VI-A deductions permitted in active regime.',
    },
  ];

  const taxableIncomeItems: ProvenanceLineItem[] = [
    {
      id: 'ti-gti',
      label: 'Gross Total Income (Net Salary + Other Sources)',
      amount: activeCalc.grossTotalIncome,
      provenanceType: 'system_calculated',
      notes: `${formatINR(activeCalc.netSalaryIncome)} + ${formatINR(
        activeCalc.incomeFromOtherSources
      )}`,
    },
    {
      id: 'ti-ded',
      label: 'Less: Eligible Chapter VI-A Deductions',
      amount: activeCalc.totalChapterVIADeductions,
      isDeductionOrSubtraction: true,
      provenanceType: 'system_calculated',
      notes: `Active regime: ${selectedRegime.toUpperCase()}`,
    },
    {
      id: 'ti-round',
      label: 'Statutory Rounding Adjustment u/s 288A',
      sublabel: 'Total income rounded to nearest multiple of ₹10',
      amount: Math.abs(roundingAdjustment),
      provenanceType: 'system_calculated',
      notes: 'Deterministic rounding u/s 288A of the Income-tax Act.',
    },
    {
      id: 'ti-net',
      label: `Net Taxable Income (${selectedRegime.toUpperCase()} Regime)`,
      amount: activeCalc.taxableIncome,
      isSummaryRow: true,
      provenanceType: 'system_calculated',
      notes: 'Final taxable base passed to slab, 87A rebate, and marginal relief engine.',
    },
  ];

  const renderSectionCard = (
    sectionNumber: string,
    title: string,
    subtitle: string,
    items: ProvenanceLineItem[]
  ) => (
    <SurfaceCard noPadding>
      <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-mono font-semibold text-[#2563EB]">
            {sectionNumber}
          </div>
          <h2 className="text-sm font-semibold text-[#172B4D]">{title}</h2>
          <p className="text-xs text-[#64748B] mt-0.5">{subtitle}</p>
        </div>
        <span className="text-[11px] text-[#64748B]">
          Click any row to inspect provenance
        </span>
      </div>

      <div className="divide-y divide-[#E2E8F0]">
        {items.map((item) => {
          const isOpen = expandedRowId === item.id;
          const badge = getSourceBadge(item.provenanceType);

          return (
            <div
              key={item.id}
              className={item.isSummaryRow ? 'bg-[#F8FAFC]' : 'bg-white'}
            >
              <button
                type="button"
                onClick={() => setExpandedRowId(isOpen ? null : item.id)}
                className="w-full px-6 py-3.5 text-left flex items-center justify-between gap-4 hover:bg-[#F8FAFC]/80 transition-colors cursor-pointer"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 text-[#2563EB] shrink-0 mt-0.5" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-[#64748B] shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div
                      className={`text-xs ${
                        item.isSummaryRow
                          ? 'font-bold text-[#172B4D]'
                          : 'font-medium text-[#172B4D]'
                      }`}
                    >
                      {item.label}
                    </div>
                    {item.sublabel && (
                      <div className="text-[11px] text-[#64748B] mt-0.5">
                        {item.sublabel}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="hidden sm:inline-flex">
                    <StatusIndicator
                      tone={badge.tone}
                      label={badge.label}
                      hideIcon
                    />
                  </span>
                  <span
                    className={`font-mono tabular-nums text-xs sm:text-sm ${
                      item.isSummaryRow
                        ? 'font-bold text-[#2563EB]'
                        : item.isDeductionOrSubtraction
                          ? 'font-semibold text-[#64748B]'
                          : 'font-semibold text-[#172B4D]'
                    }`}
                  >
                    {item.isDeductionOrSubtraction && item.amount > 0
                      ? `− ${formatINR(item.amount)}`
                      : formatINR(item.amount)}
                  </span>
                </div>
              </button>

              {isOpen && (
                <div className="px-6 pb-4 pt-1 pl-12 bg-[#F8FAFC] border-t border-[#E2E8F0]/60 text-xs text-[#64748B] space-y-1.5">
                  <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-[11px]">
                    <span className="text-[#172B4D] font-semibold">
                      Provenance: {badge.label}
                    </span>
                    {item.sourceDocument && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Source Document: {item.sourceDocument}</span>
                      </>
                    )}
                    {item.pageNumber !== undefined && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Page {item.pageNumber}</span>
                      </>
                    )}
                    {item.confidencePct !== undefined && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-emerald-700 font-semibold">
                          OCR Confidence {item.confidencePct}%
                        </span>
                      </>
                    )}
                  </div>
                  {item.notes && <p className="leading-relaxed">{item.notes}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SurfaceCard>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow={
          <>
            <span>DRAFT V{activeDraft.version}</span>
            <span aria-hidden="true">·</span>
            <span>ACTIVE REGIME: {selectedRegime.toUpperCase()}</span>
            <span aria-hidden="true">·</span>
            <span>RECOMMENDED: {recommendedRegime.toUpperCase()}</span>
          </>
        }
        title="Financial Summary, Provenance & Cross-Document Reconciliation"
        description="Structured schedule breakdown separating Salary Income, Savings vs Fixed Deposit Interest, Chapter VI-A Deductions, and Net Taxable Income — with per-field source provenance."
        actions={
          <Button
            variant="primary"
            onClick={onNavigateToTaxComputation}
            rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
          >
            Open Tax Computation &amp; Simulator
          </Button>
        }
        footer={
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <MetricCard
              label="Gross Salary"
              value={formatINR(inputs.grossSalary)}
              subtext={`Std Ded ${formatINR(activeCalc.standardDeduction)}`}
            />
            <MetricCard
              label="Other Sources (Sav + FD + Other)"
              value={formatINR(activeCalc.incomeFromOtherSources)}
              subtext={`Sav ${formatINR(inputs.savingsInterest)} · FD ${formatINR(
                inputs.fdInterest
              )}`}
            />
            <MetricCard
              label={`Deductions (${selectedRegime.toUpperCase()})`}
              value={formatINR(activeCalc.totalChapterVIADeductions)}
              subtext={`80C Input ${formatINR(inputs.section80C)}`}
            />
            <MetricCard
              label={`Taxable Income (${selectedRegime.toUpperCase()})`}
              value={formatINR(activeCalc.taxableIncome)}
              tone="blue"
              subtext={`TDS + Adv ${formatINR(
                activeCalc.tdsCredited + activeCalc.advanceTaxPaid
              )}`}
            />
            <MetricCard
              label={
                activeCalc.refundDue > 0 ? 'Refund Due' : 'Balance Tax Payable'
              }
              value={
                activeCalc.refundDue > 0
                  ? formatINR(activeCalc.refundDue)
                  : formatINR(activeCalc.netTaxPayable)
              }
              tone={
                activeCalc.refundDue > 0
                  ? 'positive'
                  : activeCalc.netTaxPayable > 0
                    ? 'negative'
                    : 'default'
              }
              subtext={`${recommendedRegime.toUpperCase()} saves ${formatINR(
                netSavingsInRecommended
              )}`}
            />
          </div>
        }
      />

      {/* Four Structured Financial Sections + Provenance Ledger */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-6">
          {renderSectionCard(
            'SECTION 01 · SCHEDULE S',
            'Salary Income',
            'Gross salary u/s 17(1), exempt allowances, standard deduction, professional tax, and net salary.',
            salaryItems
          )}

          {renderSectionCard(
            'SECTION 02 · SCHEDULE OS',
            'Income from Other Sources',
            'Separates Savings Bank Interest (80TTA eligible in Old Regime) from Fixed Deposit Interest and other taxable receipts.',
            otherSourceItems
          )}

          {renderSectionCard(
            'SECTION 03 · CHAPTER VI-A',
            'Deductions',
            'Section 80C, Section 80D health insurance, Section 80TTA savings interest, and NPS deductions.',
            deductionItems
          )}

          {renderSectionCard(
            'SECTION 04 · TOTAL INCOME',
            'Taxable Income',
            'Gross total income less eligible deductions and statutory rounding u/s 288A.',
            taxableIncomeItems
          )}
        </div>

        {/* Right Column: Visual Regime Comparison + 3-Tier Provenance Ledger */}
        <div className="lg:col-span-4 space-y-6">
          <SurfaceCard>
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <Scale className="w-4 h-4 text-[#2563EB]" />
                <h2 className="text-sm font-semibold text-[#172B4D]">
                  Regime Liability Comparison
                </h2>
              </div>
              <StatusIndicator
                tone="info"
                label={`${recommendedRegime.toUpperCase()} Optimal`}
                hideIcon
              />
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-3.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
                <div className="flex justify-between gap-2 mb-1.5">
                  <span className="font-semibold text-[#172B4D]">
                    New Regime u/s 115BAC
                  </span>
                  <span className="font-mono tabular-nums font-bold text-[#172B4D]">
                    {formatINR(newRegime.totalTaxLiability)}
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#2563EB] rounded-full transition-all"
                    style={{
                      width: `${Math.max(
                        4,
                        Math.min(
                          100,
                          (newRegime.totalTaxLiability / maxTaxForBar) * 100
                        )
                      )}%`,
                    }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] text-[#64748B] font-mono tabular-nums">
                  <span>Taxable {formatINR(newRegime.taxableIncome)}</span>
                  <span>
                    {newRegime.refundDue > 0
                      ? `Refund ${formatINR(newRegime.refundDue)}`
                      : `Payable ${formatINR(newRegime.netTaxPayable)}`}
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
                <div className="flex justify-between gap-2 mb-1.5">
                  <span className="font-semibold text-[#172B4D]">
                    Old Regime
                  </span>
                  <span className="font-mono tabular-nums font-bold text-[#172B4D]">
                    {formatINR(oldRegime.totalTaxLiability)}
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#0D9488] rounded-full transition-all"
                    style={{
                      width: `${Math.max(
                        4,
                        Math.min(
                          100,
                          (oldRegime.totalTaxLiability / maxTaxForBar) * 100
                        )
                      )}%`,
                    }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] text-[#64748B] font-mono tabular-nums">
                  <span>Taxable {formatINR(oldRegime.taxableIncome)}</span>
                  <span>
                    {oldRegime.refundDue > 0
                      ? `Refund ${formatINR(oldRegime.refundDue)}`
                      : `Payable ${formatINR(oldRegime.netTaxPayable)}`}
                  </span>
                </div>
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard noPadding>
            <div className="px-5 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#2563EB]" />
                <h2 className="text-sm font-semibold text-[#172B4D]">
                  3-Tier Provenance Ledger ({ledger.length})
                </h2>
              </div>
            </div>

            <div className="divide-y divide-[#E2E8F0] text-xs max-h-[560px] overflow-y-auto">
              <div className="p-4 bg-white">
                <div className="flex items-center gap-1.5 font-semibold text-[#172B4D]">
                  <FileText className="w-3.5 h-3.5 text-[#2563EB]" />
                  <span>1. Document-Extracted ({docExtracted.length})</span>
                </div>
                <div className="mt-2.5 space-y-2.5">
                  {docExtracted.length === 0 ? (
                    <p className="text-[#64748B]">
                      No extracted document records yet.
                    </p>
                  ) : (
                    docExtracted.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-[#172B4D] font-medium truncate">
                            {entry.label}
                          </div>
                          <div className="text-[11px] text-[#64748B] font-mono truncate">
                            {entry.sourceDocumentName} · p.
                            {entry.pageNumber ?? 1} · {entry.status}
                          </div>
                        </div>
                        <span className="font-mono tabular-nums font-semibold text-[#172B4D] shrink-0">
                          {formatINR(entry.amount)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="p-4 bg-[#F8FAFC]">
                <div className="flex items-center gap-1.5 font-semibold text-[#172B4D]">
                  <UserCheck className="w-3.5 h-3.5 text-[#0D9488]" />
                  <span>
                    2. User-Provided &amp; Approved ({userProvided.length})
                  </span>
                </div>
                <div className="mt-2.5 space-y-2.5">
                  {userProvided.length === 0 ? (
                    <p className="text-[#64748B]">
                      No approved user additions yet.
                    </p>
                  ) : (
                    userProvided.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-[#172B4D] font-medium truncate">
                            {entry.label}
                          </div>
                          <div className="text-[11px] text-[#64748B] truncate">
                            {entry.notes}
                          </div>
                        </div>
                        <span className="font-mono tabular-nums font-semibold text-[#0D9488] shrink-0">
                          {formatINR(entry.amount)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="p-4 bg-white">
                <div className="font-semibold text-[#172B4D]">
                  3. System-Calculated ({systemCalculated.length})
                </div>
                <div className="mt-2.5 space-y-2">
                  {systemCalculated.map((entry) => (
                    <div key={entry.id} className="flex justify-between gap-3">
                      <span className="text-[#64748B]">{entry.label}</span>
                      <span className="font-mono tabular-nums font-semibold text-[#172B4D]">
                        {formatINR(entry.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SurfaceCard>
        </div>
      </div>

      {/* Cross-Document Reconciliation Matrix */}
      <ReconciliationView
        snapshot={snapshot}
        onStageUpdate={onStageUpdate}
        onNavigateToApprovals={onNavigateToApprovals}
      />
    </div>
  );
};
