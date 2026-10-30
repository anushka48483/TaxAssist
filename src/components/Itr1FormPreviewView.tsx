import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Info,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  FinancialLedgerEntry,
  ProvenanceSourceType,
  TaxRegime,
  WorkspaceSnapshot,
} from '../shared/types';
import {
  formatDateTime,
  formatINR,
  maskAccountNumber,
  maskPan,
  redactSensitiveText,
} from '../utils/format';
import {
  Button,
  PageHeader,
  SegmentedControl,
  SemanticTone,
  StatusIndicator,
  SurfaceCard,
} from './DesignSystem';

interface Itr1FormPreviewViewProps {
  snapshot: WorkspaceSnapshot;
  onNavigateToGeneratedReturn: () => void;
  onNavigateToAssistant: () => void;
  onNavigateToApprovals: () => void;
}

interface FieldProvenanceInfo {
  sourceType: ProvenanceSourceType;
  sourceDocumentName?: string;
  pageNumber?: number;
  confidence?: number;
  verificationStatus: 'confirmed' | 'pending_confirmation' | 'needs_review';
  detailNote: string;
}

const PROVENANCE_BADGE: Record<
  ProvenanceSourceType,
  { tone: SemanticTone; label: string }
> = {
  document_extracted: { tone: 'info', label: 'document_extracted' },
  user_provided: { tone: 'teal', label: 'user_provided' },
  system_calculated: { tone: 'neutral', label: 'system_calculated' },
};

export const Itr1FormPreviewView: React.FC<Itr1FormPreviewViewProps> = ({
  snapshot,
  onNavigateToGeneratedReturn,
  onNavigateToAssistant,
  onNavigateToApprovals,
}) => {
  const {
    profile,
    activeSession,
    activeDraft,
    documents,
    ledger,
    reconciliation,
    approvals,
    ruleVerification,
  } = snapshot;

  const [inspectRegime, setInspectRegime] = useState<TaxRegime>(
    activeDraft.selectedRegime
  );
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null);
  const [changedFields, setChangedFields] = useState<Record<string, boolean>>(
    {}
  );

  useEffect(() => {
    setInspectRegime(activeDraft.selectedRegime);
  }, [activeDraft.selectedRegime, activeDraft.version]);

  const regCalc =
    inspectRegime === 'new'
      ? activeDraft.taxSummary.newRegime
      : activeDraft.taxSummary.oldRegime;

  const otherSupportedDeductionsInput =
    (activeDraft.inputs.section80CCD1 ?? 0) +
    activeDraft.inputs.section80CCD1B +
    (activeDraft.inputs.section80CCD2 ?? 0);

  const otherSupportedDeductionsEligible =
    regCalc.eligible80CCD1 + regCalc.eligible80CCD1B + regCalc.eligible80CCD2;

  const roundingDelta =
    regCalc.taxableIncome - regCalc.totalIncomeBeforeRounding;

  const currentFieldValues = useMemo<Record<string, string | number>>(
    () => ({
      'A.assessmentYear': activeSession.assessmentYear,
      'A.fullName': profile.fullName,
      'A.pan': maskPan(profile.pan),
      'A.residentialStatus': profile.residentialStatus,
      'A.dob': profile.dateOfBirth || '—',
      'A.filingStatus': `${activeDraft.status} · ${inspectRegime.toUpperCase()}`,
      'B.grossSalary': regCalc.grossSalary,
      'B.exemptAllowances': regCalc.exemptAllowances,
      'B.standardDeduction':
        regCalc.standardDeduction + regCalc.professionalTaxDeduction,
      'B.chargeableSalary': regCalc.netSalaryIncome,
      'C.savingsInterest': regCalc.savingsInterest,
      'C.fdInterest': regCalc.fdInterest,
      'C.otherIncome': regCalc.otherIncome,
      'C.totalOtherSources': regCalc.incomeFromOtherSources,
      'D.section80C': regCalc.eligible80C,
      'D.section80D': regCalc.eligible80D,
      'D.section80TTA': regCalc.eligible80TTA,
      'D.otherDeductions': otherSupportedDeductionsEligible,
      'E.grossTotalIncome': regCalc.grossTotalIncome,
      'E.totalDeductions': regCalc.totalChapterVIADeductions,
      'E.rounding288A': roundingDelta,
      'E.taxableIncome': regCalc.taxableIncome,
      'F.oldRegimeTax': activeDraft.taxSummary.oldRegime.totalTaxLiability,
      'F.newRegimeTax': activeDraft.taxSummary.newRegime.totalTaxLiability,
      'F.rebate87A': regCalc.rebate87A,
      'F.marginalRelief': regCalc.marginalReliefApplied ? 'Yes' : 'No',
      'F.cess': regCalc.healthAndEducationCess,
      'F.totalTaxLiability': regCalc.totalTaxLiability,
      'F.tdsCredited': regCalc.tdsCredited + regCalc.advanceTaxPaid,
      'F.netSettlement':
        regCalc.refundDue > 0 ? regCalc.refundDue : -regCalc.netTaxPayable,
    }),
    [
      activeSession.assessmentYear,
      profile,
      activeDraft.status,
      activeDraft.taxSummary,
      inspectRegime,
      regCalc,
      otherSupportedDeductionsEligible,
      roundingDelta,
    ]
  );

  const prevSessionIdRef = useRef<string>(activeSession.id);
  const prevValuesRef =
    useRef<Record<string, string | number>>(currentFieldValues);

  useEffect(() => {
    if (prevSessionIdRef.current !== activeSession.id) {
      prevSessionIdRef.current = activeSession.id;
      prevValuesRef.current = currentFieldValues;
      setChangedFields({});
      return;
    }

    const newlyUpdated: Record<string, boolean> = {};
    for (const [key, val] of Object.entries(currentFieldValues)) {
      if (
        prevValuesRef.current[key] !== undefined &&
        prevValuesRef.current[key] !== val
      ) {
        newlyUpdated[key] = true;
      }
    }
    prevValuesRef.current = currentFieldValues;

    if (Object.keys(newlyUpdated).length > 0) {
      setChangedFields((prev) => ({ ...prev, ...newlyUpdated }));
      const timer = setTimeout(() => {
        setChangedFields({});
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [activeSession.id, currentFieldValues]);

  const resolveProvenance = (
    ledgerFieldKeys: string[],
    fallbackType: ProvenanceSourceType,
    fallbackNote: string
  ): FieldProvenanceInfo => {
    const matchedLedger: FinancialLedgerEntry | undefined =
      ledger.find(
        (l) =>
          ledgerFieldKeys.includes(l.field) && l.sourceType === 'user_provided'
      ) ||
      ledger.find(
        (l) =>
          ledgerFieldKeys.includes(l.field) &&
          l.sourceType === 'document_extracted'
      ) ||
      ledger.find((l) => ledgerFieldKeys.includes(l.field));

    if (matchedLedger) {
      return {
        sourceType: matchedLedger.sourceType,
        sourceDocumentName: matchedLedger.sourceDocumentName,
        pageNumber: matchedLedger.pageNumber,
        confidence: matchedLedger.confidence,
        verificationStatus:
          matchedLedger.status === 'needs_review'
            ? 'needs_review'
            : matchedLedger.status === 'confirmed'
              ? 'confirmed'
              : 'pending_confirmation',
        detailNote: redactSensitiveText(matchedLedger.notes || fallbackNote),
      };
    }

    return {
      sourceType: fallbackType,
      verificationStatus: 'confirmed',
      detailNote: fallbackNote,
    };
  };

  const pendingApprovals = approvals.filter((a) => a.status === 'pending');
  const unconfirmedDocVariances = reconciliation.items.filter(
    (i) => i.resolutionStatus !== 'resolved'
  );
  const lowConfidenceOcrFacts = documents.flatMap((d) =>
    d.extractedFacts
      .filter((f) => f.validationStatus === 'needs_review')
      .map((f) => ({ docName: d.fileName, fact: f }))
  );

  const handleDownloadJson = () => {
    const jsonString = JSON.stringify(activeDraft.itrJson, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ITR1_${profile.pan}_AY2026_27_v${activeDraft.version}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderFormRow = (params: {
    id: string;
    code: string;
    label: string;
    sublabel?: string;
    valueDisplay: string;
    emphasis?: 'normal' | 'total' | 'positive' | 'negative';
    provenance: FieldProvenanceInfo;
  }) => {
    const isHighlighted = Boolean(changedFields[params.id]);
    const isExpanded = expandedFieldId === params.id;
    const badgeMeta = PROVENANCE_BADGE[params.provenance.sourceType];

    const valueColor =
      params.emphasis === 'positive'
        ? 'text-emerald-700 font-bold'
        : params.emphasis === 'negative'
          ? 'text-rose-700 font-bold'
          : params.emphasis === 'total'
            ? 'text-[#2563EB] font-bold'
            : 'text-[#172B4D] font-semibold';

    return (
      <div
        key={params.id}
        className={`transition-colors duration-300 ${
          isHighlighted
            ? 'bg-blue-50/80'
            : params.emphasis === 'total'
              ? 'bg-[#F8FAFC]'
              : 'bg-white hover:bg-[#F8FAFC]/70'
        }`}
      >
        <button
          type="button"
          onClick={() => setExpandedFieldId(isExpanded ? null : params.id)}
          className="w-full text-left px-5 py-3.5 flex items-center justify-between gap-4 cursor-pointer"
        >
          <div className="flex items-start gap-3 min-w-0">
            <span className="font-mono text-[11px] font-semibold text-[#64748B] w-10 shrink-0 pt-0.5">
              {params.code}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={
                    params.emphasis === 'total'
                      ? 'font-bold text-[#172B4D]'
                      : 'font-medium text-[#172B4D]'
                  }
                >
                  {params.label}
                </span>
                {isHighlighted && (
                  <span className="font-mono text-[10px] font-semibold text-[#2563EB]">
                    · Updated in Draft v{activeDraft.version}
                  </span>
                )}
              </div>
              {params.sublabel && (
                <div className="text-[11px] text-[#64748B] mt-0.5">
                  {params.sublabel}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3.5 shrink-0">
            <span className="hidden md:inline-flex items-center gap-1.5">
              <StatusIndicator
                tone={badgeMeta.tone}
                label={
                  params.provenance.sourceDocumentName
                    ? `${badgeMeta.label} · p.${params.provenance.pageNumber ?? 1}`
                    : badgeMeta.label
                }
                hideIcon
                mono
              />
            </span>
            <span className={`font-mono tabular-nums text-xs ${valueColor}`}>
              {params.valueDisplay}
            </span>
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-[#2563EB]" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[#64748B]" />
            )}
          </div>
        </button>

        {isExpanded && (
          <div className="px-5 pb-4 pl-16 text-xs">
            <div className="p-3.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] grid grid-cols-1 sm:grid-cols-4 gap-3 font-mono tabular-nums">
              <div>
                <div className="font-sans text-[11px] text-[#64748B]">
                  Provenance Type
                </div>
                <div className="text-[#172B4D] font-semibold mt-0.5">
                  {params.provenance.sourceType}
                </div>
              </div>
              <div>
                <div className="font-sans text-[11px] text-[#64748B]">
                  Source Evidence
                </div>
                <div className="text-[#172B4D] truncate mt-0.5">
                  {params.provenance.sourceDocumentName
                    ? `${params.provenance.sourceDocumentName} (Page ${
                        params.provenance.pageNumber ?? 1
                      })`
                    : params.provenance.sourceType === 'system_calculated'
                      ? `rules/AY2026-27.yaml (${ruleVerification.rulesVersion})`
                      : 'Session Profile / Approved Input'}
                </div>
              </div>
              <div>
                <div className="font-sans text-[11px] text-[#64748B]">
                  Confidence &amp; Status
                </div>
                <div className="text-[#172B4D] mt-0.5">
                  {typeof params.provenance.confidence === 'number'
                    ? `${Math.round(params.provenance.confidence * 100)}% · `
                    : ''}
                  {params.provenance.verificationStatus}
                </div>
              </div>
              <div>
                <div className="font-sans text-[11px] text-[#64748B]">
                  Derivation / Citation
                </div>
                <div className="font-sans text-[#64748B] mt-0.5">
                  {params.provenance.detailNote}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Mandatory Academic Local Draft Disclaimer — Strictly Light Blue Fintech Surface */}
      <div className="bg-blue-50/70 border border-blue-200 text-[#172B4D] rounded-xl px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
        <div className="flex items-start sm:items-center gap-2.5">
          <Info className="w-4 h-4 text-[#2563EB] shrink-0 mt-0.5 sm:mt-0" />
          <div>
            <span className="font-semibold text-[#172B4D]">
              Local Academic ITR-1 (Sahaj) Draft Preview:{' '}
            </span>
            <span className="text-[#64748B]">
              This visual tax return form is synchronized with your local SQLite
              session for transparent verification — it is not an official
              Income Tax Department e-Filing submission portal.
            </span>
          </div>
        </div>
        <span className="font-mono text-[11px] font-semibold text-[#2563EB] shrink-0">
          Draft v{activeDraft.version} ·{' '}
          {activeDraft.taxSummary.ruleEngineVersion}
        </span>
      </div>

      {/* Form Header & Live Synchronization Controls */}
      <PageHeader
        eyebrow={
          <>
            <span>INDIAN INCOME TAX RETURN · FORM ITR-1 (SAHAJ)</span>
            <span aria-hidden="true">·</span>
            <span>{activeSession.assessmentYear}</span>
            <span aria-hidden="true">·</span>
            <span>UPDATED {formatDateTime(activeDraft.createdAt)}</span>
          </>
        }
        title="ITR-1 (Sahaj) Live Auto-Populated Form & Provenance Inspector"
        description="Populates automatically from verified session state as documents are extracted, reconciled, and approved. Click any row to inspect its source document, page citation, OCR confidence, and statutory rule."
        actions={
          <>
            <SegmentedControl
              ariaLabel="Inspect ITR-1 schedule under regime"
              value={inspectRegime}
              onChange={setInspectRegime}
              options={[
                { value: 'new', label: 'New Regime (115BAC)' },
                { value: 'old', label: 'Old Regime' },
              ]}
            />
            <Button
              variant="outline"
              onClick={onNavigateToGeneratedReturn}
              icon={<FileSpreadsheet className="w-3.5 h-3.5" />}
            >
              Raw JSON Schema
            </Button>
            <Button
              variant="primary"
              onClick={handleDownloadJson}
              icon={<Download className="w-3.5 h-3.5" />}
            >
              Export Draft JSON
            </Button>
          </>
        }
        footer={
          pendingApprovals.length > 0 || unconfirmedDocVariances.length > 0 ? (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs bg-amber-50/80 border border-amber-200 rounded-lg px-4 py-3 text-amber-950">
              <div>
                {pendingApprovals.length > 0 ? (
                  <span>
                    <strong>{pendingApprovals.length} staged update(s)</strong>{' '}
                    are waiting at SecurityGateway. Approve them to populate
                    those figures into this ITR-1 form.
                  </span>
                ) : (
                  <span>
                    <strong>
                      {unconfirmedDocVariances.length} extracted document
                      item(s)
                    </strong>{' '}
                    (such as bank/FD interest or 80C proofs) are awaiting
                    confirmation before modifying the return.
                  </span>
                )}
              </div>
              {pendingApprovals.length > 0 ? (
                <button
                  type="button"
                  onClick={onNavigateToApprovals}
                  className="font-semibold text-[#2563EB] hover:underline inline-flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  Review Pending Approvals
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onNavigateToAssistant}
                  className="font-semibold text-[#2563EB] hover:underline inline-flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  Confirm in AI Assistant
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : undefined
        }
      />

      {/* SECTION A — Personal Information */}
      <SurfaceCard noPadding>
        <div className="px-5 py-3.5 bg-[#F8FAFC] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#172B4D]">
            Section A — Personal Information (Part A General)
          </h2>
          <StatusIndicator
            tone="teal"
            label="PII Masked for Safe Display"
            hideIcon
          />
        </div>

        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs bg-white">
          <div>
            <div className="text-[#64748B]">A1. Assessment Year</div>
            <div className="font-mono font-semibold text-[#172B4D] mt-0.5">
              {activeSession.assessmentYear} ({activeSession.financialYear})
            </div>
          </div>
          <div>
            <div className="text-[#64748B]">A2. Taxpayer Name</div>
            <div className="font-semibold text-[#172B4D] mt-0.5">
              {profile.fullName}
            </div>
          </div>
          <div>
            <div className="text-[#64748B]">
              A3. Permanent Account Number (Masked)
            </div>
            <div className="font-mono font-semibold text-[#172B4D] mt-0.5">
              {maskPan(profile.pan)}
            </div>
          </div>
          <div>
            <div className="text-[#64748B]">A4. Residential Status</div>
            <div className="font-medium text-[#172B4D] mt-0.5">
              {profile.residentialStatus}
            </div>
          </div>
          <div>
            <div className="text-[#64748B]">A5. Date of Birth</div>
            <div className="font-mono text-[#172B4D] mt-0.5">
              {profile.dateOfBirth || 'Not provided'}
            </div>
          </div>
          <div>
            <div className="text-[#64748B]">
              A6. Filing Status &amp; Refund Account
            </div>
            <div className="font-mono text-[#172B4D] mt-0.5">
              u/s 139(1) · {activeDraft.status} ·{' '}
              {maskAccountNumber(profile.bankAccountNumber)} ({profile.bankIfsc})
            </div>
          </div>
        </div>
      </SurfaceCard>

      {/* SECTION B — Salary Income */}
      <SurfaceCard noPadding>
        <div className="px-5 py-3.5 bg-[#F8FAFC] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#172B4D]">
            Section B — Salary Income (Schedule S)
          </h2>
          <span className="font-mono text-[11px] text-[#64748B]">
            Employer: {profile.employerName}
          </span>
        </div>
        <div className="divide-y divide-[#E2E8F0]">
          {renderFormRow({
            id: 'B.grossSalary',
            code: 'B1',
            label: 'Gross Salary u/s 17(1)',
            sublabel: 'Salary, perquisites, and profits in lieu of salary',
            valueDisplay: formatINR(regCalc.grossSalary),
            provenance: resolveProvenance(
              ['grossSalary'],
              'document_extracted',
              'Baseline Schedule S salary from Form 16 Part B'
            ),
          })}
          {renderFormRow({
            id: 'B.exemptAllowances',
            code: 'B2',
            label: 'Less: Exempt Allowances u/s 10',
            sublabel:
              inspectRegime === 'new'
                ? 'HRA u/s 10(13A) not applicable under New Regime 115BAC(1A)'
                : 'Eligible HRA u/s 10(13A) and exempt allowances under Old Regime',
            valueDisplay: `-${formatINR(regCalc.exemptAllowances)}`,
            provenance: resolveProvenance(
              ['hraExemption'],
              'system_calculated',
              'Computed per regime eligibility rules in rules/AY2026-27.yaml'
            ),
          })}
          {renderFormRow({
            id: 'B.standardDeduction',
            code: 'B3',
            label:
              'Less: Standard Deduction u/s 16(ia) & Professional Tax u/s 16(iii)',
            sublabel:
              inspectRegime === 'new'
                ? `Standard Deduction ${formatINR(regCalc.standardDeduction)} (u/s 115BAC(1A))`
                : `Standard Deduction ${formatINR(regCalc.standardDeduction)} + Professional Tax ${formatINR(
                    regCalc.professionalTaxDeduction
                  )}`,
            valueDisplay: `-${formatINR(
              regCalc.standardDeduction + regCalc.professionalTaxDeduction
            )}`,
            provenance: {
              sourceType: 'system_calculated',
              verificationStatus: 'confirmed',
              detailNote: `Statutory standard deduction (${
                inspectRegime === 'new' ? '₹75,000' : '₹50,000'
              }) from rules/AY2026-27.yaml`,
            },
          })}
          {renderFormRow({
            id: 'B.chargeableSalary',
            code: 'B4',
            label: 'Income Chargeable under the Head “Salaries”',
            valueDisplay: formatINR(regCalc.netSalaryIncome),
            emphasis: 'total',
            provenance: {
              sourceType: 'system_calculated',
              verificationStatus: 'confirmed',
              detailNote:
                'Deterministic formula: max(0, Gross Salary − Exempt u/s 10 − Deductions u/s 16)',
            },
          })}
        </div>
      </SurfaceCard>

      {/* SECTION C — Income from Other Sources */}
      <SurfaceCard noPadding>
        <div className="px-5 py-3.5 bg-[#F8FAFC] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#172B4D]">
            Section C — Income from Other Sources (Schedule OS)
          </h2>
          <StatusIndicator
            tone="teal"
            label="Savings & FD Interest Strictly Separated"
            hideIcon
          />
        </div>
        <div className="divide-y divide-[#E2E8F0]">
          {renderFormRow({
            id: 'C.savingsInterest',
            code: 'C1',
            label: 'Interest from Savings Bank Accounts',
            sublabel:
              'Reported separately; eligible for Section 80TTA deduction up to ₹10,000 in Old Regime',
            valueDisplay: formatINR(regCalc.savingsInterest),
            provenance: resolveProvenance(
              ['savingsInterest', 'savingsBankInterest'],
              'document_extracted',
              'Savings account credit interest reconciled from Bank Statement'
            ),
          })}
          {renderFormRow({
            id: 'C.fdInterest',
            code: 'C2',
            label: 'Interest from Fixed Deposits (Term Deposits)',
            sublabel:
              'Reported separately; fully taxable in both regimes and strictly excluded from Section 80TTA',
            valueDisplay: formatINR(regCalc.fdInterest),
            provenance: resolveProvenance(
              ['fdInterest'],
              'document_extracted',
              'Term deposit interest reconciled from Fixed Deposit Interest Certificate'
            ),
          })}
          {renderFormRow({
            id: 'C.otherIncome',
            code: 'C3',
            label: 'Other Supported Taxable Interest / Income',
            sublabel: 'Other ITR-1 eligible income from other sources',
            valueDisplay: formatINR(regCalc.otherIncome),
            provenance: resolveProvenance(
              ['otherIncome'],
              'user_provided',
              'Additional ITR-1 eligible income confirmed in session'
            ),
          })}
          {renderFormRow({
            id: 'C.totalOtherSources',
            code: 'C4',
            label: 'Total Income from Other Sources (C1 + C2 + C3)',
            valueDisplay: formatINR(regCalc.incomeFromOtherSources),
            emphasis: 'total',
            provenance: {
              sourceType: 'system_calculated',
              verificationStatus: 'confirmed',
              detailNote:
                'Deterministic sum of Savings Interest + FD Interest + Other Income',
            },
          })}
        </div>
      </SurfaceCard>

      {/* SECTION D — Chapter VI-A Deductions */}
      <SurfaceCard noPadding>
        <div className="px-5 py-3.5 bg-[#F8FAFC] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#172B4D]">
            Section D — Chapter VI-A Deductions ({inspectRegime.toUpperCase()}{' '}
            Regime Eligibility)
          </h2>
          <span className="font-mono text-[11px] text-[#64748B]">
            {inspectRegime === 'new'
              ? 'Only u/s 80CCD(2) allowed in New Regime'
              : '80C, 80D, 80TTA & NPS caps enforced'}
          </span>
        </div>
        <div className="divide-y divide-[#E2E8F0]">
          {renderFormRow({
            id: 'D.section80C',
            code: 'D1',
            label: 'Section 80C Investments (PPF, ELSS, EPF, Life Insurance)',
            sublabel: `Claimed in return: ${formatINR(
              activeDraft.inputs.section80C
            )} · Statutory Old Regime cap ₹1,50,000`,
            valueDisplay: formatINR(regCalc.eligible80C),
            provenance: resolveProvenance(
              ['section80C', 'section80CProofTotal', 'section80CDeclared'],
              'document_extracted',
              'Verified against Section 80C Investment Proof & Form 16'
            ),
          })}
          {renderFormRow({
            id: 'D.section80D',
            code: 'D2',
            label: 'Section 80D Health Insurance Premia (Self, Family & Parents)',
            sublabel: `Claimed in return: ${formatINR(
              activeDraft.inputs.section80D +
                (activeDraft.inputs.section80DParents ?? 0)
            )}`,
            valueDisplay: formatINR(regCalc.eligible80D),
            provenance: resolveProvenance(
              ['section80D', 'section80DProofTotal'],
              'user_provided',
              'Verified health insurance deduction subject to Section 80D caps'
            ),
          })}
          {renderFormRow({
            id: 'D.section80TTA',
            code: 'D3',
            label: 'Section 80TTA Deduction on Savings Bank Interest',
            sublabel:
              inspectRegime === 'new'
                ? 'Not allowable under Section 115BAC(1A) New Regime'
                : 'Min(Savings Bank Interest, ₹10,000) — excludes Fixed Deposit interest',
            valueDisplay: formatINR(regCalc.eligible80TTA),
            provenance: {
              sourceType: 'system_calculated',
              verificationStatus: 'confirmed',
              detailNote:
                'Auto-derived strictly from verified Savings Bank Interest (FD interest excluded)',
            },
          })}
          {renderFormRow({
            id: 'D.otherDeductions',
            code: 'D4',
            label:
              'Other Supported NPS Deductions (80CCD(1), 80CCD(1B), 80CCD(2))',
            sublabel: `Claimed in return: ${formatINR(otherSupportedDeductionsInput)}`,
            valueDisplay: formatINR(otherSupportedDeductionsEligible),
            provenance: resolveProvenance(
              ['section80CCD2', 'section80CCD1B', 'section80CCD1'],
              'system_calculated',
              'Evaluated against statutory NPS caps in rules/AY2026-27.yaml'
            ),
          })}
        </div>
      </SurfaceCard>

      {/* SECTION E — Total Income */}
      <SurfaceCard noPadding>
        <div className="px-5 py-3.5 bg-[#F8FAFC] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#172B4D]">
            Section E — Computation of Total Taxable Income
          </h2>
          <span className="font-mono text-[11px] text-[#64748B]">
            Section 288A Nearest ₹10 Rounding
          </span>
        </div>
        <div className="divide-y divide-[#E2E8F0]">
          {renderFormRow({
            id: 'E.grossTotalIncome',
            code: 'E1',
            label: 'Gross Total Income (B4 + C4)',
            valueDisplay: formatINR(regCalc.grossTotalIncome),
            provenance: {
              sourceType: 'system_calculated',
              verificationStatus: 'confirmed',
              detailNote:
                'Chargeable Salary + Total Income from Other Sources',
            },
          })}
          {renderFormRow({
            id: 'E.totalDeductions',
            code: 'E2',
            label: 'Less: Total Eligible Chapter VI-A Deductions',
            valueDisplay: `-${formatINR(regCalc.totalChapterVIADeductions)}`,
            provenance: {
              sourceType: 'system_calculated',
              verificationStatus: 'confirmed',
              detailNote: 'Sum of regime-eligible deductions in Section D',
            },
          })}
          {renderFormRow({
            id: 'E.rounding288A',
            code: 'E3',
            label: 'Rounding Adjustment u/s 288A',
            sublabel: `Unrounded Total Income: ${formatINR(
              regCalc.totalIncomeBeforeRounding
            )}`,
            valueDisplay: formatINR(roundingDelta),
            provenance: {
              sourceType: 'system_calculated',
              verificationStatus: 'confirmed',
              detailNote:
                'Total income rounded to nearest multiple of ₹10 u/s 288A',
            },
          })}
          {renderFormRow({
            id: 'E.taxableIncome',
            code: 'E4',
            label: 'Total Taxable Income',
            valueDisplay: formatINR(regCalc.taxableIncome),
            emphasis: 'total',
            provenance: resolveProvenance(
              ['taxableIncome'],
              'system_calculated',
              `Deterministic YAML Engine (${activeDraft.taxSummary.ruleEngineVersion})`
            ),
          })}
        </div>
      </SurfaceCard>

      {/* SECTION F — Tax Computation */}
      <SurfaceCard noPadding>
        <div className="px-5 py-3.5 bg-[#F8FAFC] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#172B4D]">
            Section F — Deterministic Tax Computation &amp; TDS Settlement
          </h2>
          <StatusIndicator
            tone="info"
            label={`Optimal: ${activeDraft.taxSummary.recommendedRegime.toUpperCase()} (saves ${formatINR(
              activeDraft.taxSummary.netSavingsInRecommended
            )})`}
            mono
          />
        </div>
        <div className="divide-y divide-[#E2E8F0]">
          {renderFormRow({
            id: 'F.oldRegimeTax',
            code: 'F1',
            label: 'Reference: Old Tax Regime Total Tax Liability',
            sublabel: `Old Regime Taxable Income: ${formatINR(
              activeDraft.taxSummary.oldRegime.taxableIncome
            )}`,
            valueDisplay: formatINR(
              activeDraft.taxSummary.oldRegime.totalTaxLiability
            ),
            provenance: {
              sourceType: 'system_calculated',
              verificationStatus: 'confirmed',
              detailNote:
                'Computed via Old Regime slabs + 4% Cess in rules/AY2026-27.yaml',
            },
          })}
          {renderFormRow({
            id: 'F.newRegimeTax',
            code: 'F2',
            label:
              'Reference: New Tax Regime (u/s 115BAC(1A)) Total Tax Liability',
            sublabel: `New Regime Taxable Income: ${formatINR(
              activeDraft.taxSummary.newRegime.taxableIncome
            )} · Slab tax before 87A: ${formatINR(
              activeDraft.taxSummary.newRegime.taxBeforeRebate
            )}`,
            valueDisplay: formatINR(
              activeDraft.taxSummary.newRegime.totalTaxLiability
            ),
            provenance: {
              sourceType: 'system_calculated',
              verificationStatus: 'confirmed',
              detailNote:
                'Computed via Finance Act 2025 Section 115BAC(1A) slabs in rules/AY2026-27.yaml',
            },
          })}
          {renderFormRow({
            id: 'F.rebate87A',
            code: 'F3',
            label: `Section 87A Rebate (${inspectRegime.toUpperCase()} Regime)`,
            sublabel:
              inspectRegime === 'new'
                ? 'Up to ₹60,000 rebate when New Regime taxable income ≤ ₹12,00,000'
                : 'Up to ₹12,500 rebate when Old Regime taxable income ≤ ₹5,00,000',
            valueDisplay: `-${formatINR(regCalc.rebate87A)}`,
            provenance: {
              sourceType: 'system_calculated',
              verificationStatus: 'confirmed',
              detailNote:
                'Deterministic Section 87A rebate check from rules/AY2026-27.yaml',
            },
          })}
          {renderFormRow({
            id: 'F.marginalRelief',
            code: 'F4',
            label: 'Section 87A Marginal Relief Applied',
            sublabel:
              'Caps tax above ₹12,00,000 in New Regime to excess income over ₹12,00,000',
            valueDisplay: regCalc.marginalReliefApplied
              ? 'Yes (Applied)'
              : 'No (Not Triggered)',
            provenance: {
              sourceType: 'system_calculated',
              verificationStatus: 'confirmed',
              detailNote: 'Evaluated deterministically in server/taxEngine.ts',
            },
          })}
          {renderFormRow({
            id: 'F.cess',
            code: 'F5',
            label: 'Health & Education Cess @ 4%',
            valueDisplay: formatINR(regCalc.healthAndEducationCess),
            provenance: {
              sourceType: 'system_calculated',
              verificationStatus: 'confirmed',
              detailNote: '4% statutory cess on tax after Section 87A rebate',
            },
          })}
          {renderFormRow({
            id: 'F.totalTaxLiability',
            code: 'F6',
            label: `Total Tax Liability (${inspectRegime.toUpperCase()} Regime)`,
            valueDisplay: formatINR(regCalc.totalTaxLiability),
            emphasis: 'total',
            provenance: resolveProvenance(
              ['totalTaxLiability'],
              'system_calculated',
              'Tax after Rebate + 4% Health & Education Cess'
            ),
          })}
          {renderFormRow({
            id: 'F.tdsCredited',
            code: 'F7',
            label: 'Less: Verified TDS & Advance Tax Paid',
            sublabel: `TDS ${formatINR(regCalc.tdsCredited)} + Advance Tax ${formatINR(
              regCalc.advanceTaxPaid
            )}`,
            valueDisplay: `-${formatINR(
              regCalc.tdsCredited + regCalc.advanceTaxPaid
            )}`,
            provenance: resolveProvenance(
              ['tdsClaimed', 'tdsOnSalary'],
              'document_extracted',
              'Verified TDS credit from Form 16 / Form 26AS'
            ),
          })}
          {renderFormRow({
            id: 'F.netSettlement',
            code: 'F8',
            label:
              regCalc.refundDue > 0
                ? 'Final Net Refund Due to Taxpayer (u/s 288B)'
                : 'Final Balance Tax Payable (u/s 288B)',
            valueDisplay:
              regCalc.refundDue > 0
                ? formatINR(regCalc.refundDue)
                : formatINR(regCalc.netTaxPayable),
            emphasis:
              regCalc.refundDue > 0
                ? 'positive'
                : regCalc.netTaxPayable > 0
                  ? 'negative'
                  : 'total',
            provenance: {
              sourceType: 'system_calculated',
              verificationStatus: 'confirmed',
              detailNote: 'Rounded to nearest ₹10 under Section 288B',
            },
          })}
        </div>
      </SurfaceCard>

      {/* SECTION G — Verification & Validation */}
      <SurfaceCard noPadding>
        <div className="px-5 py-3.5 bg-[#F8FAFC] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#172B4D]">
            Section G — Verification, Mandatory Validation &amp; YAML Rule
            Integrity
          </h2>
          <div className="font-mono tabular-nums text-xs text-[#64748B]">
            {activeDraft.validation.passCount} Passed ·{' '}
            {activeDraft.validation.warningCount} Warnings ·{' '}
            {activeDraft.validation.errorCount} Errors
          </div>
        </div>

        <div className="p-5 space-y-5 text-xs bg-white">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
              <div className="text-[#64748B]">Draft Validation Status</div>
              <div className="mt-1.5 font-semibold text-[#172B4D] flex items-center gap-1.5">
                {activeDraft.validation.isValid &&
                activeDraft.validation.unsupportedScenarios.length === 0 ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>Valid ({activeDraft.status})</span>
                  </>
                ) : (
                  <>
                    <AlertOctagon className="w-4 h-4 text-rose-700 shrink-0" />
                    <span>Action Required ({activeDraft.status})</span>
                  </>
                )}
              </div>
            </div>

            <div className="p-4 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
              <div className="text-[#64748B]">YAML Statutory Rule Engine</div>
              <div className="mt-1.5 font-mono font-semibold text-[#172B4D] flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#2563EB] shrink-0" />
                <span>
                  v{ruleVerification.rulesVersion} (
                  {ruleVerification.totalSourcesCited} CBDT citations)
                </span>
              </div>
              <div className="text-[11px] text-[#64748B] mt-0.5">
                {ruleVerification.governingAct}
              </div>
            </div>

            <div className="p-4 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
              <div className="text-[#64748B]">
                OCR &amp; Unsupported Scope Guard
              </div>
              <div className="mt-1.5 font-semibold text-[#172B4D]">
                {activeDraft.validation.unsupportedScenarios.length > 0
                  ? `${activeDraft.validation.unsupportedScenarios.length} Unsupported Flag(s)`
                  : lowConfidenceOcrFacts.length > 0
                    ? `${lowConfidenceOcrFacts.length} Low-Confidence OCR Item(s) Held`
                    : '0 Unsupported Flags · OCR Clean'}
              </div>
              <div className="text-[11px] text-[#64748B] mt-0.5">
                Low-confidence OCR never overwrites verified return values
              </div>
            </div>
          </div>

          {activeDraft.validation.unsupportedScenarios.length > 0 && (
            <div className="p-4 rounded-lg bg-rose-50/90 border border-rose-200 space-y-1.5">
              <div className="font-semibold text-rose-900">
                Unsupported ITR-1 (Sahaj) Income / Scope Warnings
              </div>
              {activeDraft.validation.unsupportedScenarios.map((u) => (
                <div key={u.code} className="text-rose-800">
                  <span className="font-mono font-semibold">{u.code}</span>:{' '}
                  {u.reason} (Use {u.recommendedItrForm})
                </div>
              ))}
            </div>
          )}

          <div className="border border-[#E2E8F0] rounded-lg divide-y divide-[#E2E8F0]">
            {activeDraft.validation.issues.map((issue) => (
              <div
                key={issue.code}
                className="px-4 py-3 flex items-start gap-2.5 bg-white"
              >
                {issue.severity === 'pass' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                ) : issue.severity === 'warning' ? (
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-[#172B4D]">
                      {issue.code}
                    </span>
                    <span className="text-[#E2E8F0]">·</span>
                    <span className="font-mono text-[11px] text-[#64748B]">
                      {issue.field}
                    </span>
                  </div>
                  <p className="text-[#64748B] mt-0.5">{issue.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
};
