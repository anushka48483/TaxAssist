import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  FileCheck2,
  FileUp,
  Loader2,
  MessageSquare,
  Scale,
  Send,
  Sparkles,
  User,
} from 'lucide-react';
import {
  DOCUMENT_CATEGORY_LABELS,
  TaxRegime,
  UserProfile,
  WorkspaceSnapshot,
} from '../shared/types';
import { formatINR, formatShortTime } from '../utils/format';
import { GuidedStepId } from './DashboardView';
import { Button, StatusIndicator, SurfaceCard } from './DesignSystem';
import { FieldActionPayload, Itr1FormLiveView } from './Itr1FormLiveView';
import { MarkdownMessage } from './MarkdownMessage';

interface LiveFilingWorkspaceViewProps {
  snapshot: WorkspaceSnapshot;
  activeStep: GuidedStepId;
  onStepChange: (step: GuidedStepId) => void;
  activeFieldKey: string | null;
  recentlyUpdatedFieldKeys: string[];
  sseConnected: boolean;
  onUploadFiles: (files: File[]) => Promise<void>;
  onStartDemo: () => Promise<void>;
  onUpdateProfile: (partial: Partial<UserProfile>) => Promise<void>;
  onFieldAction: (payload: FieldActionPayload) => Promise<void>;
  onResolveApproval: (
    approvalId: string,
    action: 'approve' | 'reject' | 'cancel'
  ) => Promise<void>;
  onSendAssistantMessage?: (message: string) => Promise<void>;
  onStageFinalizeReturn: (regime: TaxRegime) => Promise<void>;
  onOpenReturnPreview: () => void;
  onOpenTaxSummary: () => void;
}

const STEPS: Array<{
  id: GuidedStepId;
  num: number;
  label: string;
  sectionCode: string;
}> = [
  { id: 'upload-docs', num: 1, label: 'Upload Documents', sectionCode: 'C' },
  { id: 'review-extracted', num: 2, label: 'Verify & Edit', sectionCode: 'D' },
  { id: 'personal-info', num: 3, label: 'Missing Details', sectionCode: 'A' },
  { id: 'resolve-differences', num: 4, label: 'Instruct AI & Confirm', sectionCode: 'E' },
  { id: 'tax-calculation', num: 5, label: 'Tax Calculation', sectionCode: 'G' },
  { id: 'review-download', num: 6, label: 'Review & Download', sectionCode: 'K' },
];

const NEEDED_DOC_GUIDE = [
  {
    doc: 'Form 16 (Part A & B)',
    autoFills: 'Your Name, PAN, Employer Name/TAN, Gross Salary, TDS u/s 192',
    optional: false,
  },
  {
    doc: 'Bank Statements / Passbook',
    autoFills: 'Bank Name, Account Number, IFSC, Savings Bank Interest (u/s 80TTA)',
    optional: false,
  },
  {
    doc: 'FD / Interest Certificates',
    autoFills: 'Fixed Deposit Interest & TDS deducted u/s 194A',
    optional: true,
  },
  {
    doc: 'Investment Proofs (80C / 80D / NPS)',
    autoFills: 'PPF/ELSS/LIC (80C), Health Insurance (80D), NPS (80CCD)',
    optional: true,
  },
  {
    doc: 'Form 26AS / AIS Summary',
    autoFills: 'Cross-checks all TDS credits & bank interest reported',
    optional: true,
  },
];

interface ProfileGapField {
  key: keyof UserProfile;
  label: string;
  placeholder: string;
  type?: 'text' | 'email' | 'date';
  maxLength?: number;
  uppercase?: boolean;
  mono?: boolean;
}

const REQUIRED_PROFILE_GAPS: ProfileGapField[] = [
  { key: 'fullName', label: 'Full Name (as per PAN)', placeholder: 'Enter your full name' },
  {
    key: 'pan',
    label: 'PAN',
    placeholder: 'e.g. ABCDE1234F',
    maxLength: 10,
    uppercase: true,
    mono: true,
  },
  { key: 'dateOfBirth', label: 'Date of Birth', placeholder: 'YYYY-MM-DD', type: 'date', mono: true },
  {
    key: 'aadhaarLast4',
    label: 'Aadhaar Last 4 Digits',
    placeholder: 'e.g. 1234',
    maxLength: 4,
    mono: true,
  },
  { key: 'email', label: 'Email Address', placeholder: 'you@example.com', type: 'email' },
  { key: 'phone', label: 'Mobile Number', placeholder: 'e.g. +91-98765-43210' },
  { key: 'bankName', label: 'Refund Bank Name', placeholder: 'e.g. State Bank of India' },
  {
    key: 'bankAccountNumber',
    label: 'Refund Bank Account Number',
    placeholder: 'Account number',
    mono: true,
  },
  {
    key: 'bankIfsc',
    label: 'Bank IFSC Code',
    placeholder: 'e.g. SBIN0001234',
    maxLength: 11,
    uppercase: true,
    mono: true,
  },
];

export const LiveFilingWorkspaceView: React.FC<LiveFilingWorkspaceViewProps> = ({
  snapshot,
  activeStep,
  onStepChange,
  activeFieldKey,
  recentlyUpdatedFieldKeys,
  sseConnected,
  onUploadFiles,
  onStartDemo,
  onUpdateProfile,
  onFieldAction,
  onResolveApproval,
  onSendAssistantMessage,
  onStageFinalizeReturn,
  onOpenReturnPreview,
  onOpenTaxSummary,
}) => {
  const {
    profile,
    documents,
    activeDraft,
    reconciliation,
    approvals,
    chatHistory = [],
    fieldStates = {},
    liveEvents = [],
  } = snapshot;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<UserProfile>({ ...profile });
  const [profileSavedToast, setProfileSavedToast] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  // Natural-language instruction bar state (Step 4)
  const [instructionInput, setInstructionInput] = useState('');
  const [sendingInstruction, setSendingInstruction] = useState(false);
  const [instructionError, setInstructionError] = useState<string | null>(null);

  useEffect(() => {
    setProfileForm({ ...profile });
  }, [profile]);

  const missingProfileGaps = useMemo(
    () =>
      REQUIRED_PROFILE_GAPS.filter((item) => {
        const val = profile[item.key];
        return typeof val !== 'string' || val.trim().length === 0;
      }),
    [profile]
  );

  const missingGapKeySet = useMemo(
    () => new Set(missingProfileGaps.map((g) => g.key)),
    [missingProfileGaps]
  );

  const pendingFields = useMemo(
    () =>
      Object.values(fieldStates).filter(
        (f) => f.status === 'pending_confirmation' || f.status === 'needs_review'
      ),
    [fieldStates]
  );

  const pendingApprovals = useMemo(
    () => approvals.filter((a) => a.status === 'pending'),
    [approvals]
  );

  const latestAssistantReply = useMemo(() => {
    const hasUserAsked = chatHistory.some((m) => m.role === 'user');
    if (!hasUserAsked) return null;
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      if (chatHistory[i].role === 'assistant') {
        return chatHistory[i];
      }
    }
    return null;
  }, [chatHistory]);

  const calc =
    activeDraft.selectedRegime === 'new'
      ? activeDraft.taxSummary.newRegime
      : activeDraft.taxSummary.oldRegime;

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      await onUploadFiles(Array.from(files));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileSavedToast(false);
    try {
      await onUpdateProfile(profileForm);
      setProfileSavedToast(true);
      setTimeout(() => setProfileSavedToast(false), 2500);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleRunInstruction = async (promptText?: string) => {
    const query = (promptText ?? instructionInput).trim();
    if (!query || !onSendAssistantMessage || sendingInstruction) return;
    setSendingInstruction(true);
    setInstructionError(null);
    try {
      await onSendAssistantMessage(query);
      if (!promptText) {
        setInstructionInput('');
      }
    } catch (err) {
      setInstructionError(
        err instanceof Error ? err.message : 'Unable to process your instruction.'
      );
    } finally {
      setSendingInstruction(false);
    }
  };

  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(activeDraft.itrJson, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ITR1_AY2026-27_Draft_v${activeDraft.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const currentStepMeta = STEPS.find((s) => s.id === activeStep) ?? STEPS[0];
  const latestLiveEvents = useMemo(() => [...liveEvents].reverse().slice(0, 35), [liveEvents]);
  const isActivelyStreaming = liveEvents.some((e) => e.status === 'active') && uploading;

  return (
    <div className="space-y-5">
      {/* Guided Horizontal 6-Step Bar */}
      <SurfaceCard noPadding>
        <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-[#E2E8F0] bg-[#F8FAFC]">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#172B4D]">
            <Sparkles className="w-4 h-4 text-[#2563EB]" />
            <span>Guided ITR-1 Filing Workspace</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-[#64748B]">
            <span
              className={`w-2 h-2 rounded-full ${
                sseConnected ? 'bg-[#0D9488]' : 'bg-amber-500'
              }`}
            />
            <span>{sseConnected ? 'Live sync active' : 'Reconnecting live sync…'}</span>
          </div>
        </div>

        <nav
          aria-label="Guided filing steps"
          className="px-3 py-2.5 flex items-center gap-1.5 overflow-x-auto"
        >
          {STEPS.map((step) => {
            const active = step.id === activeStep;
            const stepPendingCount =
              step.id === 'resolve-differences'
                ? pendingFields.length + pendingApprovals.length
                : step.id === 'personal-info' && documents.length > 0
                  ? missingProfileGaps.length
                  : 0;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => onStepChange(step.id)}
                className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#2563EB] text-white'
                    : 'bg-white text-[#172B4D] border border-[#E2E8F0] hover:bg-[#F8FAFC]'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center ${
                    active ? 'bg-white text-[#2563EB]' : 'bg-[#F8FAFC] text-[#64748B]'
                  }`}
                >
                  {step.num}
                </span>
                <span>{step.label}</span>
                {stepPendingCount > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      active
                        ? 'bg-white/20 text-white'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {stepPendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </SurfaceCard>

      {/* Split View: Left = Guided Step & Live Progress | Right = Live ITR-1 Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (5 cols): Contextual Step Controls + Real-Time Progress Feed */}
        <div className="lg:col-span-5 space-y-5">
          {/* Step 1: Upload Documents (Upload-First with Upfront Document Guide) */}
          {activeStep === 'upload-docs' && (
            <SurfaceCard className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-[#172B4D]">
                  Step 1 · Upload Your Tax Documents
                </h2>
                <p className="text-xs text-[#64748B] mt-0.5 leading-relaxed">
                  Just upload what you have. TaxShield extracts personal, bank, salary, interest, and deduction details automatically and fills your ITR-1 form on the right live.
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.txt,.png,.jpg,.jpeg"
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFilesSelected(e.dataTransfer.files);
                }}
                className="border-2 border-dashed border-[#CBD5E1] rounded-xl p-5 text-center bg-[#F8FAFC] space-y-2.5"
              >
                <div className="w-9 h-9 rounded-lg bg-white border border-[#E2E8F0] text-[#2563EB] flex items-center justify-center mx-auto">
                  {uploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileUp className="w-4 h-4" />
                  )}
                </div>
                <div className="text-xs font-medium text-[#172B4D]">
                  {uploading
                    ? 'Reading documents & auto-filling your ITR-1 form live…'
                    : 'Drop Form 16, Bank Statements, FD Certificates, 26AS, or Proofs here'}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose Files
                  </Button>
                  {documents.length === 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      loading={seedingDemo}
                      onClick={async () => {
                        setSeedingDemo(true);
                        try {
                          await onStartDemo();
                        } finally {
                          setSeedingDemo(false);
                        }
                      }}
                    >
                      Try Sample Tax Pack
                    </Button>
                  )}
                </div>
              </div>

              {/* Upfront Checklist of What Details We Need & Auto-Fill */}
              <div className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
                <div className="px-3.5 py-2.5 bg-[#F8FAFC] border-b border-[#E2E8F0] flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                    What You Need to Upload (Auto-Fills Your Return)
                  </span>
                  <span className="text-[11px] text-[#0D9488] font-medium">
                    No tedious typing
                  </span>
                </div>
                <div className="divide-y divide-[#E2E8F0] text-xs">
                  {NEEDED_DOC_GUIDE.map((item) => (
                    <div key={item.doc} className="px-3.5 py-2.5 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-[#172B4D]">{item.doc}</div>
                        <div className="text-[11px] text-[#64748B] mt-0.5 leading-snug">
                          Auto-fills: {item.autoFills}
                        </div>
                      </div>
                      <span className="text-[10px] font-medium text-[#64748B] shrink-0 mt-0.5">
                        {item.optional ? 'If applicable' : 'Core'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {documents.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                    Uploaded Documents ({documents.length})
                  </div>
                  <div className="divide-y divide-[#E2E8F0] border border-[#E2E8F0] rounded-lg bg-white">
                    {documents.map((doc) => (
                      <div
                        key={doc.id}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-[#172B4D] truncate">
                            {doc.fileName}
                          </div>
                          <div className="text-[11px] text-[#64748B]">
                            {DOCUMENT_CATEGORY_LABELS[doc.category]} · {doc.extractedFacts.length} facts
                          </div>
                        </div>
                        <StatusIndicator
                          tone={
                            doc.processingStatus === 'error'
                              ? 'error'
                              : doc.needsUserReview
                                ? 'warning'
                                : 'success'
                          }
                          label={
                            doc.processingStatus === 'error'
                              ? 'Error'
                              : doc.needsUserReview
                                ? 'Check'
                                : 'Read'
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant={documents.length > 0 ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => onStepChange('review-extracted')}
                  rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                >
                  {documents.length > 0
                    ? 'Next: Verify Extracted Details'
                    : 'Next: Check Extracted Details'}
                </Button>
              </div>
            </SurfaceCard>
          )}

          {/* Step 2: Verify & Edit Extracted Information + Missing Gaps Only */}
          {activeStep === 'review-extracted' && (
            <SurfaceCard className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-[#172B4D]">
                    Step 2 · Verify &amp; Edit Extracted Details
                  </h2>
                  <p className="text-xs text-[#64748B] mt-0.5 leading-relaxed">
                    Did we extract everything right? Check your auto-filled details below and in the live ITR-1 form on the right. Click any value in the form to edit anything that looks wrong.
                  </p>
                </div>
                {profileSavedToast && (
                  <StatusIndicator tone="success" label="Saved" />
                )}
              </div>

              {documents.length === 0 ? (
                <div className="p-4 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] text-xs space-y-2.5">
                  <div className="font-semibold text-[#172B4D]">No documents uploaded yet</div>
                  <p className="text-[#64748B] leading-relaxed">
                    Upload your Form 16, bank statements, or investment proofs in Step 1 first so we can auto-fill your return for you.
                  </p>
                  <Button variant="primary" size="sm" onClick={() => onStepChange('upload-docs')}>
                    Go to Upload Documents
                  </Button>
                </div>
              ) : (
                <>
                  {/* Uploaded Documents Extraction Check */}
                  <div className="rounded-xl border border-[#E2E8F0] bg-white divide-y divide-[#E2E8F0]">
                    {documents.map((doc) => (
                      <div key={doc.id} className="p-3.5 space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-[#172B4D] truncate">
                              {doc.fileName}
                            </div>
                            <div className="text-[11px] text-[#64748B]">
                              {DOCUMENT_CATEGORY_LABELS[doc.category]} · {doc.extractedFacts.length} extracted item(s)
                            </div>
                          </div>
                          <StatusIndicator
                            tone={doc.needsUserReview ? 'warning' : 'success'}
                            label={doc.needsUserReview ? 'Needs Check' : 'Extracted'}
                          />
                        </div>
                        {doc.extractedFacts.length > 0 && (
                          <div className="grid grid-cols-1 gap-1.5 pt-1">
                            {doc.extractedFacts.slice(0, 6).map((fact) => (
                              <div
                                key={fact.id}
                                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[#F8FAFC] border border-[#E2E8F0]/80 text-[11px]"
                              >
                                <span className="text-[#64748B] truncate">{fact.label}</span>
                                <span className="font-mono font-semibold text-[#172B4D] shrink-0">
                                  {fact.formattedValue}
                                </span>
                              </div>
                            ))}
                            {doc.extractedFacts.length > 6 && (
                              <div className="text-[11px] text-[#64748B] px-1">
                                +{doc.extractedFacts.length - 6} more item(s) shown in the live ITR-1 form →
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Prompt to Edit Anything Wrong */}
                  <div className="p-3 rounded-lg bg-blue-50/60 border border-blue-200/80 text-xs text-[#172B4D] flex items-start gap-2.5">
                    <Edit3 className="w-4 h-4 text-[#2563EB] shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="font-semibold">Notice anything extracted incorrectly?</div>
                      <div className="text-[#64748B] leading-snug">
                        Click any row in the live ITR-1 form on the right to edit numbers or text immediately, or edit personal/bank details in Step 3.
                      </div>
                    </div>
                  </div>

                  {/* Only Remaining Missing Fields */}
                  {missingProfileGaps.length === 0 ? (
                    <div className="p-3.5 rounded-lg bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold">
                          All required personal &amp; bank details were auto-filled!
                        </div>
                        <div className="text-emerald-800 mt-0.5">
                          Nothing else is missing before instructing TaxShield AI.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <form
                      onSubmit={handleSaveProfile}
                      className="p-4 rounded-xl border border-amber-200 bg-amber-50/40 space-y-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-[#172B4D]">
                            Only Missing Details ({missingProfileGaps.length})
                          </div>
                          <div className="text-[11px] text-[#64748B]">
                            These fields weren&apos;t found in your uploaded documents — fill only what&apos;s needed:
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {missingProfileGaps.map((gap) => (
                          <div key={gap.key}>
                            <label className="block text-[11px] font-medium text-[#172B4D] mb-1">
                              {gap.label}
                            </label>
                            <input
                              type={gap.type || 'text'}
                              maxLength={gap.maxLength}
                              placeholder={gap.placeholder}
                              value={String(profileForm[gap.key] || '')}
                              onChange={(e) => {
                                const raw = e.target.value;
                                setProfileForm({
                                  ...profileForm,
                                  [gap.key]: gap.uppercase ? raw.toUpperCase() : raw,
                                });
                              }}
                              className={`w-full px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg focus:outline-none focus:border-[#2563EB] ${
                                gap.mono ? 'font-mono' : ''
                              }`}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <Button type="submit" variant="primary" size="sm" loading={savingProfile}>
                          Save Missing Details
                        </Button>
                        <button
                          type="button"
                          onClick={() => onStepChange('personal-info')}
                          className="text-[11px] font-medium text-[#2563EB] hover:underline cursor-pointer"
                        >
                          Edit all personal fields
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onStepChange('upload-docs')}
                >
                  + Upload More Docs
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onStepChange('resolve-differences')}
                  rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                >
                  Looks Good · Instruct AI Next
                </Button>
              </div>
            </SurfaceCard>
          )}

          {/* Step 3: Missing / Full Personal & Bank Details Editor */}
          {activeStep === 'personal-info' && (
            <SurfaceCard className="space-y-4">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E2E8F0]">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-[#2563EB]" />
                  <div>
                    <h2 className="text-sm font-semibold text-[#172B4D]">
                      Step 3 · Missing &amp; Personal Details
                    </h2>
                    <p className="text-[11px] text-[#64748B]">
                      {missingProfileGaps.length > 0
                        ? `${missingProfileGaps.length} required field(s) highlighted in amber were not in your uploads.`
                        : 'All required personal & bank fields are filled. Edit anything below if needed.'}
                    </p>
                  </div>
                </div>
                {profileSavedToast && (
                  <StatusIndicator tone="success" label="Saved to Return" />
                )}
              </div>
              <form onSubmit={handleSaveProfile} className="space-y-3 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[#64748B] mb-1">
                      Full Name (as per PAN) {missingGapKeySet.has('fullName') && <span className="text-amber-700 font-semibold">· Missing</span>}
                    </label>
                    <input
                      type="text"
                      placeholder="Enter your full name"
                      value={profileForm.fullName}
                      onChange={(e) =>
                        setProfileForm({ ...profileForm, fullName: e.target.value })
                      }
                      className={`w-full px-3 py-1.5 border rounded-lg focus:outline-none focus:border-[#2563EB] ${
                        missingGapKeySet.has('fullName') ? 'border-amber-300 bg-amber-50/30' : 'border-[#E2E8F0]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#64748B] mb-1">
                      PAN {missingGapKeySet.has('pan') && <span className="text-amber-700 font-semibold">· Missing</span>}
                    </label>
                    <input
                      type="text"
                      maxLength={10}
                      placeholder="e.g. ABCDE1234F"
                      value={profileForm.pan}
                      onChange={(e) =>
                        setProfileForm({ ...profileForm, pan: e.target.value.toUpperCase() })
                      }
                      className={`w-full px-3 py-1.5 font-mono border rounded-lg focus:outline-none focus:border-[#2563EB] ${
                        missingGapKeySet.has('pan') ? 'border-amber-300 bg-amber-50/30' : 'border-[#E2E8F0]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#64748B] mb-1">
                      Date of Birth {missingGapKeySet.has('dateOfBirth') && <span className="text-amber-700 font-semibold">· Missing</span>}
                    </label>
                    <input
                      type="date"
                      value={profileForm.dateOfBirth}
                      onChange={(e) =>
                        setProfileForm({ ...profileForm, dateOfBirth: e.target.value })
                      }
                      className={`w-full px-3 py-1.5 font-mono border rounded-lg focus:outline-none focus:border-[#2563EB] ${
                        missingGapKeySet.has('dateOfBirth') ? 'border-amber-300 bg-amber-50/30' : 'border-[#E2E8F0]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#64748B] mb-1">
                      Aadhaar Last 4 {missingGapKeySet.has('aadhaarLast4') && <span className="text-amber-700 font-semibold">· Missing</span>}
                    </label>
                    <input
                      type="text"
                      maxLength={4}
                      placeholder="e.g. 1234"
                      value={profileForm.aadhaarLast4}
                      onChange={(e) =>
                        setProfileForm({ ...profileForm, aadhaarLast4: e.target.value })
                      }
                      className={`w-full px-3 py-1.5 font-mono border rounded-lg focus:outline-none focus:border-[#2563EB] ${
                        missingGapKeySet.has('aadhaarLast4') ? 'border-amber-300 bg-amber-50/30' : 'border-[#E2E8F0]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#64748B] mb-1">
                      Email Address {missingGapKeySet.has('email') && <span className="text-amber-700 font-semibold">· Missing</span>}
                    </label>
                    <input
                      type="email"
                      placeholder="you@example.com"
                      value={profileForm.email}
                      onChange={(e) =>
                        setProfileForm({ ...profileForm, email: e.target.value })
                      }
                      className={`w-full px-3 py-1.5 border rounded-lg focus:outline-none focus:border-[#2563EB] ${
                        missingGapKeySet.has('email') ? 'border-amber-300 bg-amber-50/30' : 'border-[#E2E8F0]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#64748B] mb-1">
                      Mobile Number {missingGapKeySet.has('phone') && <span className="text-amber-700 font-semibold">· Missing</span>}
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. +91-98765-43210"
                      value={profileForm.phone}
                      onChange={(e) =>
                        setProfileForm({ ...profileForm, phone: e.target.value })
                      }
                      className={`w-full px-3 py-1.5 border rounded-lg focus:outline-none focus:border-[#2563EB] ${
                        missingGapKeySet.has('phone') ? 'border-amber-300 bg-amber-50/30' : 'border-[#E2E8F0]'
                      }`}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-medium text-[#64748B] mb-1">
                      Residential Address
                    </label>
                    <input
                      type="text"
                      placeholder="Flat / Street, City, State, PIN"
                      value={profileForm.address || ''}
                      onChange={(e) =>
                        setProfileForm({ ...profileForm, address: e.target.value })
                      }
                      className="w-full px-3 py-1.5 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#64748B] mb-1">
                      Employer Name
                    </label>
                    <input
                      type="text"
                      placeholder="Auto-filled from Form 16"
                      value={profileForm.employerName}
                      onChange={(e) =>
                        setProfileForm({ ...profileForm, employerName: e.target.value })
                      }
                      className="w-full px-3 py-1.5 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#64748B] mb-1">
                      Employer TAN
                    </label>
                    <input
                      type="text"
                      maxLength={10}
                      placeholder="e.g. BLRA12345B"
                      value={profileForm.employerTan}
                      onChange={(e) =>
                        setProfileForm({
                          ...profileForm,
                          employerTan: e.target.value.toUpperCase(),
                        })
                      }
                      className="w-full px-3 py-1.5 font-mono border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#64748B] mb-1">
                      Bank Name {missingGapKeySet.has('bankName') && <span className="text-amber-700 font-semibold">· Missing</span>}
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. State Bank of India / HDFC"
                      value={profileForm.bankName}
                      onChange={(e) =>
                        setProfileForm({ ...profileForm, bankName: e.target.value })
                      }
                      className={`w-full px-3 py-1.5 border rounded-lg focus:outline-none focus:border-[#2563EB] ${
                        missingGapKeySet.has('bankName') ? 'border-amber-300 bg-amber-50/30' : 'border-[#E2E8F0]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#64748B] mb-1">
                      Refund Bank Account {missingGapKeySet.has('bankAccountNumber') && <span className="text-amber-700 font-semibold">· Missing</span>}
                    </label>
                    <input
                      type="text"
                      placeholder="Bank account number"
                      value={profileForm.bankAccountNumber}
                      onChange={(e) =>
                        setProfileForm({ ...profileForm, bankAccountNumber: e.target.value })
                      }
                      className={`w-full px-3 py-1.5 font-mono border rounded-lg focus:outline-none focus:border-[#2563EB] ${
                        missingGapKeySet.has('bankAccountNumber') ? 'border-amber-300 bg-amber-50/30' : 'border-[#E2E8F0]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#64748B] mb-1">
                      IFSC Code {missingGapKeySet.has('bankIfsc') && <span className="text-amber-700 font-semibold">· Missing</span>}
                    </label>
                    <input
                      type="text"
                      maxLength={11}
                      placeholder="e.g. SBIN0001234"
                      value={profileForm.bankIfsc}
                      onChange={(e) =>
                        setProfileForm({
                          ...profileForm,
                          bankIfsc: e.target.value.toUpperCase(),
                        })
                      }
                      className={`w-full px-3 py-1.5 font-mono border rounded-lg focus:outline-none focus:border-[#2563EB] ${
                        missingGapKeySet.has('bankIfsc') ? 'border-amber-300 bg-amber-50/30' : 'border-[#E2E8F0]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#64748B] mb-1">
                      Verification City / Place
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Mumbai / Bengaluru"
                      value={profileForm.verificationPlace || ''}
                      onChange={(e) =>
                        setProfileForm({ ...profileForm, verificationPlace: e.target.value })
                      }
                      className="w-full px-3 py-1.5 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <Button type="submit" variant="primary" size="sm" loading={savingProfile}>
                    Save Details
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={savingProfile}
                    onClick={async () => {
                      setSavingProfile(true);
                      try {
                        await onUpdateProfile(profileForm);
                      } finally {
                        setSavingProfile(false);
                      }
                      onStepChange('resolve-differences');
                    }}
                    rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                  >
                    Save &amp; Instruct AI
                  </Button>
                </div>
              </form>
            </SurfaceCard>
          )}

          {/* Step 4: Natural Language Instruction + Confirm Differences & Approvals */}
          {activeStep === 'resolve-differences' && (
            <SurfaceCard className="space-y-4">
              {/* Embedded Natural Language Instruction Box */}
              {onSendAssistantMessage && (
                <div className="space-y-3 pb-4 border-b border-[#E2E8F0]">
                  <div className="flex items-start gap-2">
                    <MessageSquare className="w-4 h-4 text-[#2563EB] shrink-0 mt-0.5" />
                    <div>
                      <h2 className="text-sm font-semibold text-[#172B4D]">
                        Step 4 · Tell TaxShield AI What to Perform
                      </h2>
                      <p className="text-xs text-[#64748B] mt-0.5 leading-relaxed">
                        Write in natural language what you want the assistant to do next — reconcile documents, add deductions, compare regimes, or prepare your ITR-1 draft.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {[
                      'Prepare my income tax return',
                      'Check what details are missing',
                      'Compare Old vs New tax regime',
                      'Yes, include verified interest & 80C deductions',
                    ].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        disabled={sendingInstruction}
                        onClick={() => handleRunInstruction(preset)}
                        className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-[#F8FAFC] hover:bg-blue-50 text-[#172B4D] hover:text-[#2563EB] border border-[#E2E8F0] transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleRunInstruction();
                    }}
                    className="flex flex-col sm:flex-row gap-2"
                  >
                    <input
                      type="text"
                      value={instructionInput}
                      onChange={(e) => setInstructionInput(e.target.value)}
                      placeholder="e.g. Include my 80D health insurance of 25000 and compare regimes…"
                      className="flex-1 px-3 py-2 text-xs bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB]"
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      loading={sendingInstruction}
                      disabled={!instructionInput.trim() || sendingInstruction}
                      icon={<Send className="w-3.5 h-3.5" />}
                    >
                      Run
                    </Button>
                  </form>

                  {instructionError && (
                    <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-800">
                      {instructionError}
                    </div>
                  )}

                  {latestAssistantReply && (
                    <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-[#64748B]">
                        <span className="font-semibold text-[#172B4D] flex items-center gap-1.5">
                          <FileCheck2 className="w-3.5 h-3.5 text-[#0D9488]" />
                          Latest Assistant Result
                        </span>
                        <span>{formatShortTime(latestAssistantReply.timestamp)}</span>
                      </div>
                      <MarkdownMessage content={latestAssistantReply.content} />
                    </div>
                  )}
                </div>
              )}

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                  Pending Approvals &amp; Extracted Item Confirmations
                </h3>
              </div>

              {pendingApprovals.length === 0 && pendingFields.length === 0 ? (
                <div className="p-4 rounded-lg bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">All items are confirmed!</div>
                    <div className="text-emerald-800 mt-0.5">
                      Zero unresolved discrepancies or pending approvals remain across your uploaded documents.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingApprovals.map((appr) => (
                    <div
                      key={appr.id}
                      className="p-4 rounded-lg border border-amber-200 bg-amber-50/40 space-y-2.5 text-xs"
                    >
                      <div className="font-semibold text-[#172B4D]">{appr.summary}</div>
                      <p className="text-[#64748B] leading-relaxed">{appr.justification}</p>
                      {appr.diffs.length > 0 && (
                        <div className="bg-white border border-[#E2E8F0] rounded p-2.5 space-y-1">
                          {appr.diffs.map((d) => (
                            <div
                              key={d.field}
                              className="flex items-center justify-between gap-2 text-[11px]"
                            >
                              <span className="text-[#172B4D] font-medium">{d.label}</span>
                              <span className="font-mono text-[#2563EB] font-semibold">
                                {d.previousValue} → {d.proposedValue}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          loading={busyId === appr.id}
                          onClick={async () => {
                            setBusyId(appr.id);
                            try {
                              await onResolveApproval(appr.id, 'approve');
                            } finally {
                              setBusyId(null);
                            }
                          }}
                          icon={<Check className="w-3.5 h-3.5" />}
                        >
                          Approve &amp; Apply
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === appr.id}
                          onClick={async () => {
                            setBusyId(appr.id);
                            try {
                              await onResolveApproval(appr.id, 'reject');
                            } finally {
                              setBusyId(null);
                            }
                          }}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  ))}

                  {pendingFields.map((f) => {
                    const matchRecon = reconciliation.items.find(
                      (r) => r.recommendedAction?.fieldToUpdate === f.fieldKey
                    );
                    return (
                      <div
                        key={f.fieldKey}
                        className="p-4 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] space-y-2.5 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-[#172B4D]">{f.label}</div>
                            <div className="text-[11px] text-[#64748B] mt-0.5">
                              Found in {f.sourceDocument || 'uploaded document'}
                              {f.pageNumber ? ` (Page ${f.pageNumber})` : ''}
                            </div>
                          </div>
                          <span className="text-sm font-mono font-bold text-[#172B4D] tabular-nums">
                            {typeof f.stagedValue === 'number'
                              ? formatINR(f.stagedValue)
                              : String(f.stagedValue ?? '—')}
                          </span>
                        </div>
                        {matchRecon && (
                          <p className="text-[11px] text-[#64748B] leading-relaxed">
                            {matchRecon.explanation}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="teal"
                            size="sm"
                            loading={busyId === f.fieldKey}
                            onClick={async () => {
                              setBusyId(f.fieldKey);
                              try {
                                await onFieldAction({
                                  fieldKey: f.fieldKey,
                                  action: 'confirm',
                                  numericValue:
                                    typeof f.stagedValue === 'number'
                                      ? f.stagedValue
                                      : undefined,
                                });
                              } finally {
                                setBusyId(null);
                              }
                            }}
                            icon={<Check className="w-3.5 h-3.5" />}
                          >
                            Confirm &amp; Include
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busyId === f.fieldKey}
                            onClick={async () => {
                              setBusyId(f.fieldKey);
                              try {
                                await onFieldAction({
                                  fieldKey: f.fieldKey,
                                  action: 'reject',
                                });
                              } finally {
                                setBusyId(null);
                              }
                            }}
                          >
                            Exclude
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onStepChange('tax-calculation')}
                  rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                >
                  Next: View Tax Calculation
                </Button>
              </div>
            </SurfaceCard>
          )}

          {/* Step 5: Tax Calculation & Regime Choice */}
          {activeStep === 'tax-calculation' && (
            <SurfaceCard className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scale className="w-4 h-4 text-[#2563EB]" />
                  <h2 className="text-sm font-semibold text-[#172B4D]">
                    Step 5 · Choose Your Tax Regime
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onOpenTaxSummary}
                  className="text-xs font-medium text-[#2563EB] hover:underline cursor-pointer"
                >
                  Full Comparison
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                {(['new', 'old'] as TaxRegime[]).map((reg) => {
                  const data =
                    reg === 'new'
                      ? activeDraft.taxSummary.newRegime
                      : activeDraft.taxSummary.oldRegime;
                  const isSelected = activeDraft.selectedRegime === reg;
                  const isRec = activeDraft.taxSummary.recommendedRegime === reg;
                  return (
                    <button
                      key={reg}
                      type="button"
                      onClick={() =>
                        onFieldAction({
                          fieldKey: 'preferredRegime',
                          action: 'edit',
                          stringValue: reg,
                        })
                      }
                      className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                        isSelected
                          ? 'border-[#2563EB] bg-blue-50/60'
                          : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-[#172B4D]">
                          {reg === 'new' ? 'New Regime' : 'Old Regime'}
                        </span>
                        {isRec && (
                          <span className="text-[10px] font-semibold text-[#0D9488]">
                            Lowest Tax
                          </span>
                        )}
                      </div>
                      <div className="text-base font-bold font-mono tabular-nums text-[#172B4D] mt-1.5">
                        {formatINR(data.totalTaxLiability)}
                      </div>
                      <div className="text-[11px] text-[#64748B] mt-0.5">
                        {data.refundDue > 0
                          ? `Refund ${formatINR(data.refundDue)}`
                          : `Payable ${formatINR(data.netTaxPayable)}`}
                      </div>
                    </button>
                  );
                })}
              </div>

              <p className="text-xs text-[#64748B] leading-relaxed">
                Recommended:{' '}
                <strong className="text-[#172B4D]">
                  {activeDraft.taxSummary.recommendedRegime === 'new'
                    ? 'New Tax Regime (u/s 115BAC)'
                    : 'Old Tax Regime'}
                </strong>
                {activeDraft.taxSummary.netSavingsInRecommended > 0
                  ? ` — saves you ${formatINR(activeDraft.taxSummary.netSavingsInRecommended)} in tax.`
                  : '.'}
              </p>

              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onStepChange('review-download')}
                  rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                >
                  Next: Review &amp; Download
                </Button>
              </div>
            </SurfaceCard>
          )}

          {/* Step 6: Review & Download */}
          {activeStep === 'review-download' && (
            <SurfaceCard className="space-y-4">
              <h2 className="text-sm font-semibold text-[#172B4D]">
                Step 6 · Final Review &amp; Download
              </h2>
              <div className="p-3.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Selected Regime</span>
                  <span className="font-semibold text-[#172B4D]">
                    {activeDraft.selectedRegime.toUpperCase()} Regime
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Taxable Income</span>
                  <span className="font-mono font-semibold text-[#172B4D] tabular-nums">
                    {formatINR(calc.taxableIncome)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Total Tax Liability</span>
                  <span className="font-mono font-semibold text-[#172B4D] tabular-nums">
                    {formatINR(calc.totalTaxLiability)}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-[#E2E8F0]">
                  <span className="font-semibold text-[#172B4D]">
                    {calc.refundDue > 0 ? 'Refund Due' : 'Balance Payable'}
                  </span>
                  <span className="font-mono font-bold text-[#0D9488] tabular-nums">
                    {formatINR(calc.refundDue > 0 ? calc.refundDue : calc.netTaxPayable)}
                  </span>
                </div>
              </div>

              <label className="flex items-start gap-2.5 text-xs text-[#172B4D] cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(profile.verificationConfirmed)}
                  onChange={(e) =>
                    onFieldAction({
                      fieldKey: 'verificationConfirmed',
                      action: 'edit',
                      stringValue: e.target.checked ? 'true' : 'false',
                    })
                  }
                  className="mt-0.5 rounded border-[#E2E8F0] text-[#2563EB]"
                />
                <span>
                  I confirm that the income, deductions, and bank details in this ITR-1 draft are accurate to the best of my knowledge.
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-2.5">
                {activeDraft.status !== 'validated_ready' && (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={finalizing}
                    onClick={async () => {
                      setFinalizing(true);
                      try {
                        await onStageFinalizeReturn(activeDraft.selectedRegime);
                      } finally {
                        setFinalizing(false);
                      }
                    }}
                  >
                    Finalize ITR-1 Draft
                  </Button>
                )}
                <Button
                  variant={activeDraft.status === 'validated_ready' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={handleDownloadJson}
                  icon={<Download className="w-3.5 h-3.5" />}
                >
                  Download ITR-1 JSON
                </Button>
                <Button variant="ghost" size="sm" onClick={onOpenReturnPreview}>
                  Open Full Return View
                </Button>
              </div>

              <div className="text-[11px] text-[#64748B] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2">
                This is a locally prepared ITR-1 draft for your review and offline filing preparation. It is not submitted to the Income Tax Department portal.
              </div>
            </SurfaceCard>
          )}

          {/* Live AI Progress & Field Mapping Stream (Always Visible on Left Panel) */}
          <SurfaceCard noPadding>
            <div className="px-4 py-3 border-b border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {isActivelyStreaming ? (
                  <Loader2 className="w-3.5 h-3.5 text-[#2563EB] animate-spin" />
                ) : (
                  <Clock className="w-3.5 h-3.5 text-[#64748B]" />
                )}
                <span className="text-xs font-semibold text-[#172B4D]">
                  Live Filing Progress
                </span>
              </div>
              <span className="text-[11px] font-mono text-[#64748B] tabular-nums">
                {liveEvents.length} events
              </span>
            </div>

            {latestLiveEvents.length === 0 ? (
              <div className="p-5 text-xs text-[#64748B] text-center">
                Upload a document above to watch live extraction and field-by-field ITR-1 updates appear here in real time.
              </div>
            ) : (
              <div className="divide-y divide-[#E2E8F0] max-h-[380px] overflow-y-auto bg-white">
                {latestLiveEvents.map((ev) => (
                  <div
                    key={ev.eventId}
                    className={`px-4 py-2.5 flex items-start justify-between gap-3 text-xs ${
                      ev.status === 'active' ? 'bg-blue-50/50' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      {ev.status === 'active' ? (
                        <Loader2 className="w-3.5 h-3.5 text-[#2563EB] animate-spin shrink-0 mt-0.5" />
                      ) : ev.status === 'warning' || ev.status === 'pending' ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#0D9488] shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-[#172B4D] truncate">
                          {ev.title}
                        </div>
                        <div className="text-[11px] text-[#64748B] leading-snug mt-0.5">
                          {ev.message}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-[#64748B] tabular-nums shrink-0 mt-0.5">
                      {formatShortTime(ev.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SurfaceCard>
        </div>

        {/* Right Column (7 cols): Live ITR-1 Return Form (Sections A–K) */}
        <div className="lg:col-span-7">
          <Itr1FormLiveView
            snapshot={snapshot}
            activeFieldKey={activeFieldKey}
            recentlyUpdatedFieldKeys={recentlyUpdatedFieldKeys}
            focusedSectionCode={currentStepMeta.sectionCode}
            onFieldAction={onFieldAction}
          />
        </div>
      </div>
    </div>
  );
};
