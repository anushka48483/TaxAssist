import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Edit3,
  FileSpreadsheet,
  FileText,
  FolderPlus,
  MessageSquareCode,
  RotateCcw,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import {
  DOCUMENT_CATEGORY_LABELS,
  UserProfile,
  WorkspaceSnapshot,
} from '../shared/types';
import { buildSessionActivityEvents } from '../utils/activityEvents';
import {
  formatDateTime,
  formatINR,
  formatShortTime,
  maskPan,
} from '../utils/format';
import {
  Button,
  EmptyState,
  MetricCard,
  StatusIndicator,
  SurfaceCard,
} from './DesignSystem';

export type NavSection =
  | 'overview'
  | 'assistant'
  | 'activity-monitor'
  | 'mcp-tools'
  | 'documents'
  | 'financial-summary'
  | 'tax-computation'
  | 'approvals'
  | 'itr1-form'
  | 'return-preview'
  | 'audit-trail'
  | 'architecture';

interface DashboardViewProps {
  snapshot: WorkspaceSnapshot;
  onNavigate: (section: NavSection) => void;
  onUpdateProfile: (profile: Partial<UserProfile>) => Promise<void>;
  onCreateSession: (title: string, preloadSyntheticDemo: boolean) => Promise<void>;
  onSwitchSession: (sessionId: string) => Promise<void>;
  onUploadSyntheticDemoPack: () => Promise<void>;
  onResetDemo?: () => void;
  avatarUrl: string;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  snapshot,
  onNavigate,
  onUpdateProfile,
  onCreateSession,
  onSwitchSession,
  onUploadSyntheticDemoPack,
  onResetDemo,
  avatarUrl,
}) => {
  const {
    profile,
    sessions,
    activeSessionId,
    activeSession,
    documents,
    drafts,
    activeDraft,
    reconciliation,
    approvals,
  } = snapshot;

  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<UserProfile>(profile);
  const [savingProfile, setSavingProfile] = useState(false);

  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [preloadDemo, setPreloadDemo] = useState(true);
  const [creatingSession, setCreatingSession] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const pendingApprovals = approvals.filter((a) => a.status === 'pending');
  const executedApprovals = approvals.filter((a) => a.status === 'executed');

  const activeRegimeCalc =
    activeDraft.selectedRegime === 'new'
      ? activeDraft.taxSummary.newRegime
      : activeDraft.taxSummary.oldRegime;

  // Real backend-derived 6-stage filing tracker (zero fake percentages)
  const profileComplete = Boolean(profile.fullName && profile.pan && profile.bankIfsc);
  const docsExtracted =
    documents.length > 0 &&
    documents.every((d) => d.processingStatus === 'extracted');
  const reconciliationComplete =
    documents.length > 0 && reconciliation.conflictCount === 0;
  const approvalsComplete =
    pendingApprovals.length === 0 &&
    (executedApprovals.length > 0 || activeDraft.version > 1);
  const taxComputed = activeDraft.inputs.grossSalary > 0;
  const validationReady =
    taxComputed &&
    reconciliationComplete &&
    pendingApprovals.length === 0 &&
    activeDraft.validation.errorCount === 0 &&
    activeSession.unsupportedScenarios.length === 0;

  const stages: Array<{
    step: string;
    title: string;
    detail: string;
    state: 'completed' | 'action_needed' | 'pending';
    target: NavSection;
  }> = [
    {
      step: '01',
      title: 'Profile',
      detail: profileComplete
        ? `PAN ${maskPan(profile.pan)}`
        : 'Add PAN & refund bank',
      state: profileComplete ? 'completed' : 'action_needed',
      target: 'overview',
    },
    {
      step: '02',
      title: 'Documents',
      detail:
        documents.length > 0
          ? `${documents.length} file(s) extracted`
          : 'No documents uploaded',
      state: docsExtracted
        ? 'completed'
        : documents.length > 0
          ? 'action_needed'
          : 'pending',
      target: 'documents',
    },
    {
      step: '03',
      title: 'Reconciliation',
      detail:
        documents.length === 0
          ? 'Awaiting documents'
          : reconciliation.conflictCount === 0
            ? `${reconciliation.matchedCount} checks aligned`
            : `${reconciliation.conflictCount} variance(s) open`,
      state: reconciliationComplete
        ? 'completed'
        : reconciliation.conflictCount > 0
          ? 'action_needed'
          : 'pending',
      target: 'financial-summary',
    },
    {
      step: '04',
      title: 'Approval',
      detail:
        pendingApprovals.length > 0
          ? `${pendingApprovals.length} awaiting authorization`
          : executedApprovals.length > 0
            ? `${executedApprovals.length} approved`
            : 'No writes staged yet',
      state:
        pendingApprovals.length > 0
          ? 'action_needed'
          : approvalsComplete
            ? 'completed'
            : 'pending',
      target: 'approvals',
    },
    {
      step: '05',
      title: 'Tax Computation',
      detail: taxComputed
        ? `${activeDraft.taxSummary.recommendedRegime.toUpperCase()} optimal`
        : 'Awaiting salary & income',
      state: taxComputed ? 'completed' : 'pending',
      target: 'tax-computation',
    },
    {
      step: '06',
      title: 'Return Validation',
      detail: validationReady
        ? `Draft v${activeDraft.version} ready`
        : `${activeDraft.validation.passCount} pass · ${activeDraft.validation.errorCount} err`,
      state: validationReady
        ? 'completed'
        : activeDraft.validation.errorCount > 0
          ? 'action_needed'
          : 'pending',
      target: 'itr1-form',
    },
  ];

  const completedStagesCount = stages.filter((s) => s.state === 'completed').length;

  // Dynamic Next Action Panel computed strictly from backend state
  const nextAction = useMemo(() => {
    if (activeSession.unsupportedScenarios.length > 0) {
      return {
        badge: 'Scope Alert',
        tone: 'error' as const,
        title: 'Unsupported ITR-1 (Sahaj) Scenario Detected',
        description: `${activeSession.unsupportedScenarios[0].title}: ${activeSession.unsupportedScenarios[0].reason}`,
        ctaLabel: 'Review in AI Filing Assistant',
        target: 'assistant' as NavSection,
      };
    }
    if (documents.length === 0) {
      return {
        badge: 'Next Step · Document Intake',
        tone: 'info' as const,
        title: 'Upload Your Income Tax Documents to Begin',
        description:
          'Upload Form 16, bank statements, FD certificates, or investment proofs in the Document Vault — or load the 4-document synthetic demo pack.',
        ctaLabel: 'Open Document Vault',
        target: 'documents' as NavSection,
      };
    }
    if (pendingApprovals.length > 0) {
      return {
        badge: 'Human Approval Required',
        tone: 'warning' as const,
        title: `Authorize ${pendingApprovals.length} Staged Operation${pendingApprovals.length > 1 ? 's' : ''} in SecurityGateway`,
        description:
          'Sensitive financial updates are paused at SecurityGateway with exact before/after diffs. Approve to update your return and resume autonomous preparation.',
        ctaLabel: 'Review Pending Approvals',
        target: 'approvals' as NavSection,
      };
    }
    if (
      activeSession.agentState === 'WAITING_FOR_USER_CLARIFICATION' ||
      reconciliation.conflictCount > 0 ||
      activeDraft.version === 1
    ) {
      return {
        badge: 'Agent Guidance Ready',
        tone: 'info' as const,
        title:
          reconciliation.conflictCount > 0
            ? `Resolve ${reconciliation.conflictCount} Cross-Document Variance${reconciliation.conflictCount > 1 ? 's' : ''} with AI Assistant`
            : 'Instruct AI Filing Assistant to Prepare Your Return',
        description:
          'Ask the AI Filing Assistant to analyze your uploaded documents, reconcile bank/FD interest and Section 80C proofs, and compute Old vs. New regime taxes.',
        ctaLabel: 'Open AI Filing Assistant',
        target: 'assistant' as NavSection,
      };
    }
    return {
      badge: 'Validated & Ready',
      tone: 'success' as const,
      title: `ITR-1 (Sahaj) Draft v${activeDraft.version} Validated forOffline Review`,
      description: `All cross-document checks and mandatory validations are complete under the ${activeDraft.selectedRegime.toUpperCase()} regime. Inspect Sections A–G or export your local JSON draft.`,
      ctaLabel: 'Inspect & Export Generated Return',
      target: 'return-preview' as NavSection,
    };
  }, [
    activeSession.unsupportedScenarios,
    activeSession.agentState,
    documents.length,
    pendingApprovals.length,
    reconciliation.conflictCount,
    activeDraft.version,
    activeDraft.selectedRegime,
  ]);

  const recentEvents = useMemo(
    () => [...buildSessionActivityEvents(snapshot)].reverse().slice(0, 6),
    [snapshot]
  );

  const totalDeductionsDisplayed =
    activeRegimeCalc.standardDeduction +
    activeRegimeCalc.professionalTaxDeduction +
    activeRegimeCalc.totalChapterVIADeductions;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await onUpdateProfile(profileForm);
      setEditingProfile(false);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleCreateSessionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingSession(true);
    try {
      await onCreateSession(newSessionTitle, preloadDemo);
      setNewSessionTitle('');
      setShowNewSessionModal(false);
    } finally {
      setCreatingSession(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Welcome & Filing Session Header */}
      <SurfaceCard>
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="flex items-center gap-4">
            {!avatarFailed ? (
              <img
                src={avatarUrl}
                alt={`${profile.fullName} profile portrait`}
                referrerPolicy="no-referrer"
                onError={() => setAvatarFailed(true)}
                className="w-14 h-14 rounded-xl object-cover border border-[#E2E8F0] shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-blue-50 text-[#2563EB] border border-blue-200 flex items-center justify-center font-bold text-base shrink-0">
                {profile.fullName
                  .split(' ')
                  .map((p) => p[0])
                  .join('')
                  .slice(0, 2)}
              </div>
            )}

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-[#172B4D] tracking-tight">
                  Welcome, {profile.fullName}
                </h1>
                {activeSession.isDemoSession ? (
                  <StatusIndicator tone="teal" label="Demo Sandbox" />
                ) : (
                  <StatusIndicator tone="neutral" label="SQLite Session" />
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-[#64748B] mt-1 font-mono tabular-nums">
                <span>Assessment Year {activeSession.assessmentYear}</span>
                <span aria-hidden="true">·</span>
                <span>PAN {maskPan(profile.pan)}</span>
                <span aria-hidden="true">·</span>
                <span>Session Status: {activeSession.status.replace(/_/g, ' ')}</span>
                <span aria-hidden="true">·</span>
                <span className="text-[#2563EB] font-medium">
                  Agent: {activeSession.agentState}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <select
              aria-label="Select filing session"
              value={activeSessionId}
              onChange={(e) => onSwitchSession(e.target.value)}
              className="px-3 py-2 text-xs font-medium text-[#172B4D] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB] cursor-pointer"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · Draft v{s.activeDraftVersion}
                </option>
              ))}
            </select>

            {activeSession.isDemoSession && onResetDemo && (
              <Button
                variant="teal"
                size="md"
                icon={<RotateCcw className="w-3.5 h-3.5" />}
                onClick={onResetDemo}
              >
                Reset Demo
              </Button>
            )}

            <Button
              variant="outline"
              size="md"
              icon={<Edit3 className="w-3.5 h-3.5" />}
              onClick={() => {
                setProfileForm(profile);
                setEditingProfile(true);
              }}
            >
              Edit Profile
            </Button>

            <Button
              variant="primary"
              size="md"
              icon={<FolderPlus className="w-3.5 h-3.5" />}
              onClick={() => setShowNewSessionModal(true)}
            >
              New Session
            </Button>
          </div>
        </div>

        {/* 2. Real 6-Stage Progress Tracker */}
        <div className="mt-6 pt-6 border-t border-[#E2E8F0]">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-xs">
            <span className="font-semibold text-[#172B4D]">
              Filing Lifecycle Progress ({completedStagesCount} of 6 Stages Completed)
            </span>
            <span className="font-mono tabular-nums text-[#64748B]">
              Active Draft v{activeDraft.version} · {activeDraft.status.replace(/_/g, ' ')}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            {stages.map((st) => {
              const borderStyle =
                st.state === 'completed'
                  ? 'border-emerald-200 bg-emerald-50/40 hover:border-emerald-300'
                  : st.state === 'action_needed'
                    ? 'border-blue-300 bg-blue-50/50 hover:border-[#2563EB]'
                    : 'border-[#E2E8F0] bg-[#F8FAFC] hover:border-slate-300';

              return (
                <button
                  key={st.step}
                  type="button"
                  onClick={() => onNavigate(st.target)}
                  className={`text-left p-3.5 rounded-xl border transition-colors cursor-pointer ${borderStyle}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-semibold text-[#64748B]">
                      Stage {st.step}
                    </span>
                    {st.state === 'completed' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : st.state === 'action_needed' ? (
                      <AlertTriangle className="w-4 h-4 text-[#2563EB] shrink-0" />
                    ) : (
                      <Clock className="w-4 h-4 text-[#64748B] shrink-0" />
                    )}
                  </div>
                  <div className="text-xs font-semibold text-[#172B4D] mt-1.5">
                    {st.title}
                  </div>
                  <div className="text-[11px] text-[#64748B] font-mono tabular-nums mt-0.5 truncate">
                    {st.detail}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </SurfaceCard>

      {/* 3. Next Action Panel */}
      <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1.5 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <StatusIndicator tone={nextAction.tone} label={nextAction.badge} />
            <span className="text-xs font-mono text-[#64748B]">
              Agent State: {activeSession.agentState}
            </span>
          </div>
          <h2 className="text-base font-bold text-[#172B4D]">{nextAction.title}</h2>
          <p className="text-xs text-[#64748B] leading-relaxed">
            {nextAction.description}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <Button
            variant="primary"
            size="lg"
            onClick={() => onNavigate(nextAction.target)}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            {nextAction.ctaLabel}
          </Button>
          {nextAction.target !== 'assistant' && (
            <Button
              variant="outline"
              size="lg"
              icon={<MessageSquareCode className="w-4 h-4 text-[#2563EB]" />}
              onClick={() => onNavigate('assistant')}
            >
              AI Assistant
            </Button>
          )}
        </div>
      </div>

      {/* 4. Seven Financial Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3.5">
        <MetricCard
          label="Gross Salary"
          value={formatINR(activeDraft.inputs.grossSalary)}
          subtext={`Std Ded ${formatINR(activeRegimeCalc.standardDeduction)}`}
          onClick={() => onNavigate('financial-summary')}
        />
        <MetricCard
          label="Other Income"
          value={formatINR(activeRegimeCalc.incomeFromOtherSources)}
          subtext={`Sav ${formatINR(activeDraft.inputs.savingsInterest)} · FD ${formatINR(activeDraft.inputs.fdInterest)}`}
          onClick={() => onNavigate('financial-summary')}
        />
        <MetricCard
          label="Total Deductions"
          value={formatINR(totalDeductionsDisplayed)}
          subtext={`VI-A ${formatINR(activeRegimeCalc.totalChapterVIADeductions)}`}
          onClick={() => onNavigate('financial-summary')}
        />
        <MetricCard
          label="Taxable Income"
          value={formatINR(activeRegimeCalc.taxableIncome)}
          subtext={`${activeDraft.selectedRegime.toUpperCase()} Regime`}
          tone="blue"
          onClick={() => onNavigate('tax-computation')}
        />
        <MetricCard
          label="Estimated Tax"
          value={formatINR(activeRegimeCalc.totalTaxLiability)}
          subtext={`Optimal: ${activeDraft.taxSummary.recommendedRegime.toUpperCase()}`}
          onClick={() => onNavigate('tax-computation')}
        />
        <MetricCard
          label="TDS Credited"
          value={formatINR(
            activeRegimeCalc.tdsCredited + activeRegimeCalc.advanceTaxPaid
          )}
          subtext="Form 16 / 26AS"
          onClick={() => onNavigate('documents')}
        />
        <MetricCard
          label={activeRegimeCalc.refundDue > 0 ? 'Refund Due' : 'Tax Payable'}
          value={
            activeRegimeCalc.refundDue > 0
              ? formatINR(activeRegimeCalc.refundDue)
              : formatINR(activeRegimeCalc.netTaxPayable)
          }
          subtext={
            activeRegimeCalc.refundDue > 0
              ? 'Net refund u/s 288B'
              : activeRegimeCalc.netTaxPayable > 0
                ? 'Balance payable u/s 288B'
                : 'Zero balance'
          }
          tone={
            activeRegimeCalc.refundDue > 0
              ? 'positive'
              : activeRegimeCalc.netTaxPayable > 0
                ? 'negative'
                : 'default'
          }
          onClick={() => onNavigate('itr1-form')}
        />
      </div>

      {/* 5. Recent Activity & Document Vault / Draft Snapshot Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Columns: Recent Agent & Session Activity + Document Summary */}
        <div className="lg:col-span-7 space-y-6">
          <SurfaceCard noPadding className="overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#2563EB]" />
                <h2 className="text-sm font-semibold text-[#172B4D]">
                  Recent Session Activity
                </h2>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onNavigate('activity-monitor')}
                rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                Full Timeline
              </Button>
            </div>

            {recentEvents.length === 0 ? (
              <EmptyState
                icon={<Activity className="w-5 h-5" />}
                title="No activity recorded yet"
                description="Upload documents or instruct the AI Filing Assistant to start autonomous preparation."
                action={
                  <Button variant="primary" onClick={() => onNavigate('assistant')}>
                    Open AI Filing Assistant
                  </Button>
                }
              />
            ) : (
              <div className="divide-y divide-[#E2E8F0]">
                {recentEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="px-6 py-3.5 hover:bg-[#F8FAFC] transition-colors flex items-start justify-between gap-4 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[#172B4D]">
                          {ev.operationName}
                        </span>
                        {ev.toolName && (
                          <span className="font-mono text-[11px] text-[#2563EB]">
                            {ev.toolName}
                          </span>
                        )}
                      </div>
                      <p className="text-[#64748B] mt-0.5 line-clamp-2 leading-relaxed">
                        {ev.description}
                      </p>
                    </div>
                    <span className="font-mono tabular-nums text-[11px] text-[#64748B] shrink-0">
                      {formatShortTime(ev.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SurfaceCard>

          <SurfaceCard noPadding className="overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[#172B4D]">
                  Uploaded Documents ({documents.length})
                </h2>
                <p className="text-xs text-[#64748B] mt-0.5">
                  Page-cited financial extraction with OCR confidence &amp; ACL controls
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigate('documents')}
              >
                Open Vault
              </Button>
            </div>

            {documents.length === 0 ? (
              <EmptyState
                icon={<FileText className="w-5 h-5" />}
                title="No documents uploaded in this session"
                description="Load the 4-document Synthetic Demo Pack or upload your Form 16, bank statements, and investment proofs."
                action={
                  <Button
                    variant="primary"
                    onClick={async () => {
                      await onUploadSyntheticDemoPack();
                      onNavigate('assistant');
                    }}
                  >
                    Load 4-Doc Demo &amp; Open Assistant
                  </Button>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B]">
                      <th className="py-2.5 px-6 font-medium">Document</th>
                      <th className="py-2.5 px-4 font-medium">Category</th>
                      <th className="py-2.5 px-4 font-medium">Status</th>
                      <th className="py-2.5 px-6 font-medium text-right">Facts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {documents.map((doc) => (
                      <tr
                        key={doc.id}
                        onClick={() => onNavigate('documents')}
                        className="hover:bg-[#F8FAFC] cursor-pointer"
                      >
                        <td className="py-3 px-6 font-medium text-[#172B4D] max-w-[220px] truncate">
                          {doc.fileName}
                        </td>
                        <td className="py-3 px-4 text-[#64748B] whitespace-nowrap">
                          {DOCUMENT_CATEGORY_LABELS[doc.category]}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
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
                                ? 'Failed'
                                : doc.needsUserReview
                                  ? 'Needs Review'
                                  : 'Extracted'
                            }
                          />
                        </td>
                        <td className="py-3 px-6 text-right font-mono tabular-nums text-[#172B4D]">
                          {doc.extractedFacts.length}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceCard>
        </div>

        {/* Right 5 Columns: Draft Version History & Governance Quick Links */}
        <div className="lg:col-span-5 space-y-6">
          <SurfaceCard noPadding className="overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-[#2563EB]" />
                <h2 className="text-sm font-semibold text-[#172B4D]">
                  ITR-1 Draft Version History
                </h2>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate('itr1-form')}
                >
                  Form Preview
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onNavigate('return-preview')}
                >
                  Export JSON
                </Button>
              </div>
            </div>

            <div className="divide-y divide-[#E2E8F0]">
              {[...drafts].reverse().map((d) => {
                const reg =
                  d.selectedRegime === 'new'
                    ? d.taxSummary.newRegime
                    : d.taxSummary.oldRegime;
                return (
                  <div key={d.id} className="px-6 py-4 text-xs">
                    <div className="flex items-center justify-between font-mono tabular-nums">
                      <span className="font-semibold text-[#172B4D]">
                        Draft v{d.version} · {d.selectedRegime.toUpperCase()} Regime
                      </span>
                      <span className="text-[#2563EB] font-semibold">
                        {reg.refundDue > 0
                          ? `Refund ${formatINR(reg.refundDue)}`
                          : `Tax ${formatINR(reg.totalTaxLiability)}`}
                      </span>
                    </div>
                    <p className="text-[#64748B] mt-1 leading-relaxed">{d.changeNote}</p>
                    <div className="text-[11px] text-[#64748B] font-mono tabular-nums mt-1.5">
                      {formatDateTime(d.createdAt)} · {d.approvedBy}
                    </div>
                  </div>
                );
              })}
            </div>
          </SurfaceCard>

          <SurfaceCard className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[#172B4D]">
                  MCP Governance &amp; Security Controls
                </h2>
                <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
                  Inspect all 22 registered MCP tools, verify the tamper-evident SHA-256 audit hash chain, or explore the 11-layer system architecture.
                </p>
              </div>
              <ShieldCheck className="w-5 h-5 text-[#0D9488] shrink-0" />
            </div>
            <div className="pt-2 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onNavigate('mcp-tools')}
              >
                22 MCP Tools
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onNavigate('audit-trail')}
              >
                Audit Trail ({snapshot.auditLogs.length})
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onNavigate('architecture')}
              >
                System Architecture
              </Button>
            </div>
          </SurfaceCard>
        </div>
      </div>

      {/* Edit Profile Modal */}
      {editingProfile && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#172B4D]/25 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-[#E2E8F0] rounded-xl max-w-xl w-full p-6 shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-[#2563EB]" />
                <h3 className="text-base font-semibold text-[#172B4D]">
                  Edit Taxpayer Profile
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingProfile(false)}
                className="p-1 text-[#64748B] hover:text-[#172B4D] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveProfile} className="mt-4 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-[#172B4D] mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={profileForm.fullName}
                    onChange={(e) =>
                      setProfileForm({ ...profileForm, fullName: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg text-[#172B4D]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#172B4D] mb-1">PAN</label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    value={profileForm.pan}
                    onChange={(e) =>
                      setProfileForm({
                        ...profileForm,
                        pan: e.target.value.toUpperCase(),
                      })
                    }
                    className="w-full px-3 py-2 font-mono bg-white border border-[#E2E8F0] rounded-lg text-[#172B4D]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#172B4D] mb-1">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    required
                    value={profileForm.dateOfBirth}
                    onChange={(e) =>
                      setProfileForm({
                        ...profileForm,
                        dateOfBirth: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 font-mono bg-white border border-[#E2E8F0] rounded-lg text-[#172B4D]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#172B4D] mb-1">
                    Employer Name
                  </label>
                  <input
                    type="text"
                    required
                    value={profileForm.employerName}
                    onChange={(e) =>
                      setProfileForm({
                        ...profileForm,
                        employerName: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg text-[#172B4D]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#172B4D] mb-1">
                    Employer TAN
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    value={profileForm.employerTan}
                    onChange={(e) =>
                      setProfileForm({
                        ...profileForm,
                        employerTan: e.target.value.toUpperCase(),
                      })
                    }
                    className="w-full px-3 py-2 font-mono bg-white border border-[#E2E8F0] rounded-lg text-[#172B4D]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#172B4D] mb-1">
                    Refund Bank IFSC
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={11}
                    value={profileForm.bankIfsc}
                    onChange={(e) =>
                      setProfileForm({
                        ...profileForm,
                        bankIfsc: e.target.value.toUpperCase(),
                      })
                    }
                    className="w-full px-3 py-2 font-mono bg-white border border-[#E2E8F0] rounded-lg text-[#172B4D]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-[#172B4D] mb-1">
                    Bank Account Number
                  </label>
                  <input
                    type="text"
                    required
                    value={profileForm.bankAccountNumber}
                    onChange={(e) =>
                      setProfileForm({
                        ...profileForm,
                        bankAccountNumber: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 font-mono bg-white border border-[#E2E8F0] rounded-lg text-[#172B4D]"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2.5 pt-4 border-t border-[#E2E8F0]">
                <Button
                  variant="secondary"
                  onClick={() => setEditingProfile(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={savingProfile}>
                  Save Profile
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Filing Session Modal */}
      {showNewSessionModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#172B4D]/25 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-[#E2E8F0] rounded-xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-[#E2E8F0]">
              <h3 className="text-base font-semibold text-[#172B4D]">
                Create New Filing Session
              </h3>
              <button
                type="button"
                onClick={() => setShowNewSessionModal(false)}
                className="p-1 text-[#64748B] hover:text-[#172B4D] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={handleCreateSessionSubmit}
              className="mt-4 space-y-4 text-xs"
            >
              <div>
                <label className="block font-medium text-[#172B4D] mb-1">
                  Session Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. AY 2026-27 Salaried Return"
                  value={newSessionTitle}
                  onChange={(e) => setNewSessionTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg text-[#172B4D]"
                />
              </div>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={preloadDemo}
                  onChange={(e) => setPreloadDemo(e.target.checked)}
                  className="mt-0.5 rounded border-[#E2E8F0] text-[#2563EB]"
                />
                <span className="text-[#64748B] leading-relaxed">
                  Preload the 4-document Synthetic Demo Pack (₹12L salary, ₹60k TDS, ₹10k savings interest, ₹15k FD interest, ₹1L Section 80C receipts).
                </span>
              </label>
              <div className="flex justify-end gap-2.5 pt-4 border-t border-[#E2E8F0]">
                <Button
                  variant="secondary"
                  onClick={() => setShowNewSessionModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={creatingSession}
                >
                  Create Session
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
