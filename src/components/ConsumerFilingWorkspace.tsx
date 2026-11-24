import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  FileJson2,
  FileText,
  HelpCircle,
  Loader2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  ApprovalRequest,
  DOCUMENT_CATEGORY_LABELS,
  ReturnDraft,
  ReturnFinancialInputs,
  TaxRegime,
  UploadedDocument,
  UserProfile,
  WorkspaceSnapshot,
} from '../shared/types';
import { formatINR, maskAccountNumber, maskPan } from '../utils/format';
import { Button, LightCodeBlock } from './DesignSystem';

export type ConsumerStepId = 'upload' | 'review' | 'submit';

export interface FieldActionPayload {
  fieldKey: string;
  action: 'confirm' | 'edit' | 'reject';
  numericValue?: number;
  stringValue?: string;
  reason?: string;
}

interface ConsumerFilingWorkspaceProps {
  snapshot: WorkspaceSnapshot;
  activeStep: ConsumerStepId;
  onStepChange: (step: ConsumerStepId) => void;
  onUploadFiles: (files: File[]) => Promise<void>;
  onReextractDocument: (docId: string) => Promise<void>;
  onDeleteDocument: (docId: string) => Promise<void>;
  onStartDemo: () => Promise<void>;
  onDownloadSampleFiles: () => Promise<void>;
  onUpdateProfile: (partial: Partial<UserProfile>) => Promise<void>;
  onFieldAction: (payload: FieldActionPayload) => Promise<void>;
  onClearUnsupportedFlags: () => Promise<void>;
  onAskQuestion: (question: string) => Promise<void>;
  onOpenBreakdown: () => void;
  onOpenApprovalModal: (approval: ApprovalRequest) => void;
  onOpenFinalizeModal: () => void;
  onResolveApproval: (
    approvalId: string,
    action: 'approve' | 'reject' | 'cancel'
  ) => Promise<void>;
  onDownloadItrJson: () => void;
  onDownloadReceiptAndAudit: () => void;
  onOpenActivityDrawer: () => void;
}

const AskWhyButton: React.FC<{
  label?: string;
  onClick: () => void;
}> = ({ label = 'Ask why', onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#64748B] hover:text-[#2563EB] px-1.5 py-0.5 rounded hover:bg-blue-50/70 transition-colors cursor-pointer shrink-0"
  >
    <HelpCircle className="w-3.5 h-3.5" />
    <span className="hidden sm:inline">{label}</span>
  </button>
);

const InlineCurrencyInput: React.FC<{
  value: number;
  ariaLabel: string;
  disabled?: boolean;
  onCommit: (nextValue: number) => Promise<void>;
}> = ({ value, ariaLabel, disabled = false, onCommit }) => {
  const [text, setText] = useState(String(Math.round(value || 0)));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setText(String(Math.round(value || 0)));
  }, [value]);

  const commitIfChanged = async () => {
    const parsed = Math.max(0, Math.round(Number(text.replace(/[^0-9]/g, '')) || 0));
    setText(String(parsed));
    if (parsed === Math.round(value || 0)) return;
    setSaving(true);
    try {
      await onCommit(parsed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative flex items-center">
      <span className="absolute left-2.5 text-xs font-mono text-[#64748B] pointer-events-none">
        ₹
      </span>
      <input
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel}
        disabled={disabled || saving}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => void commitIfChanged()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          }
        }}
        className="w-32 sm:w-36 pl-6 pr-2.5 py-1.5 text-right text-xs font-mono tabular-nums font-medium text-[#172B4D] bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB] disabled:opacity-60"
      />
    </div>
  );
};

function summarizeDocNumbers(doc: UploadedDocument): string {
  const parts: string[] = [];
  const d = doc.structuredData;
  if (d.grossSalary) parts.push(`Salary ${formatINR(d.grossSalary)}`);
  if (d.tdsOnSalary || d.totalTdsCredited26AS || d.tdsOnInterest) {
    const tds = d.totalTdsCredited26AS ?? (Number(d.tdsOnSalary ?? 0) + Number(d.tdsOnInterest ?? 0));
    if (tds > 0) parts.push(`TDS ${formatINR(tds)}`);
  }
  if (d.savingsBankInterest) parts.push(`Savings Interest ${formatINR(d.savingsBankInterest)}`);
  if (d.fdInterest) parts.push(`FD Interest ${formatINR(d.fdInterest)}`);
  if (d.section80CProofTotal || d.section80CDeclared) {
    parts.push(`80C ${formatINR(d.section80CProofTotal ?? d.section80CDeclared ?? 0)}`);
  }
  if (d.section80DProofTotal || d.section80DDeclared) {
    parts.push(`80D ${formatINR(d.section80DProofTotal ?? d.section80DDeclared ?? 0)}`);
  }
  if (parts.length === 0) {
    return doc.extractedFacts.length > 0
      ? `${doc.extractedFacts.length} details read`
      : 'Processed';
  }
  return parts.join(' · ');
}

export const ConsumerFilingWorkspace: React.FC<ConsumerFilingWorkspaceProps> = ({
  snapshot,
  activeStep,
  onStepChange,
  onUploadFiles,
  onReextractDocument,
  onDeleteDocument,
  onStartDemo,
  onDownloadSampleFiles,
  onUpdateProfile,
  onFieldAction,
  onClearUnsupportedFlags,
  onAskQuestion,
  onOpenBreakdown,
  onOpenApprovalModal,
  onOpenFinalizeModal,
  onResolveApproval,
  onDownloadItrJson,
  onDownloadReceiptAndAudit,
  onOpenActivityDrawer,
}) => {
  const {
    profile,
    documents,
    activeDraft,
    reconciliation,
    approvals,
    fieldStates = {},
  } = snapshot;
  const inputs: ReturnFinancialInputs = activeDraft.inputs;
  const { newRegime, oldRegime, recommendedRegime, netSavingsInRecommended } =
    activeDraft.taxSummary;

  // Step 1 upload state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatusMsg, setUploadStatusMsg] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [loadingDemo, setLoadingDemo] = useState(false);

  // Step 2 profile / checklist inline draft state
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<UserProfile>(profile);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSavedNote, setProfileSavedNote] = useState(false);
  const [inlineMissingInputs, setInlineMissingInputs] = useState<Record<string, string>>({});
  const [busyFieldKey, setBusyFieldKey] = useState<string | null>(null);

  // Step 3 state
  const [showJsonPreview, setShowJsonPreview] = useState(false);

  useEffect(() => {
    setProfileForm(profile);
  }, [profile]);

  const handleFilesSelected = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    setUploadStatusMsg(
      files.length === 1 ? `Reading ${files[0].name}...` : `Reading ${files.length} documents...`
    );
    try {
      await onUploadFiles(files);
      setUploadStatusMsg(
        files.length === 1 ? `Extracted details from ${files[0].name}` : `Extracted ${files.length} documents`
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not read uploaded file.');
      setUploadStatusMsg(null);
    } finally {
      setUploading(false);
    }
  };

  const handleLaunchDemo = async () => {
    setLoadingDemo(true);
    setUploadError(null);
    try {
      await onStartDemo();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to load sample documents.');
    } finally {
      setLoadingDemo(false);
    }
  };

  const handleSaveProfileForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await onUpdateProfile({
        ...profileForm,
        pan: profileForm.pan.trim().toUpperCase(),
        employerTan: profileForm.employerTan.trim().toUpperCase(),
        bankIfsc: profileForm.bankIfsc.trim().toUpperCase(),
        aadhaarLast4: profileForm.aadhaarLast4.replace(/\D/g, '').slice(-4),
      });
      setEditingProfile(false);
      setProfileSavedNote(true);
      window.setTimeout(() => setProfileSavedNote(false), 2000);
    } finally {
      setSavingProfile(false);
    }
  };

  // Compute real actionable items for Step 2 Validation Banner
  const pendingApprovals = approvals.filter((a) => a.status === 'pending');
  const pendingFieldReviews = Object.values(fieldStates).filter(
    (f) => f.status === 'pending_confirmation' || f.status === 'needs_review'
  );
  const unsupportedFlags = activeDraft.validation.unsupportedScenarios ?? [];

  const requiredProfileFields: Array<{
    key: keyof UserProfile;
    label: string;
    placeholder: string;
  }> = [
    { key: 'fullName', label: 'Full Name', placeholder: 'e.g. Rohan Sharma' },
    { key: 'pan', label: 'PAN Number', placeholder: 'e.g. ABCDE1234F' },
    { key: 'dateOfBirth', label: 'Date of Birth', placeholder: 'YYYY-MM-DD' },
    { key: 'aadhaarLast4', label: 'Last 4 digits of Aadhaar', placeholder: '4 digits' },
    { key: 'bankName', label: 'Refund Bank Name', placeholder: 'e.g. HDFC Bank' },
    { key: 'bankAccountNumber', label: 'Refund Account Number', placeholder: 'Account number' },
    { key: 'bankIfsc', label: 'Bank IFSC Code', placeholder: 'e.g. HDFC0000123' },
  ];

  const missingProfileItems = requiredProfileFields.filter(
    (f) => !String(profile[f.key] ?? '').trim()
  );

  const unresolvedConflicts = reconciliation.items.filter(
    (item) =>
      item.resolutionStatus !== 'resolved' &&
      item.severity !== 'missing_document' &&
      !pendingFieldReviews.some(
        (f) => f.fieldKey === item.recommendedAction?.fieldToUpdate
      )
  );

  const attentionCount =
    unsupportedFlags.length +
    pendingApprovals.length +
    pendingFieldReviews.length +
    unresolvedConflicts.length +
    missingProfileItems.length;

  const isFinalized = activeDraft.changeNote.startsWith('ITR-1 Draft Finalized:');
  const selectedCalc =
    activeDraft.selectedRegime === 'new' ? newRegime : oldRegime;

  // Helpers for checkbox-based deductions
  const toggleNumericDeduction = async (
    fieldKey: keyof ReturnFinancialInputs,
    checked: boolean,
    defaultAmount: number,
    label: string
  ) => {
    setBusyFieldKey(fieldKey);
    try {
      await onFieldAction({
        fieldKey,
        action: 'edit',
        numericValue: checked ? defaultAmount : 0,
        reason: checked ? `Enabled ${label}` : `Removed ${label}`,
      });
    } finally {
      setBusyFieldKey(null);
    }
  };

  const toggleBooleanFlag = async (
    fieldKey: 'hasSeniorParents' | 'isGovernmentEmployer',
    checked: boolean
  ) => {
    setBusyFieldKey(fieldKey);
    try {
      await onFieldAction({
        fieldKey,
        action: 'edit',
        stringValue: checked ? 'true' : 'false',
      });
    } finally {
      setBusyFieldKey(null);
    }
  };

  // =========================================================================
  // STEP 1 · UPLOAD DOCUMENTS
  // =========================================================================
  if (activeStep === 'upload') {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-xl font-bold tracking-tight text-[#172B4D]">
            Upload your tax documents
          </h1>
          <p className="text-xs sm:text-[13px] text-[#64748B]">
            Drop your Form 16, bank statements, FD certificates, or investment proofs. We read each file and fill your numbers automatically.
          </p>
        </div>

        {/* Clean Drag & Drop Upload Box */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (e.dataTransfer.files?.length) {
              void handleFilesSelected(e.dataTransfer.files);
            }
          }}
          className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
            dragActive
              ? 'border-[#2563EB] bg-blue-50/40'
              : 'border-[#CBD5E1] bg-[#F8FAFC]/60 hover:border-[#2563EB]/60'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.txt,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) {
                void handleFilesSelected(e.target.files);
                e.target.value = '';
              }
            }}
          />

          <div className="w-10 h-10 rounded-lg bg-white border border-[#E2E8F0] text-[#2563EB] flex items-center justify-center mx-auto">
            {uploading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Upload className="w-5 h-5" />
            )}
          </div>

          <div className="mt-3 text-sm font-semibold text-[#172B4D]">
            {uploading
              ? uploadStatusMsg || 'Reading documents...'
              : 'Drag and drop files here, or choose from computer'}
          </div>
          <p className="text-xs text-[#64748B] mt-1">
            Supports Form 16, Salary Slips, Bank Statements, FD Certificates, 26AS / AIS, and 80C/80D proofs (PDF, JPG, PNG, TXT)
          </p>

          <div className="mt-5 flex items-center justify-center gap-3 flex-wrap">
            <Button
              variant="primary"
              size="md"
              loading={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose Files
            </Button>
            <Button
              variant="outline"
              size="md"
              loading={loadingDemo}
              icon={<Sparkles className="w-3.5 h-3.5 text-[#0D9488]" />}
              onClick={handleLaunchDemo}
            >
              Try Sample Tax Pack
            </Button>
            <Button
              variant="ghost"
              size="md"
              icon={<Download className="w-3.5 h-3.5 text-[#2563EB]" />}
              onClick={onDownloadSampleFiles}
            >
              Download Sample PDFs (.zip)
            </Button>
          </div>

          {uploadStatusMsg && !uploading && (
            <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-[#0D9488]">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{uploadStatusMsg}</span>
            </div>
          )}

          {uploadError && (
            <div className="mt-4 text-xs text-rose-700 font-medium">{uploadError}</div>
          )}
        </div>

        {/* Uploaded Documents List */}
        {documents.length > 0 && (
          <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-[#F8FAFC] border-b border-[#E2E8F0] flex items-center justify-between">
              <span className="text-xs font-semibold text-[#172B4D]">
                Uploaded Documents ({documents.length})
              </span>
              <button
                type="button"
                onClick={onDownloadSampleFiles}
                className="text-[11px] font-medium text-[#2563EB] hover:underline cursor-pointer"
              >
                Download sample PDFs (.zip)
              </button>
            </div>
            <div className="divide-y divide-[#E2E8F0]">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <FileText className="w-4 h-4 text-[#2563EB] mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#172B4D] truncate">
                        {doc.fileName}
                      </div>
                      <div className="text-[11px] text-[#64748B] mt-0.5">
                        {DOCUMENT_CATEGORY_LABELS[doc.category]} · {summarizeDocNumbers(doc)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busyDocId === doc.id}
                      onClick={async () => {
                        setBusyDocId(doc.id);
                        try {
                          await onReextractDocument(doc.id);
                        } finally {
                          setBusyDocId(null);
                        }
                      }}
                      className="text-[11px] font-medium text-[#64748B] hover:text-[#172B4D] px-2 py-1 rounded hover:bg-[#F8FAFC] cursor-pointer"
                    >
                      {busyDocId === doc.id ? 'Reading...' : 'Re-read'}
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${doc.fileName}`}
                      onClick={() => void onDeleteDocument(doc.id)}
                      className="p-1.5 text-[#64748B] hover:text-rose-700 rounded hover:bg-rose-50 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          <div className="text-xs text-[#64748B]">
            {documents.length === 0
              ? 'You can also skip ahead and enter numbers manually.'
              : `${documents.length} document${documents.length === 1 ? '' : 's'} ready for review.`}
          </div>
          <Button
            variant="primary"
            size="lg"
            onClick={() => onStepChange('review')}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Continue to Review Numbers &amp; Tax
          </Button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // STEP 2 · REVIEW NUMBERS & TAX
  // =========================================================================
  if (activeStep === 'review') {
    const incomeRows: Array<{
      key: keyof ReturnFinancialInputs;
      label: string;
      hint: string;
      askPrompt?: string;
    }> = [
      {
        key: 'grossSalary',
        label: 'Gross Salary',
        hint: fieldStates.grossSalary?.sourceDocument
          ? `From ${fieldStates.grossSalary.sourceDocument}`
          : 'Total salary before standard deduction',
      },
      {
        key: 'savingsInterest',
        label: 'Savings Bank Interest',
        hint: fieldStates.savingsInterest?.sourceDocument
          ? `From ${fieldStates.savingsInterest.sourceDocument}`
          : 'Interest from savings accounts',
        askPrompt: `Why is my Savings Bank Interest (${formatINR(inputs.savingsInterest)}) listed separately from FD interest?`,
      },
      {
        key: 'fdInterest',
        label: 'Fixed Deposit Interest',
        hint: fieldStates.fdInterest?.sourceDocument
          ? `From ${fieldStates.fdInterest.sourceDocument}`
          : 'Interest from FDs / term deposits',
        askPrompt: `How is my Fixed Deposit Interest (${formatINR(inputs.fdInterest)}) taxed, and does Section 80TTA cover it?`,
      },
      {
        key: 'otherIncome',
        label: 'Any Other Income',
        hint: 'Dividends, family pension, or other eligible income',
      },
      {
        key: 'tdsClaimed',
        label: 'TDS Already Deducted',
        hint: fieldStates.tdsClaimed?.sourceDocument
          ? `From ${fieldStates.tdsClaimed.sourceDocument}`
          : 'Tax deducted by employer & banks',
        askPrompt: `How does my TDS of ${formatINR(inputs.tdsClaimed)} reduce my final tax payable or increase my refund?`,
      },
      {
        key: 'advanceTax',
        label: 'Advance / Self-Assessment Tax Paid',
        hint: 'Challan payments made directly by you',
      },
    ];

    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#172B4D]">
              Review your numbers &amp; choose a tax regime
            </h1>
            <p className="text-xs sm:text-[13px] text-[#64748B] mt-0.5">
              Edit any figure inline, toggle deductions you qualify for, and click <span className="font-medium text-[#172B4D]">?</span> anytime for an explanation.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            icon={<Upload className="w-3.5 h-3.5" />}
            onClick={() => onStepChange('upload')}
          >
            Add Documents
          </Button>
        </div>

        {/* Clean Actionable Validation Banner */}
        {attentionCount === 0 ? (
          <div className="px-4 py-3.5 rounded-xl bg-teal-50/70 border border-teal-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#0D9488] shrink-0" />
              <div>
                <div className="text-xs font-semibold text-[#172B4D]">
                  Everything looks ready to file
                </div>
                <div className="text-[11px] text-[#64748B]">
                  All extracted numbers, deductions, and refund bank details are complete.
                </div>
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => onStepChange('submit')}
              rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
            >
              Approve &amp; Submit
            </Button>
          </div>
        ) : (
          <div className="bg-white border border-amber-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-amber-50/60 border-b border-amber-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                <span className="text-xs font-semibold text-[#172B4D]">
                  {attentionCount} {attentionCount === 1 ? 'item needs' : 'items need'} your attention
                </span>
              </div>
              <AskWhyButton
                label="Explain items"
                onClick={() =>
                  void onAskQuestion(
                    'What items currently need my attention in my return and what should I check?'
                  )
                }
              />
            </div>

            <div className="divide-y divide-[#E2E8F0]">
              {/* Unsupported Scenarios */}
              {unsupportedFlags.map((flag) => (
                <div
                  key={flag.code}
                  className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-semibold text-rose-800">{flag.title}</div>
                    <div className="text-[11px] text-[#64748B] mt-0.5">{flag.reason}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <AskWhyButton
                      onClick={() =>
                        void onAskQuestion(
                          `Why does "${flag.title}" block ITR-1 filing and which form applies?`
                        )
                      }
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void onClearUnsupportedFlags()}
                    >
                      Remove Flag
                    </Button>
                  </div>
                </div>
              ))}

              {/* Pending Approvals */}
              {pendingApprovals.map((approval) => (
                <div
                  key={approval.id}
                  className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-semibold text-[#172B4D]">{approval.summary}</div>
                    <div className="text-[11px] text-[#64748B] mt-0.5">
                      Waiting for your confirmation before updating your return
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => onOpenApprovalModal(approval)}
                    >
                      Review &amp; Approve
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void onResolveApproval(approval.id, 'reject')}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))}

              {/* Extracted Values Pending Confirmation */}
              {pendingFieldReviews.map((item) => (
                <div
                  key={item.fieldKey}
                  className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-semibold text-[#172B4D]">
                      Confirm {item.label}:{' '}
                      <span className="font-mono tabular-nums text-[#2563EB]">
                        {typeof item.stagedValue === 'number'
                          ? formatINR(item.stagedValue)
                          : String(item.stagedValue ?? '—')}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#64748B] mt-0.5">
                      {item.sourceDocument
                        ? `Extracted from ${item.sourceDocument} — verify it matches your record`
                        : 'Extracted from document — verify before filing'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <AskWhyButton
                      onClick={() =>
                        void onAskQuestion(
                          `Why am I being asked to confirm ${item.label} (${
                            typeof item.stagedValue === 'number'
                              ? formatINR(item.stagedValue)
                              : String(item.stagedValue ?? '')
                          })?`
                        )
                      }
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      loading={busyFieldKey === item.fieldKey}
                      onClick={async () => {
                        setBusyFieldKey(item.fieldKey);
                        try {
                          await onFieldAction({
                            fieldKey: item.fieldKey,
                            action: 'confirm',
                          });
                        } finally {
                          setBusyFieldKey(null);
                        }
                      }}
                    >
                      Confirm
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyFieldKey === item.fieldKey}
                      onClick={async () => {
                        setBusyFieldKey(item.fieldKey);
                        try {
                          await onFieldAction({
                            fieldKey: item.fieldKey,
                            action: 'reject',
                          });
                        } finally {
                          setBusyFieldKey(null);
                        }
                      }}
                    >
                      Exclude
                    </Button>
                  </div>
                </div>
              ))}

              {/* Unresolved Document Mismatches */}
              {unresolvedConflicts.map((conflict) => (
                <div
                  key={conflict.id}
                  className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-semibold text-[#172B4D]">{conflict.title}</div>
                    <div className="text-[11px] text-[#64748B] mt-0.5">
                      {conflict.explanation}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <AskWhyButton
                      onClick={() =>
                        void onAskQuestion(
                          `Explain the difference for "${conflict.title}": ${conflict.explanation}`
                        )
                      }
                    />
                    {conflict.recommendedAction && (
                      <Button
                        variant="outline"
                        size="sm"
                        loading={busyFieldKey === conflict.id}
                        onClick={async () => {
                          if (!conflict.recommendedAction) return;
                          setBusyFieldKey(conflict.id);
                          try {
                            await onFieldAction({
                              fieldKey: conflict.recommendedAction.fieldToUpdate,
                              action: 'edit',
                              numericValue: conflict.recommendedAction.proposedValue,
                              reason: conflict.recommendedAction.reason,
                            });
                          } finally {
                            setBusyFieldKey(null);
                          }
                        }}
                      >
                        {conflict.recommendedAction.label}
                      </Button>
                    )}
                  </div>
                </div>
              ))}

              {/* Missing Required Profile / Bank Details (Direct Inline Fix) */}
              {missingProfileItems.length > 0 && (
                <div className="px-4 py-3.5 space-y-2.5 text-xs">
                  <div className="font-semibold text-[#172B4D]">
                    Complete required taxpayer &amp; refund bank details
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {missingProfileItems.map((field) => (
                      <div key={field.key} className="space-y-1">
                        <label className="block text-[11px] font-medium text-[#64748B]">
                          {field.label}
                        </label>
                        <input
                          type="text"
                          placeholder={field.placeholder}
                          value={inlineMissingInputs[field.key] ?? ''}
                          onChange={(e) =>
                            setInlineMissingInputs((prev) => ({
                              ...prev,
                              [field.key]: e.target.value,
                            }))
                          }
                          className="w-full px-2.5 py-1.5 text-xs border border-[#E2E8F0] rounded-lg bg-[#F8FAFC] focus:bg-white focus:outline-none focus:border-[#2563EB]"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="pt-1">
                    <Button
                      variant="primary"
                      size="sm"
                      loading={savingProfile}
                      disabled={missingProfileItems.every(
                        (f) => !(inlineMissingInputs[f.key] ?? '').trim()
                      )}
                      onClick={async () => {
                        const patch: Partial<UserProfile> = {};
                        for (const f of missingProfileItems) {
                          const val = (inlineMissingInputs[f.key] ?? '').trim();
                          if (val) {
                            (patch as Record<string, string>)[f.key] = val;
                          }
                        }
                        if (Object.keys(patch).length === 0) return;
                        setSavingProfile(true);
                        try {
                          await onUpdateProfile(patch);
                        } finally {
                          setSavingProfile(false);
                        }
                      }}
                    >
                      Save Missing Details
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Section 1: Income & Taxes Paid */}
        <section className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#E2E8F0] flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[#172B4D]">
                Income &amp; Taxes Paid
              </h2>
              <p className="text-[11px] text-[#64748B]">
                Edit any figure below — your tax calculation updates immediately.
              </p>
            </div>
          </div>

          <div className="divide-y divide-[#E2E8F0]">
            {incomeRows.map((row) => (
              <div
                key={row.key}
                className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-[#172B4D]">
                      {row.label}
                    </span>
                    {row.askPrompt && (
                      <AskWhyButton
                        onClick={() => void onAskQuestion(row.askPrompt!)}
                      />
                    )}
                  </div>
                  <div className="text-[11px] text-[#64748B] truncate">{row.hint}</div>
                </div>
                <InlineCurrencyInput
                  ariaLabel={row.label}
                  value={Number(inputs[row.key] ?? 0)}
                  onCommit={(val) =>
                    onFieldAction({
                      fieldKey: row.key,
                      action: 'edit',
                      numericValue: val,
                      reason: `Updated ${row.label} in Review`,
                    })
                  }
                />
              </div>
            ))}
          </div>
        </section>

        {/* Section 2: Deductions (Clean Checkboxes & Toggles) */}
        <section className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#E2E8F0]">
            <h2 className="text-sm font-semibold text-[#172B4D]">Deductions</h2>
            <p className="text-[11px] text-[#64748B]">
              Select deductions you are eligible to claim. Standard deduction applies automatically.
            </p>
          </div>

          <div className="divide-y divide-[#E2E8F0]">
            {/* Automatic Standard Deduction Row */}
            <div className="px-5 py-3 flex items-center justify-between gap-3 bg-[#F8FAFC]/50">
              <div>
                <div className="text-xs font-medium text-[#172B4D]">
                  Standard Deduction (Automatic)
                </div>
                <div className="text-[11px] text-[#64748B]">
                  ₹75,000 under New Regime · ₹50,000 under Old Regime
                </div>
              </div>
              <span className="text-xs font-mono tabular-nums font-semibold text-[#0D9488]">
                {formatINR(
                  activeDraft.selectedRegime === 'new'
                    ? newRegime.standardDeduction
                    : oldRegime.standardDeduction
                )}
              </span>
            </div>

            {/* Section 80C */}
            <div className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-start gap-2.5">
                <input
                  id="ded-80c"
                  type="checkbox"
                  disabled={busyFieldKey === 'section80C'}
                  checked={inputs.section80C > 0}
                  onChange={(e) =>
                    void toggleNumericDeduction(
                      'section80C',
                      e.target.checked,
                      150000,
                      'Section 80C'
                    )
                  }
                  className="mt-0.5 h-4 w-4 rounded border-[#CBD5E1] text-[#2563EB] cursor-pointer"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <label
                      htmlFor="ded-80c"
                      className="text-xs font-medium text-[#172B4D] cursor-pointer"
                    >
                      Tax-Saving Investments (Section 80C)
                    </label>
                    <AskWhyButton
                      onClick={() =>
                        void onAskQuestion(
                          'What qualifies under Section 80C and does it apply in the New Tax Regime?'
                        )
                      }
                    />
                  </div>
                  <div className="text-[11px] text-[#64748B]">
                    PPF, ELSS mutual funds, EPF, life insurance (Old Regime, up to ₹1,50,000)
                  </div>
                </div>
              </div>
              <InlineCurrencyInput
                ariaLabel="Section 80C Amount"
                value={inputs.section80C}
                onCommit={(val) =>
                  onFieldAction({
                    fieldKey: 'section80C',
                    action: 'edit',
                    numericValue: val,
                  })
                }
              />
            </div>

            {/* Section 80D Health Insurance + Senior Parents Toggle */}
            <div className="px-5 py-3 space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-start gap-2.5">
                  <input
                    id="ded-80d"
                    type="checkbox"
                    disabled={busyFieldKey === 'section80D'}
                    checked={inputs.section80D > 0}
                    onChange={(e) =>
                      void toggleNumericDeduction(
                        'section80D',
                        e.target.checked,
                        25000,
                        'Health Insurance (80D)'
                      )
                    }
                    className="mt-0.5 h-4 w-4 rounded border-[#CBD5E1] text-[#2563EB] cursor-pointer"
                  />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <label
                        htmlFor="ded-80d"
                        className="text-xs font-medium text-[#172B4D] cursor-pointer"
                      >
                        Health Insurance Premium (Section 80D)
                      </label>
                      <AskWhyButton
                        onClick={() =>
                          void onAskQuestion(
                            'How much can I claim for health insurance under Section 80D for self and senior parents?'
                          )
                        }
                      />
                    </div>
                    <div className="text-[11px] text-[#64748B]">
                      Medical insurance for self &amp; family (Old Regime, up to ₹25,000)
                    </div>
                  </div>
                </div>
                <InlineCurrencyInput
                  ariaLabel="Section 80D Self & Family Amount"
                  value={inputs.section80D}
                  onCommit={(val) =>
                    onFieldAction({
                      fieldKey: 'section80D',
                      action: 'edit',
                      numericValue: val,
                    })
                  }
                />
              </div>

              <div className="pl-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                <label className="flex items-center gap-2 text-xs text-[#64748B] cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={busyFieldKey === 'hasSeniorParents'}
                    checked={Boolean(inputs.hasSeniorParents)}
                    onChange={(e) =>
                      void toggleBooleanFlag('hasSeniorParents', e.target.checked)
                    }
                    className="h-3.5 w-3.5 rounded border-[#CBD5E1] text-[#2563EB] cursor-pointer"
                  />
                  <span>Include parents&apos; health insurance (senior citizens 60+)</span>
                </label>
                {(inputs.hasSeniorParents || Number(inputs.section80DParents ?? 0) > 0) && (
                  <InlineCurrencyInput
                    ariaLabel="Parents Health Insurance Amount"
                    value={Number(inputs.section80DParents ?? 0)}
                    onCommit={(val) =>
                      onFieldAction({
                        fieldKey: 'section80DParents',
                        action: 'edit',
                        numericValue: val,
                      })
                    }
                  />
                )}
              </div>
            </div>

            {/* NPS Self 80CCD(1B) */}
            <div className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-start gap-2.5">
                <input
                  id="ded-nps"
                  type="checkbox"
                  disabled={busyFieldKey === 'section80CCD1B'}
                  checked={inputs.section80CCD1B > 0}
                  onChange={(e) =>
                    void toggleNumericDeduction(
                      'section80CCD1B',
                      e.target.checked,
                      50000,
                      'NPS 80CCD(1B)'
                    )
                  }
                  className="mt-0.5 h-4 w-4 rounded border-[#CBD5E1] text-[#2563EB] cursor-pointer"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <label
                      htmlFor="ded-nps"
                      className="text-xs font-medium text-[#172B4D] cursor-pointer"
                    >
                      NPS Contribution — Self (80CCD(1B))
                    </label>
                    <AskWhyButton
                      onClick={() =>
                        void onAskQuestion(
                          'How does my additional ₹50,000 NPS deduction under 80CCD(1B) work across regimes?'
                        )
                      }
                    />
                  </div>
                  <div className="text-[11px] text-[#64748B]">
                    Additional Tier-I NPS deduction up to ₹50,000 (Old Regime)
                  </div>
                </div>
              </div>
              <InlineCurrencyInput
                ariaLabel="NPS 80CCD(1B) Amount"
                value={inputs.section80CCD1B}
                onCommit={(val) =>
                  onFieldAction({
                    fieldKey: 'section80CCD1B',
                    action: 'edit',
                    numericValue: val,
                  })
                }
              />
            </div>

            {/* Employer NPS 80CCD(2) */}
            <div className="px-5 py-3 space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-start gap-2.5">
                  <input
                    id="ded-nps-emp"
                    type="checkbox"
                    disabled={busyFieldKey === 'section80CCD2'}
                    checked={Number(inputs.section80CCD2 ?? 0) > 0}
                    onChange={(e) =>
                      void toggleNumericDeduction(
                        'section80CCD2',
                        e.target.checked,
                        50000,
                        'Employer NPS 80CCD(2)'
                      )
                    }
                    className="mt-0.5 h-4 w-4 rounded border-[#CBD5E1] text-[#2563EB] cursor-pointer"
                  />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <label
                        htmlFor="ded-nps-emp"
                        className="text-xs font-medium text-[#172B4D] cursor-pointer"
                      >
                        Employer NPS Contribution (80CCD(2))
                      </label>
                      <AskWhyButton
                        onClick={() =>
                          void onAskQuestion(
                            'Is Employer NPS under Section 80CCD(2) allowed in both New and Old tax regimes?'
                          )
                        }
                      />
                    </div>
                    <div className="text-[11px] text-[#64748B]">
                      Eligible in both New &amp; Old Regimes (up to 14% / 10% of basic salary)
                    </div>
                  </div>
                </div>
                <InlineCurrencyInput
                  ariaLabel="Employer NPS Amount"
                  value={Number(inputs.section80CCD2 ?? 0)}
                  onCommit={(val) =>
                    onFieldAction({
                      fieldKey: 'section80CCD2',
                      action: 'edit',
                      numericValue: val,
                    })
                  }
                />
              </div>

              {Number(inputs.section80CCD2 ?? 0) > 0 && (
                <div className="pl-6">
                  <label className="inline-flex items-center gap-2 text-xs text-[#64748B] cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={busyFieldKey === 'isGovernmentEmployer'}
                      checked={Boolean(inputs.isGovernmentEmployer)}
                      onChange={(e) =>
                        void toggleBooleanFlag('isGovernmentEmployer', e.target.checked)
                      }
                      className="h-3.5 w-3.5 rounded border-[#CBD5E1] text-[#2563EB] cursor-pointer"
                    />
                    <span>Government employer</span>
                  </label>
                </div>
              )}
            </div>

            {/* HRA Exemption & Professional Tax */}
            <div className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-start gap-2.5">
                <input
                  id="ded-hra"
                  type="checkbox"
                  disabled={busyFieldKey === 'hraExemption'}
                  checked={inputs.hraExemption > 0}
                  onChange={(e) =>
                    void toggleNumericDeduction(
                      'hraExemption',
                      e.target.checked,
                      120000,
                      'HRA Exemption'
                    )
                  }
                  className="mt-0.5 h-4 w-4 rounded border-[#CBD5E1] text-[#2563EB] cursor-pointer"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <label
                      htmlFor="ded-hra"
                      className="text-xs font-medium text-[#172B4D] cursor-pointer"
                    >
                      House Rent Allowance (HRA Exemption)
                    </label>
                    <AskWhyButton
                      onClick={() =>
                        void onAskQuestion(
                          'Can I claim HRA exemption under the New Tax Regime or only under the Old Regime?'
                        )
                      }
                    />
                  </div>
                  <div className="text-[11px] text-[#64748B]">
                    Exempt rent portion shown in Form 16 (Old Regime)
                  </div>
                </div>
              </div>
              <InlineCurrencyInput
                ariaLabel="HRA Exemption Amount"
                value={inputs.hraExemption}
                onCommit={(val) =>
                  onFieldAction({
                    fieldKey: 'hraExemption',
                    action: 'edit',
                    numericValue: val,
                  })
                }
              />
            </div>
          </div>
        </section>

        {/* Section 3: Minimal New vs Old Regime Comparison Cards */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[#172B4D]">
                Choose your tax regime
              </h2>
              <p className="text-[11px] text-[#64748B]">
                {netSavingsInRecommended > 0
                  ? `${
                      recommendedRegime === 'new' ? 'New Regime' : 'Old Regime'
                    } saves you ${formatINR(netSavingsInRecommended)} based on your current numbers.`
                  : 'Both regimes yield the same total tax right now.'}
              </p>
            </div>
            <AskWhyButton
              label="Why this recommendation?"
              onClick={() =>
                void onAskQuestion(
                  `Compare New Regime (tax ${formatINR(newRegime.totalTaxLiability)}) vs Old Regime (tax ${formatINR(oldRegime.totalTaxLiability)}) for my return and explain why ${
                    recommendedRegime === 'new' ? 'New Regime' : 'Old Regime'
                  } is recommended.`
                )
              }
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(['new', 'old'] as TaxRegime[]).map((regimeKey) => {
              const calc = regimeKey === 'new' ? newRegime : oldRegime;
              const isSelected = activeDraft.selectedRegime === regimeKey;
              const isRecommended = recommendedRegime === regimeKey;
              const netIsRefund = calc.refundDue > 0;
              const netAmount = netIsRefund ? calc.refundDue : calc.netTaxPayable;

              return (
                <div
                  key={regimeKey}
                  className={`rounded-xl border p-5 transition-colors bg-white flex flex-col justify-between space-y-4 ${
                    isSelected
                      ? 'border-[#2563EB] ring-1 ring-[#2563EB]'
                      : 'border-[#E2E8F0]'
                  }`}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-bold text-[#172B4D]">
                          {regimeKey === 'new' ? 'New Regime' : 'Old Regime'}
                        </div>
                        <div className="text-[11px] text-[#64748B]">
                          {regimeKey === 'new'
                            ? 'Lower slab rates · Standard deduction ₹75,000'
                            : 'Allows HRA, 80C, 80D & NPS deductions'}
                        </div>
                      </div>
                      {isRecommended && (
                        <span className="text-[11px] font-semibold text-[#0D9488] bg-teal-50/90 border border-teal-200 px-2 py-0.5 rounded">
                          Recommended
                        </span>
                      )}
                    </div>

                    <div className="space-y-2.5 pt-2 border-t border-[#E2E8F0] text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-[#64748B]">Taxable Income</span>
                        <span className="font-mono tabular-nums font-medium text-[#172B4D]">
                          {formatINR(calc.taxableIncome)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[#64748B]">Total Tax</span>
                        <span className="font-mono tabular-nums font-semibold text-[#172B4D]">
                          {formatINR(calc.totalTaxLiability)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0]">
                        <span className="font-medium text-[#172B4D]">
                          {netIsRefund ? 'Net Refund Due' : 'Balance Payable'}
                        </span>
                        <span
                          className={`font-mono tabular-nums text-sm font-bold ${
                            netIsRefund
                              ? 'text-[#0D9488]'
                              : netAmount > 0
                                ? 'text-amber-700'
                                : 'text-[#172B4D]'
                          }`}
                        >
                          {formatINR(netAmount)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2">
                    <button
                      type="button"
                      onClick={onOpenBreakdown}
                      className="text-xs font-medium text-[#2563EB] hover:underline cursor-pointer"
                    >
                      View breakdown
                    </button>
                    <Button
                      variant={isSelected ? 'primary' : 'outline'}
                      size="sm"
                      loading={busyFieldKey === `regime_${regimeKey}`}
                      icon={isSelected ? <Check className="w-3.5 h-3.5" /> : undefined}
                      onClick={async () => {
                        if (isSelected) return;
                        setBusyFieldKey(`regime_${regimeKey}`);
                        try {
                          await onFieldAction({
                            fieldKey: 'preferredRegime',
                            action: 'edit',
                            stringValue: regimeKey,
                          });
                        } finally {
                          setBusyFieldKey(null);
                        }
                      }}
                    >
                      {isSelected ? 'Selected' : `Use ${regimeKey === 'new' ? 'New' : 'Old'}`}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Section 4: Complete Taxpayer, Contact, Employer & Refund Bank Details */}
        <section className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[#172B4D]">
                Personal, Contact &amp; Refund Bank Details
              </h2>
              <p className="text-[11px] text-[#64748B]">
                Auto-filled from your uploaded documents — review every detail or click Edit Details to make changes.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {profileSavedNote && (
                <span className="text-[11px] font-medium text-[#0D9488]">Saved</span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditingProfile((v) => !v)}
              >
                {editingProfile ? 'Cancel' : 'Edit Details'}
              </Button>
            </div>
          </div>

          {!editingProfile ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-3.5 text-xs pt-2 border-t border-[#E2E8F0]">
              {[
                { key: 'fullName', label: 'Full Name', value: profile.fullName },
                {
                  key: 'pan',
                  label: 'PAN',
                  value: profile.pan ? maskPan(profile.pan) : '',
                  mono: true,
                },
                { key: 'dateOfBirth', label: 'Date of Birth', value: profile.dateOfBirth, mono: true },
                {
                  key: 'aadhaarLast4',
                  label: 'Aadhaar (Last 4)',
                  value: profile.aadhaarLast4 ? `XXXX-XXXX-${profile.aadhaarLast4}` : '',
                  mono: true,
                },
                {
                  key: 'residentialStatus',
                  label: 'Residential Status',
                  value: profile.residentialStatus,
                },
                { key: 'email', label: 'Email Address', value: profile.email },
                { key: 'phone', label: 'Mobile Number', value: profile.phone, mono: true },
                {
                  key: 'address',
                  label: 'Residential Address',
                  value: profile.address || '',
                  wide: true,
                },
                {
                  key: 'verificationPlace',
                  label: 'Filing Place / City',
                  value: profile.verificationPlace || '',
                },
                { key: 'employerName', label: 'Employer Name', value: profile.employerName },
                { key: 'employerTan', label: 'Employer TAN', value: profile.employerTan, mono: true },
                { key: 'bankName', label: 'Refund Bank', value: profile.bankName },
                {
                  key: 'bankAccountNumber',
                  label: 'Account Number',
                  value: profile.bankAccountNumber
                    ? maskAccountNumber(profile.bankAccountNumber)
                    : '',
                  mono: true,
                },
                { key: 'bankIfsc', label: 'Bank IFSC', value: profile.bankIfsc, mono: true },
              ].map((item) => {
                const sourceDoc = fieldStates[item.key]?.sourceDocument;
                return (
                  <div
                    key={item.key}
                    className={item.wide ? 'sm:col-span-2 lg:col-span-2' : ''}
                  >
                    <div className="text-[11px] text-[#64748B]">{item.label}</div>
                    <div
                      className={`mt-0.5 ${
                        item.value ? 'font-medium text-[#172B4D]' : 'text-[#94A3B8]'
                      } ${item.mono ? 'font-mono tabular-nums' : ''}`}
                    >
                      {item.value || 'Not entered'}
                    </div>
                    {sourceDoc && (
                      <div className="text-[10px] text-[#64748B] truncate mt-0.5">
                        {sourceDoc}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <form onSubmit={handleSaveProfileForm} className="space-y-4 pt-2 border-t border-[#E2E8F0]">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                {[
                  { key: 'fullName', label: 'Full Name', placeholder: 'e.g. Aarav Mehta' },
                  { key: 'pan', label: 'PAN', placeholder: 'ABCDE1234F' },
                  { key: 'dateOfBirth', label: 'Date of Birth (YYYY-MM-DD)', placeholder: '1993-08-14' },
                  { key: 'aadhaarLast4', label: 'Aadhaar Last 4 Digits', placeholder: '4821' },
                  { key: 'email', label: 'Email Address', placeholder: 'name@example.com' },
                  { key: 'phone', label: 'Mobile Number', placeholder: '+91 98204 51120' },
                  {
                    key: 'address',
                    label: 'Residential Address',
                    placeholder: 'House / Street / City / PIN',
                    wide: true,
                  },
                  { key: 'verificationPlace', label: 'Filing Place / City', placeholder: 'e.g. Bengaluru' },
                  { key: 'employerName', label: 'Employer Name', placeholder: 'Company name' },
                  { key: 'employerTan', label: 'Employer TAN', placeholder: 'BLRN04821D' },
                  { key: 'bankName', label: 'Refund Bank Name', placeholder: 'e.g. HDFC Bank' },
                  { key: 'bankAccountNumber', label: 'Bank Account Number', placeholder: 'Account number' },
                  { key: 'bankIfsc', label: 'Bank IFSC Code', placeholder: 'HDFC0001204' },
                ].map((f) => (
                  <div key={f.key} className={`space-y-1 ${f.wide ? 'sm:col-span-2 lg:col-span-2' : ''}`}>
                    <label className="block text-[11px] font-medium text-[#64748B]">
                      {f.label}
                    </label>
                    <input
                      type="text"
                      placeholder={f.placeholder}
                      value={String(profileForm[f.key as keyof UserProfile] ?? '')}
                      onChange={(e) =>
                        setProfileForm((prev) => ({
                          ...prev,
                          [f.key]: e.target.value,
                        }))
                      }
                      className="w-full px-2.5 py-1.5 text-xs border border-[#E2E8F0] rounded-lg bg-[#F8FAFC] focus:bg-white focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setProfileForm(profile);
                    setEditingProfile(false);
                  }}
                >
                  Discard
                </Button>
                <Button type="submit" variant="primary" size="sm" loading={savingProfile}>
                  Save Profile Details
                </Button>
              </div>
            </form>
          )}
        </section>

        <div className="flex items-center justify-between gap-3 pt-2">
          <Button
            variant="outline"
            size="md"
            icon={<ArrowLeft className="w-4 h-4" />}
            onClick={() => onStepChange('upload')}
          >
            Back to Upload
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={() => onStepChange('submit')}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Continue to Approve &amp; Submit
          </Button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // STEP 3 · APPROVE & SUBMIT
  // =========================================================================
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[#172B4D]">
          {isFinalized ? 'Your return is finalized' : 'Review final summary & approve'}
        </h1>
        <p className="text-xs sm:text-[13px] text-[#64748B] mt-0.5">
          {isFinalized
            ? 'Your local ITR-1 draft package is verified and ready to download.'
            : 'Double-check your final figures below, confirm accuracy, and approve to generate your ITR-1 filing package.'}
        </p>
      </div>

      {/* Simulated Filing Confirmation Banner when Finalized */}
      {isFinalized && (
        <div className="p-6 rounded-xl bg-teal-50/70 border border-teal-200 space-y-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-[#0D9488] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="text-sm font-semibold text-[#172B4D]">
                ITR-1 Draft Ready (Simulated Local Filing Confirmation)
              </div>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Approved by {activeDraft.approvedBy || 'Taxpayer'} · Draft v{activeDraft.version}. Nothing is automatically submitted to the Income Tax Department portal — download your ITR-1 JSON and filing receipt below.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              variant="primary"
              size="md"
              icon={<Download className="w-4 h-4" />}
              onClick={onDownloadItrJson}
            >
              Download ITR-1 JSON
            </Button>
            <Button
              variant="outline"
              size="md"
              icon={<FileJson2 className="w-4 h-4" />}
              onClick={onDownloadReceiptAndAudit}
            >
              Download Receipt &amp; Activity Log
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenActivityDrawer}
            >
              View Activity &amp; Security
            </Button>
          </div>
        </div>
      )}

      {/* Attention Warning if items still unresolved */}
      {!isFinalized && attentionCount > 0 && (
        <div className="px-4 py-3 rounded-xl bg-amber-50/70 border border-amber-200 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-[#172B4D]">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              {attentionCount} {attentionCount === 1 ? 'item still needs' : 'items still need'} review before finalizing.
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onStepChange('review')}
          >
            Fix in Step 2
          </Button>
        </div>
      )}

      {/* Final Return Summary Card */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        <div className="px-6 py-4 bg-[#F8FAFC] border-b border-[#E2E8F0] flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-[#172B4D]">
              ITR-1 (Sahaj) · Assessment Year {snapshot.activeSession.assessmentYear}
            </div>
            <div className="text-[11px] text-[#64748B] mt-0.5">
              {profile.fullName || 'Taxpayer'} ·{' '}
              {profile.pan ? maskPan(profile.pan) : 'PAN not set'} ·{' '}
              {activeDraft.selectedRegime === 'new' ? 'New Regime' : 'Old Regime'}
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenBreakdown}
            className="text-xs font-medium text-[#2563EB] hover:underline cursor-pointer"
          >
            View breakdown
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#E2E8F0]">
          <div className="p-4">
            <div className="text-[11px] text-[#64748B]">Gross Total Income</div>
            <div className="text-base font-bold font-mono tabular-nums text-[#172B4D] mt-1">
              {formatINR(selectedCalc.grossTotalIncome)}
            </div>
          </div>
          <div className="p-4">
            <div className="text-[11px] text-[#64748B]">Taxable Income</div>
            <div className="text-base font-bold font-mono tabular-nums text-[#172B4D] mt-1">
              {formatINR(selectedCalc.taxableIncome)}
            </div>
          </div>
          <div className="p-4">
            <div className="text-[11px] text-[#64748B]">Total Tax Liability</div>
            <div className="text-base font-bold font-mono tabular-nums text-[#172B4D] mt-1">
              {formatINR(selectedCalc.totalTaxLiability)}
            </div>
          </div>
          <div className="p-4">
            <div className="text-[11px] text-[#64748B]">
              {selectedCalc.refundDue > 0 ? 'Net Refund Due' : 'Balance Payable'}
            </div>
            <div
              className={`text-base font-bold font-mono tabular-nums mt-1 ${
                selectedCalc.refundDue > 0
                  ? 'text-[#0D9488]'
                  : selectedCalc.netTaxPayable > 0
                    ? 'text-amber-700'
                    : 'text-[#172B4D]'
              }`}
            >
              {formatINR(
                selectedCalc.refundDue > 0
                  ? selectedCalc.refundDue
                  : selectedCalc.netTaxPayable
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[#E2E8F0] space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <div className="text-[11px] text-[#64748B]">Taxpayer &amp; Contact</div>
              <div className="font-medium text-[#172B4D] mt-0.5">
                {profile.fullName || 'Not set'} · DOB {profile.dateOfBirth || '—'}
              </div>
              <div className="text-[11px] text-[#64748B] truncate">
                {profile.email || 'Email not set'} · {profile.phone || 'Phone not set'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[#64748B]">Aadhaar &amp; Address</div>
              <div className="font-mono text-[#172B4D] mt-0.5">
                {profile.aadhaarLast4 ? `XXXX-XXXX-${profile.aadhaarLast4}` : 'Aadhaar not set'}
              </div>
              <div className="text-[11px] text-[#64748B] truncate">
                {profile.address || 'Address not entered'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-[#64748B]">Refund Bank &amp; Employer</div>
              <div className="font-medium text-[#172B4D] mt-0.5">
                {profile.bankName || 'Not added'}{' '}
                {profile.bankAccountNumber
                  ? `(${maskAccountNumber(profile.bankAccountNumber)} · ${profile.bankIfsc})`
                  : ''}
              </div>
              <div className="text-[11px] text-[#64748B] truncate">
                {profile.employerName || 'Employer not set'}
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setEditingProfile(true);
                onStepChange('review');
              }}
              className="text-xs font-medium text-[#2563EB] hover:underline cursor-pointer"
            >
              Edit personal or bank details
            </button>
            <button
              type="button"
              onClick={() => setShowJsonPreview((v) => !v)}
              className="text-xs font-medium text-[#64748B] hover:text-[#172B4D] cursor-pointer"
            >
              {showJsonPreview ? 'Hide ITR-1 JSON' : 'Preview ITR-1 JSON'}
            </button>
          </div>
        </div>
      </div>

      {showJsonPreview && (
        <LightCodeBlock
          title={`ITR-1 Draft v${activeDraft.version} JSON`}
          maxHeightClass="max-h-80"
          code={JSON.stringify(activeDraft.itrJson, null, 2)}
        />
      )}

      {/* Declaration & Final Approval Button */}
      {!isFinalized && (
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4">
          <label className="flex items-start gap-2.5 text-xs text-[#172B4D] cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(profile.verificationConfirmed)}
              onChange={(e) =>
                void onFieldAction({
                  fieldKey: 'verificationConfirmed',
                  action: 'edit',
                  stringValue: e.target.checked ? 'true' : 'false',
                })
              }
              className="mt-0.5 h-4 w-4 rounded border-[#CBD5E1] text-[#2563EB] cursor-pointer"
            />
            <span className="leading-relaxed">
              I confirm that the income, deductions, TDS credits, and bank account details shown above are true and complete to the best of my knowledge.
            </span>
          </label>

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#E2E8F0]">
            <Button
              variant="outline"
              size="md"
              icon={<ArrowLeft className="w-4 h-4" />}
              onClick={() => onStepChange('review')}
            >
              Back to Review
            </Button>
            <Button
              variant="primary"
              size="lg"
              disabled={!profile.verificationConfirmed || unsupportedFlags.length > 0}
              icon={<ShieldCheck className="w-4 h-4" />}
              onClick={onOpenFinalizeModal}
            >
              Approve &amp; Finalize Return
            </Button>
          </div>
        </div>
      )}

      {isFinalized && (
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="md"
            icon={<ArrowLeft className="w-4 h-4" />}
            onClick={() => onStepChange('review')}
          >
            Edit Return Figures
          </Button>
          <span className="text-xs text-[#64748B]">
            Need to file another return? Use <strong className="text-[#172B4D]">New Return</strong> in the header.
          </span>
        </div>
      )}
    </div>
  );
};
