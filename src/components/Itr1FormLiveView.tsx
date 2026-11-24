import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit3,
  FileText,
  Lock,
  Sparkles,
  X,
} from 'lucide-react';
import {
  FieldFillingState,
  FieldVerificationStatus,
  WorkspaceSnapshot,
} from '../shared/types';
import { formatINR, maskAccountNumber, maskPan } from '../utils/format';
import { Button, StatusIndicator } from './DesignSystem';

export interface FieldActionPayload {
  fieldKey: string;
  action: 'confirm' | 'edit' | 'reject';
  numericValue?: number;
  stringValue?: string;
  reason?: string;
}

interface Itr1FormLiveViewProps {
  snapshot: WorkspaceSnapshot;
  activeFieldKey: string | null;
  recentlyUpdatedFieldKeys: string[];
  focusedSectionCode?: string | null;
  onFieldAction: (payload: FieldActionPayload) => Promise<void>;
}

interface FormRowDef {
  fieldKey: string;
  label: string;
  valueDisplay: string;
  rawNumeric?: number;
  rawString?: string;
  isNumeric?: boolean;
  editable?: boolean;
  calculated?: boolean;
  required?: boolean;
  sourceHint?: string;
  defaultStatus?: FieldVerificationStatus;
  explanation?: string;
}

interface SectionDef {
  code: string;
  title: string;
  subtitle: string;
  rows: FormRowDef[];
}

function getFieldBadge(status: FieldVerificationStatus, isActiveNow: boolean) {
  if (isActiveNow) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-[#2563EB] border border-blue-200">
        <Sparkles className="w-3 h-3" />
        Updating
      </span>
    );
  }
  switch (status) {
    case 'verified':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
          <CheckCircle2 className="w-3 h-3" />
          Verified
        </span>
      );
    case 'user_edited':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-[#2563EB] border border-blue-200">
          <Edit3 className="w-3 h-3" />
          Edited by you
        </span>
      );
    case 'pending_confirmation':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
          <AlertTriangle className="w-3 h-3" />
          Confirm to add
        </span>
      );
    case 'needs_review':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
          <AlertTriangle className="w-3 h-3" />
          Needs review
        </span>
      );
    case 'calculated':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[#F8FAFC] text-[#64748B] border border-[#E2E8F0]">
          Calculated
        </span>
      );
    case 'rejected':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[#F8FAFC] text-[#64748B] border border-[#E2E8F0]">
          Excluded
        </span>
      );
    case 'missing':
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200">
          Missing
        </span>
      );
  }
}

export const Itr1FormLiveView: React.FC<Itr1FormLiveViewProps> = ({
  snapshot,
  activeFieldKey,
  recentlyUpdatedFieldKeys,
  focusedSectionCode,
  onFieldAction,
}) => {
  const { profile, activeDraft, fieldStates = {} } = snapshot;
  const inputs = activeDraft.inputs;
  const calc =
    activeDraft.selectedRegime === 'new'
      ? activeDraft.taxSummary.newRegime
      : activeDraft.taxSummary.oldRegime;

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [selectedField, setSelectedField] = useState<FormRowDef | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [editReason, setEditReason] = useState<string>('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const sections: SectionDef[] = useMemo(
    () => [
      {
        code: 'A',
        title: 'Section A · Personal Information',
        subtitle: 'Taxpayer identity & contact details',
        rows: [
          {
            fieldKey: 'fullName',
            label: 'Full Name (as per PAN)',
            valueDisplay: profile.fullName || 'Not provided',
            rawString: profile.fullName,
            editable: true,
            required: true,
            defaultStatus: profile.fullName ? 'verified' : 'missing',
            sourceHint: 'Taxpayer Profile',
          },
          {
            fieldKey: 'pan',
            label: 'PAN',
            valueDisplay: profile.pan ? maskPan(profile.pan) : 'Not provided',
            rawString: profile.pan,
            editable: true,
            required: true,
            defaultStatus: profile.pan ? 'verified' : 'missing',
            sourceHint: 'Taxpayer Profile (masked in view)',
          },
          {
            fieldKey: 'aadhaarLast4',
            label: 'Aadhaar (Last 4 Digits)',
            valueDisplay: profile.aadhaarLast4 ? `XXXXXXXX${profile.aadhaarLast4}` : 'Not provided',
            rawString: profile.aadhaarLast4,
            editable: true,
            required: true,
            defaultStatus: profile.aadhaarLast4 ? 'verified' : 'missing',
            sourceHint: 'Taxpayer Profile',
          },
          {
            fieldKey: 'dateOfBirth',
            label: 'Date of Birth',
            valueDisplay: profile.dateOfBirth || 'Not provided',
            rawString: profile.dateOfBirth,
            editable: true,
            required: true,
            defaultStatus: profile.dateOfBirth ? 'verified' : 'missing',
            sourceHint: 'Taxpayer Profile',
          },
          {
            fieldKey: 'email',
            label: 'Email Address',
            valueDisplay: profile.email || 'Not provided',
            rawString: profile.email,
            editable: true,
            required: true,
            defaultStatus: profile.email ? 'verified' : 'missing',
            sourceHint: 'Taxpayer Profile',
          },
          {
            fieldKey: 'phone',
            label: 'Mobile Number',
            valueDisplay: profile.phone || 'Not provided',
            rawString: profile.phone,
            editable: true,
            required: true,
            defaultStatus: profile.phone ? 'verified' : 'missing',
            sourceHint: 'Taxpayer Profile',
          },
          {
            fieldKey: 'address',
            label: 'Residential Address',
            valueDisplay: profile.address || 'Not provided',
            rawString: profile.address || '',
            editable: true,
            defaultStatus: profile.address ? 'verified' : 'missing',
            sourceHint: 'Taxpayer Profile',
          },
        ],
      },
      {
        code: 'B',
        title: 'Section B · Filing Information',
        subtitle: 'Assessment year, section, & tax regime',
        rows: [
          {
            fieldKey: 'assessmentYear',
            label: 'Assessment Year',
            valueDisplay: 'AY 2026-27 (FY 2025-26)',
            calculated: true,
            defaultStatus: 'calculated',
            sourceHint: 'Return Session',
          },
          {
            fieldKey: 'filingSection',
            label: 'Filing Section',
            valueDisplay: '139(1) · On or before due date',
            calculated: true,
            defaultStatus: 'calculated',
            sourceHint: 'ITR-1 Standard',
          },
          {
            fieldKey: 'residentialStatus',
            label: 'Residential Status',
            valueDisplay: profile.residentialStatus,
            calculated: true,
            defaultStatus: 'verified',
            sourceHint: 'ITR-1 Eligible Resident',
          },
          {
            fieldKey: 'preferredRegime',
            label: 'Selected Tax Regime',
            valueDisplay:
              activeDraft.selectedRegime === 'new'
                ? 'New Regime (u/s 115BAC)'
                : 'Old Regime (with deductions)',
            rawString: activeDraft.selectedRegime,
            defaultStatus: 'verified',
            sourceHint:
              activeDraft.selectedRegime === activeDraft.taxSummary.recommendedRegime
                ? 'Recommended for lowest tax'
                : 'User selection',
          },
        ],
      },
      {
        code: 'C',
        title: 'Section C · Salary Income',
        subtitle: 'Employer details, salary & standard deduction',
        rows: [
          {
            fieldKey: 'employerName',
            label: 'Employer Name',
            valueDisplay: profile.employerName || 'Not provided',
            rawString: profile.employerName,
            editable: true,
            defaultStatus: profile.employerName ? 'verified' : 'missing',
            sourceHint: 'Form 16 / Profile',
          },
          {
            fieldKey: 'employerTan',
            label: 'Employer TAN',
            valueDisplay: profile.employerTan || 'Not provided',
            rawString: profile.employerTan,
            editable: true,
            defaultStatus: profile.employerTan ? 'verified' : 'missing',
            sourceHint: 'Form 16 / Profile',
          },
          {
            fieldKey: 'grossSalary',
            label: 'Gross Salary u/s 17(1)',
            valueDisplay: formatINR(inputs.grossSalary),
            rawNumeric: inputs.grossSalary,
            isNumeric: true,
            editable: true,
            required: true,
            defaultStatus: inputs.grossSalary > 0 ? 'verified' : 'missing',
            sourceHint: 'Form 16',
          },
          {
            fieldKey: 'basicSalary',
            label: 'Basic Salary',
            valueDisplay: formatINR(inputs.basicSalary),
            rawNumeric: inputs.basicSalary,
            isNumeric: true,
            editable: true,
            defaultStatus: inputs.basicSalary > 0 ? 'verified' : 'calculated',
            sourceHint: 'Form 16 / Salary Slips',
          },
          {
            fieldKey: 'hraExemption',
            label: 'Exempt Allowances / HRA u/s 10',
            valueDisplay: formatINR(calc.exemptAllowances),
            rawNumeric: inputs.hraExemption,
            isNumeric: true,
            editable: true,
            defaultStatus: 'calculated',
            explanation:
              activeDraft.selectedRegime === 'new'
                ? 'HRA exemption is not allowed under the New Regime.'
                : 'Exempt allowances applied under Old Regime.',
          },
          {
            fieldKey: 'standardDeduction',
            label: 'Standard Deduction u/s 16(ia)',
            valueDisplay: formatINR(calc.standardDeduction),
            calculated: true,
            defaultStatus: 'calculated',
            sourceHint:
              activeDraft.selectedRegime === 'new'
                ? '₹75,000 automatic under New Regime'
                : '₹50,000 automatic under Old Regime',
          },
          {
            fieldKey: 'professionalTax',
            label: 'Professional Tax u/s 16(iii)',
            valueDisplay: formatINR(calc.professionalTaxDeduction),
            rawNumeric: inputs.professionalTax,
            isNumeric: true,
            editable: true,
            defaultStatus: 'calculated',
            explanation:
              activeDraft.selectedRegime === 'new'
                ? 'Professional tax deduction applies only in the Old Regime.'
                : 'Deducted from salary under Section 16(iii).',
          },
          {
            fieldKey: 'netSalaryIncome',
            label: 'Net Taxable Salary',
            valueDisplay: formatINR(calc.netSalaryIncome),
            calculated: true,
            defaultStatus: 'calculated',
            sourceHint: 'Calculated automatically',
          },
        ],
      },
      {
        code: 'D',
        title: 'Section D · Income from Other Sources',
        subtitle: 'Savings interest & FD interest kept strictly separate',
        rows: [
          {
            fieldKey: 'savingsInterest',
            label: 'Savings Bank Interest',
            valueDisplay: formatINR(inputs.savingsInterest),
            rawNumeric: inputs.savingsInterest,
            isNumeric: true,
            editable: true,
            defaultStatus: inputs.savingsInterest > 0 ? 'verified' : 'calculated',
            explanation:
              'Eligible for Section 80TTA deduction up to ₹10,000 under the Old Regime.',
          },
          {
            fieldKey: 'fdInterest',
            label: 'Fixed Deposit (FD) Interest',
            valueDisplay: formatINR(inputs.fdInterest),
            rawNumeric: inputs.fdInterest,
            isNumeric: true,
            editable: true,
            defaultStatus: inputs.fdInterest > 0 ? 'verified' : 'calculated',
            explanation:
              'Fully taxable in both regimes and never qualifies for Section 80TTA.',
          },
          {
            fieldKey: 'otherIncome',
            label: 'Other Taxable Income',
            valueDisplay: formatINR(inputs.otherIncome),
            rawNumeric: inputs.otherIncome,
            isNumeric: true,
            editable: true,
            defaultStatus: inputs.otherIncome > 0 ? 'verified' : 'calculated',
          },
          {
            fieldKey: 'incomeFromOtherSources',
            label: 'Total Income from Other Sources',
            valueDisplay: formatINR(calc.incomeFromOtherSources),
            calculated: true,
            defaultStatus: 'calculated',
            sourceHint: 'Calculated automatically',
          },
        ],
      },
      {
        code: 'E',
        title: 'Section E · Chapter VI-A Deductions',
        subtitle: 'Tax-saving investments & health insurance',
        rows: [
          {
            fieldKey: 'section80C',
            label: 'Section 80C (PPF, ELSS, LIC, EPF)',
            valueDisplay:
              activeDraft.selectedRegime === 'new'
                ? `${formatINR(calc.eligible80C)} (Entered ${formatINR(inputs.section80C)})`
                : formatINR(calc.eligible80C),
            rawNumeric: inputs.section80C,
            isNumeric: true,
            editable: true,
            defaultStatus: inputs.section80C > 0 ? 'verified' : 'calculated',
            explanation:
              'Allowed up to ₹1,50,000 under the Old Regime (combined 80C + 80CCD(1)). Not claimed in New Regime.',
          },
          {
            fieldKey: 'section80CCD1B',
            label: 'Section 80CCD(1B) · Additional NPS',
            valueDisplay: formatINR(calc.eligible80CCD1B),
            rawNumeric: inputs.section80CCD1B,
            isNumeric: true,
            editable: true,
            defaultStatus: inputs.section80CCD1B > 0 ? 'verified' : 'calculated',
          },
          {
            fieldKey: 'section80D',
            label: 'Section 80D · Health Insurance',
            valueDisplay: formatINR(calc.eligible80D),
            rawNumeric: inputs.section80D,
            isNumeric: true,
            editable: true,
            defaultStatus: inputs.section80D > 0 ? 'verified' : 'calculated',
          },
          {
            fieldKey: 'eligible80TTA',
            label: 'Section 80TTA · Savings Interest Deduction',
            valueDisplay: formatINR(calc.eligible80TTA),
            calculated: true,
            defaultStatus: 'calculated',
            sourceHint: 'Old Regime only · up to ₹10,000 on Savings',
          },
          {
            fieldKey: 'totalChapterVIADeductions',
            label: 'Total Chapter VI-A Deductions Applied',
            valueDisplay: formatINR(calc.totalChapterVIADeductions),
            calculated: true,
            defaultStatus: 'calculated',
            sourceHint: 'Calculated automatically',
          },
        ],
      },
      {
        code: 'F',
        title: 'Section F · Total Taxable Income',
        subtitle: 'Gross total income minus deductions, rounded u/s 288A',
        rows: [
          {
            fieldKey: 'grossTotalIncome',
            label: 'Gross Total Income',
            valueDisplay: formatINR(calc.grossTotalIncome),
            calculated: true,
            defaultStatus: 'calculated',
          },
          {
            fieldKey: 'taxableIncome',
            label: 'Total Taxable Income (Rounded u/s 288A)',
            valueDisplay: formatINR(calc.taxableIncome),
            calculated: true,
            defaultStatus: 'calculated',
          },
        ],
      },
      {
        code: 'G',
        title: 'Section G · Tax Computation',
        subtitle: `${activeDraft.selectedRegime.toUpperCase()} Regime slab math, 87A rebate & 4% cess`,
        rows: [
          {
            fieldKey: 'taxBeforeRebate',
            label: 'Income Tax on Total Income',
            valueDisplay: formatINR(calc.taxBeforeRebate),
            calculated: true,
            defaultStatus: 'calculated',
          },
          {
            fieldKey: 'rebate87A',
            label: 'Rebate u/s 87A',
            valueDisplay: formatINR(calc.rebate87A),
            calculated: true,
            defaultStatus: 'calculated',
            sourceHint: calc.marginalReliefApplied ? 'Marginal relief applied' : 'Statutory rebate check',
          },
          {
            fieldKey: 'healthAndEducationCess',
            label: 'Health & Education Cess (4%)',
            valueDisplay: formatINR(calc.healthAndEducationCess),
            calculated: true,
            defaultStatus: 'calculated',
          },
          {
            fieldKey: 'totalTaxLiability',
            label: 'Total Tax Liability',
            valueDisplay: formatINR(calc.totalTaxLiability),
            calculated: true,
            defaultStatus: 'calculated',
          },
        ],
      },
      {
        code: 'H',
        title: 'Section H · Taxes Paid',
        subtitle: 'TDS deducted & advance tax credited',
        rows: [
          {
            fieldKey: 'tdsClaimed',
            label: 'Total TDS Credit Claimed',
            valueDisplay: formatINR(inputs.tdsClaimed),
            rawNumeric: inputs.tdsClaimed,
            isNumeric: true,
            editable: true,
            defaultStatus: inputs.tdsClaimed > 0 ? 'verified' : 'calculated',
            sourceHint: 'Form 16 / Form 26AS',
          },
          {
            fieldKey: 'advanceTax',
            label: 'Advance / Self-Assessment Tax',
            valueDisplay: formatINR(inputs.advanceTax ?? 0),
            rawNumeric: inputs.advanceTax ?? 0,
            isNumeric: true,
            editable: true,
            defaultStatus: (inputs.advanceTax ?? 0) > 0 ? 'verified' : 'calculated',
          },
          {
            fieldKey: 'totalTaxesPaid',
            label: 'Total Taxes Paid',
            valueDisplay: formatINR(calc.tdsCredited + calc.advanceTaxPaid),
            calculated: true,
            defaultStatus: 'calculated',
          },
        ],
      },
      {
        code: 'I',
        title: 'Section I · Refund or Balance Payable',
        subtitle: 'Rounded u/s 288B to nearest ₹10',
        rows: [
          {
            fieldKey: 'refundDue',
            label: 'Tax Refund Due',
            valueDisplay: formatINR(calc.refundDue),
            calculated: true,
            defaultStatus: 'calculated',
          },
          {
            fieldKey: 'netTaxPayable',
            label: 'Balance Tax Payable',
            valueDisplay: formatINR(calc.netTaxPayable),
            calculated: true,
            defaultStatus: 'calculated',
          },
        ],
      },
      {
        code: 'J',
        title: 'Section J · Refund Bank Details',
        subtitle: 'Pre-validated account for any tax refund',
        rows: [
          {
            fieldKey: 'bankName',
            label: 'Bank Name',
            valueDisplay: profile.bankName || 'Not provided',
            rawString: profile.bankName,
            editable: true,
            required: true,
            defaultStatus: profile.bankName ? 'verified' : 'missing',
          },
          {
            fieldKey: 'bankAccountNumber',
            label: 'Account Number',
            valueDisplay: profile.bankAccountNumber ? maskAccountNumber(profile.bankAccountNumber) : 'Not provided',
            rawString: profile.bankAccountNumber,
            editable: true,
            required: true,
            defaultStatus: profile.bankAccountNumber ? 'verified' : 'missing',
          },
          {
            fieldKey: 'bankIfsc',
            label: 'IFSC Code',
            valueDisplay: profile.bankIfsc || 'Not provided',
            rawString: profile.bankIfsc,
            editable: true,
            required: true,
            defaultStatus: profile.bankIfsc ? 'verified' : 'missing',
          },
        ],
      },
      {
        code: 'K',
        title: 'Section K · Verification & Validation',
        subtitle: 'Declaration & return readiness',
        rows: [
          {
            fieldKey: 'verificationPlace',
            label: 'Verification Place',
            valueDisplay: profile.verificationPlace || 'Not provided',
            rawString: profile.verificationPlace || '',
            editable: true,
            defaultStatus: profile.verificationPlace ? 'verified' : 'missing',
          },
          {
            fieldKey: 'verificationConfirmed',
            label: 'Self-Verification Declaration',
            valueDisplay: profile.verificationConfirmed ? 'Confirmed by Taxpayer' : 'Not yet confirmed',
            rawString: profile.verificationConfirmed ? 'true' : 'false',
            defaultStatus: profile.verificationConfirmed ? 'verified' : 'pending_confirmation',
          },
          {
            fieldKey: 'validationSummary',
            label: 'Return Readiness Check',
            valueDisplay: `${activeDraft.validation.passCount} Passed · ${activeDraft.validation.warningCount} To Confirm · ${activeDraft.validation.errorCount} Errors`,
            calculated: true,
            defaultStatus:
              activeDraft.validation.errorCount > 0
                ? 'missing'
                : activeDraft.validation.warningCount > 0
                  ? 'pending_confirmation'
                  : 'verified',
          },
        ],
      },
    ],
    [profile, activeDraft, inputs, calc]
  );

  const openFieldDrawer = (row: FormRowDef) => {
    const fState: FieldFillingState | undefined = fieldStates[row.fieldKey];
    setSelectedField(row);
    if (row.isNumeric) {
      const initialNum =
        fState && (fState.status === 'pending_confirmation' || fState.status === 'needs_review') && fState.stagedValue !== undefined
          ? String(fState.stagedValue)
          : String(row.rawNumeric ?? 0);
      setEditValue(initialNum);
    } else {
      setEditValue(String(row.rawString ?? ''));
    }
    setEditReason('');
  };

  const handleAction = async (
    fieldKey: string,
    action: 'confirm' | 'edit' | 'reject',
    isNumeric?: boolean,
    customNum?: number,
    customStr?: string
  ) => {
    setBusyKey(fieldKey);
    try {
      await onFieldAction({
        fieldKey,
        action,
        ...(isNumeric
          ? { numericValue: customNum ?? Number(editValue || 0) }
          : { stringValue: customStr ?? editValue }),
        reason: editReason.trim() || undefined,
      });
      setSelectedField(null);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-[0_1px_2px_rgba(23,43,77,0.04)] overflow-hidden">
      {/* Live Form Editor Top Strip */}
      <div className="px-5 py-3.5 bg-[#F8FAFC] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <FileText className="w-4 h-4 text-[#2563EB]" />
          <div>
            <div className="text-xs font-bold text-[#172B4D]">
              Live ITR-1 (Sahaj) Return Form · Draft v{activeDraft.version}
            </div>
            <div className="text-[11px] text-[#64748B]">
              Fields update automatically as documents are read · Click any field to inspect source or edit
            </div>
          </div>
        </div>
        <StatusIndicator
          tone={
            activeDraft.validation.errorCount > 0
              ? 'error'
              : activeDraft.validation.warningCount > 0
                ? 'warning'
                : 'success'
          }
          label={
            activeDraft.status === 'validated_ready'
              ? 'Ready for Download'
              : activeDraft.validation.warningCount > 0
                ? `${activeDraft.validation.warningCount} Item(s) to Confirm`
                : 'Draft Active'
          }
        />
      </div>

      {/* Interactive Field Drawer if a field is selected */}
      {selectedField && (
        <div className="p-4 bg-blue-50/70 border-b border-blue-200 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold text-[#2563EB] uppercase tracking-wider">
                Field Inspector &amp; Manual Override
              </div>
              <h3 className="text-sm font-bold text-[#172B4D]">
                {selectedField.label}
              </h3>
              {selectedField.explanation && (
                <p className="text-xs text-[#64748B] mt-0.5">{selectedField.explanation}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedField(null)}
              className="p-1 text-[#64748B] hover:text-[#172B4D] rounded cursor-pointer"
              aria-label="Close field inspector"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {(() => {
            const st = fieldStates[selectedField.fieldKey];
            const hasStagedCandidate =
              st &&
              (st.status === 'pending_confirmation' || st.status === 'needs_review') &&
              st.stagedValue !== undefined &&
              st.stagedValue !== null;
            return (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-white border border-[#E2E8F0] rounded-lg p-3">
                  <div>
                    <div className="text-[11px] text-[#64748B]">Current Return Value</div>
                    <div className="font-mono font-bold text-[#172B4D] mt-0.5">
                      {selectedField.valueDisplay}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#64748B]">Source Document</div>
                    <div className="font-medium text-[#172B4D] mt-0.5 truncate">
                      {st?.sourceDocument || selectedField.sourceHint || 'Direct Entry'}
                      {st?.pageNumber ? ` (p.${st.pageNumber})` : ''}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#64748B]">Extracted Value</div>
                    <div className="font-mono font-semibold text-[#2563EB] mt-0.5">
                      {st?.stagedValue !== undefined && st?.stagedValue !== null
                        ? selectedField.isNumeric
                          ? formatINR(Number(st.stagedValue))
                          : String(st.stagedValue)
                        : selectedField.valueDisplay}
                    </div>
                  </div>
                </div>

                {selectedField.editable && (
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                    <div className="sm:col-span-5">
                      <label className="block text-[11px] font-medium text-[#172B4D] mb-1">
                        {selectedField.isNumeric ? 'Enter Amount (₹)' : 'Enter Value'}
                      </label>
                      <input
                        type={selectedField.isNumeric ? 'number' : 'text'}
                        min={selectedField.isNumeric ? 0 : undefined}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <label className="block text-[11px] font-medium text-[#172B4D] mb-1">
                        Note (Optional)
                      </label>
                      <input
                        type="text"
                        value={editReason}
                        onChange={(e) => setEditReason(e.target.value)}
                        placeholder="Reason for change"
                        className="w-full px-3 py-1.5 text-xs bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>
                    <div className="sm:col-span-3 flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busyKey === selectedField.fieldKey}
                        onClick={() =>
                          handleAction(selectedField.fieldKey, 'edit', selectedField.isNumeric)
                        }
                      >
                        Save Edit
                      </Button>
                    </div>
                  </div>
                )}

                {hasStagedCandidate && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      variant="teal"
                      size="sm"
                      loading={busyKey === selectedField.fieldKey}
                      onClick={() =>
                        handleAction(
                          selectedField.fieldKey,
                          'confirm',
                          selectedField.isNumeric,
                          selectedField.isNumeric ? Number(st.stagedValue) : undefined
                        )
                      }
                      icon={<Check className="w-3.5 h-3.5" />}
                    >
                      Confirm Extracted Value (
                      {selectedField.isNumeric
                        ? formatINR(Number(st.stagedValue))
                        : String(st.stagedValue)}
                      )
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      loading={busyKey === selectedField.fieldKey}
                      onClick={() =>
                        handleAction(selectedField.fieldKey, 'reject', selectedField.isNumeric)
                      }
                    >
                      Exclude
                    </Button>
                  </div>
                )}

                {st?.editedByUser && (
                  <div className="flex items-center gap-1.5 text-[11px] text-[#2563EB]">
                    <Lock className="w-3 h-3" />
                    <span>Protected: Your manual edit will not be overwritten by future document uploads.</span>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Sections A through K */}
      <div className="divide-y divide-[#E2E8F0] max-h-[760px] overflow-y-auto">
        {sections.map((section) => {
          const isFocused = focusedSectionCode === section.code;
          const isCollapsed = Boolean(collapsedSections[section.code]) && !isFocused;
          const pendingInSection = section.rows.filter((r) => {
            const st = fieldStates[r.fieldKey];
            return st?.status === 'pending_confirmation' || st?.status === 'needs_review';
          }).length;

          return (
            <div key={section.code} id={`itr-section-${section.code}`}>
              <button
                type="button"
                onClick={() =>
                  setCollapsedSections((prev) => ({
                    ...prev,
                    [section.code]: !isCollapsed,
                  }))
                }
                className={`w-full px-5 py-3 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                  isFocused ? 'bg-blue-50/50' : 'bg-[#F8FAFC]/80 hover:bg-[#F8FAFC]'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isCollapsed ? (
                    <ChevronRight className="w-4 h-4 text-[#64748B] shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#64748B] shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#172B4D]">
                      {section.title}
                    </div>
                    <div className="text-[11px] text-[#64748B] truncate">
                      {section.subtitle}
                    </div>
                  </div>
                </div>
                {pendingInSection > 0 && (
                  <span className="text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded shrink-0">
                    {pendingInSection} to confirm
                  </span>
                )}
              </button>

              {!isCollapsed && (
                <div className="divide-y divide-[#E2E8F0]/70 bg-white">
                  {section.rows.map((row) => {
                    const st = fieldStates[row.fieldKey];
                    const effectiveStatus: FieldVerificationStatus =
                      st?.status ?? row.defaultStatus ?? 'calculated';
                    const isActiveNow = activeFieldKey === row.fieldKey;
                    const justUpdated = recentlyUpdatedFieldKeys.includes(row.fieldKey);

                    const hasPendingExtractedValue =
                      st &&
                      (st.status === 'pending_confirmation' || st.status === 'needs_review') &&
                      st.stagedValue !== undefined &&
                      st.stagedValue !== null &&
                      (!row.isNumeric || Number(st.stagedValue) !== (row.rawNumeric ?? 0));

                    return (
                      <div
                        key={row.fieldKey}
                        className={`px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 transition-colors ${
                          isActiveNow
                            ? 'itr-field-active'
                            : justUpdated
                              ? 'itr-field-just-updated'
                              : hasPendingExtractedValue
                                ? 'bg-amber-50/40'
                                : 'hover:bg-[#F8FAFC]/60'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => openFieldDrawer(row)}
                          className="text-left min-w-0 flex-1 cursor-pointer"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-[#172B4D]">
                              {row.label}
                            </span>
                            {getFieldBadge(effectiveStatus, isActiveNow)}
                          </div>
                          <div className="text-[11px] text-[#64748B] mt-0.5 truncate">
                            {st?.sourceDocument
                              ? `Source: ${st.sourceDocument}${st.pageNumber ? ` · p.${st.pageNumber}` : ''}`
                              : row.sourceHint
                                ? `Source: ${row.sourceHint}`
                                : row.explanation || 'Click to inspect or edit'}
                          </div>
                        </button>

                        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                          <div className="text-right">
                            <div
                              className={`text-xs font-mono font-bold tabular-nums ${
                                hasPendingExtractedValue ? 'text-[#64748B]' : 'text-[#172B4D]'
                              }`}
                            >
                              {row.valueDisplay}
                            </div>
                            {hasPendingExtractedValue && (
                              <div className="text-[11px] font-mono font-semibold text-amber-800 tabular-nums">
                                Extracted:{' '}
                                {row.isNumeric
                                  ? formatINR(Number(st.stagedValue))
                                  : String(st.stagedValue)}
                              </div>
                            )}
                          </div>

                          {hasPendingExtractedValue ? (
                            <div className="flex items-center gap-1.5">
                              <Button
                                variant="teal"
                                size="sm"
                                loading={busyKey === row.fieldKey}
                                onClick={() =>
                                  handleAction(
                                    row.fieldKey,
                                    'confirm',
                                    row.isNumeric,
                                    row.isNumeric ? Number(st.stagedValue) : undefined
                                  )
                                }
                              >
                                Confirm
                              </Button>
                              <button
                                type="button"
                                onClick={() => openFieldDrawer(row)}
                                className="px-2 py-1 text-[11px] font-medium text-[#64748B] hover:text-[#172B4D] border border-[#E2E8F0] rounded bg-white cursor-pointer"
                              >
                                Edit
                              </button>
                            </div>
                          ) : row.editable ? (
                            <button
                              type="button"
                              onClick={() => openFieldDrawer(row)}
                              className="p-1.5 text-[#64748B] hover:text-[#2563EB] rounded hover:bg-blue-50/70 cursor-pointer"
                              aria-label={`Edit ${row.label}`}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
