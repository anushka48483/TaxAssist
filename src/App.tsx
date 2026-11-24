import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  HelpCircle,
  Lock,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  ApprovalRequest,
  DocumentCategory,
  LiveFilingEvent,
  UploadedDocument,
  UserProfile,
  SecurityGatewayConfig,
  WorkspaceSnapshot,
} from './shared/types';
import { Button, ConfirmDialog } from './components/DesignSystem';
import { LandingPageView } from './components/LandingPageView';
import {
  ConsumerFilingWorkspace,
  ConsumerStepId,
  FieldActionPayload,
} from './components/ConsumerFilingWorkspace';
import { ChatSupportPanel } from './components/ChatSupportPanel';
import { TaxBreakdownModal } from './components/TaxBreakdownModal';
import { ApprovalConfirmationModal } from './components/ApprovalConfirmationModal';
import { ActivitySecurityDrawer } from './components/ActivitySecurityDrawer';

const STEPS: Array<{ id: ConsumerStepId; num: number; label: string }> = [
  { id: 'upload', num: 1, label: 'Upload Documents' },
  { id: 'review', num: 2, label: 'Review Numbers & Tax' },
  { id: 'submit', num: 3, label: 'Approve & Submit' },
];

export default function App() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'landing' | 'workspace'>('landing');
  const [activeStep, setActiveStep] = useState<ConsumerStepId>('upload');

  // Collapsible Support Chat & Secondary Drawers / Modals
  const [chatOpen, setChatOpen] = useState(false);
  const [pendingChatQuestion, setPendingChatQuestion] = useState<string | null>(null);
  const [sendingChat, setSendingChat] = useState(false);

  const [activityDrawerOpen, setActivityDrawerOpen] = useState(false);
  const [breakdownModalOpen, setBreakdownModalOpen] = useState(false);
  const [approvalModalState, setApprovalModalState] = useState<{
    open: boolean;
    mode: 'approval_request' | 'finalize_return';
    approval: ApprovalRequest | null;
  }>({ open: false, mode: 'approval_request', approval: null });
  const [resolvingModal, setResolvingModal] = useState(false);

  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [resettingDemo, setResettingDemo] = useState(false);
  const [activeLiveStatusText, setActiveLiveStatusText] = useState<string | null>(null);

  const sessionMenuRef = useRef<HTMLDivElement | null>(null);
  const activeSessionIdRef = useRef<string>('');
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const refreshDebounceRef = useRef<number | null>(null);
  const liveStatusTimerRef = useRef<number | null>(null);

  const applySnapshot = useCallback((nextSnapshot: WorkspaceSnapshot) => {
    const prevSessionId = activeSessionIdRef.current;
    activeSessionIdRef.current = nextSnapshot.activeSessionId;

    if (prevSessionId && prevSessionId !== nextSnapshot.activeSessionId) {
      seenEventIdsRef.current.clear();
    }

    for (const ev of nextSnapshot.liveEvents ?? []) {
      seenEventIdsRef.current.add(ev.eventId);
    }

    setSnapshot(nextSnapshot);
    setGlobalError(null);
  }, []);

  const fetchWorkspace = useCallback(async () => {
    try {
      const res = await fetch('/api/workspace');
      if (!res.ok) throw new Error('Failed to load workspace state.');
      const data = (await res.json()) as WorkspaceSnapshot;
      applySnapshot(data);
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : 'Unable to reach workspace server.'
      );
    } finally {
      setLoading(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    void fetchWorkspace();
  }, [fetchWorkspace]);

  useEffect(() => {
    if (!sessionMenuOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (
        sessionMenuRef.current &&
        !sessionMenuRef.current.contains(e.target as Node)
      ) {
        setSessionMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [sessionMenuOpen]);

  // Real-time Server-Sent Events subscription
  useEffect(() => {
    let eventSource: EventSource | null = null;

    const showBriefStatus = (text: string, autoClearMs?: number) => {
      setActiveLiveStatusText(text);
      if (liveStatusTimerRef.current) {
        window.clearTimeout(liveStatusTimerRef.current);
      }
      if (autoClearMs) {
        liveStatusTimerRef.current = window.setTimeout(() => {
          setActiveLiveStatusText(null);
        }, autoClearMs);
      }
    };

    const scheduleRefresh = () => {
      if (refreshDebounceRef.current) {
        window.clearTimeout(refreshDebounceRef.current);
      }
      refreshDebounceRef.current = window.setTimeout(() => {
        void fetchWorkspace();
      }, 220);
    };

    if (typeof window !== 'undefined' && 'EventSource' in window) {
      eventSource = new EventSource('/api/events');

      eventSource.addEventListener('live_event', (rawEvent: MessageEvent) => {
        try {
          const ev = JSON.parse(rawEvent.data) as LiveFilingEvent;
          if (activeSessionIdRef.current && ev.sessionId !== activeSessionIdRef.current) {
            return;
          }
          if (seenEventIdsRef.current.has(ev.eventId)) return;
          seenEventIdsRef.current.add(ev.eventId);

          if (ev.type === 'extraction_started' && ev.documentName) {
            showBriefStatus(`Reading ${ev.documentName}...`);
          } else if (ev.type === 'form_field_update_started' && ev.fieldLabel) {
            showBriefStatus(`Updating ${ev.fieldLabel}...`);
          } else if (ev.type === 'extraction_completed') {
            showBriefStatus('Document details extracted', 2800);
            scheduleRefresh();
          } else if (
            ev.type === 'form_field_updated' ||
            ev.type === 'tax_computation_completed' ||
            ev.type === 'approval_required' ||
            ev.type === 'filing_draft_generated'
          ) {
            if (ev.type === 'tax_computation_completed') {
              showBriefStatus('Tax numbers updated', 2200);
            }
            scheduleRefresh();
          }
        } catch {
          // Ignore malformed SSE payload
        }
      });

      eventSource.addEventListener('workspace_updated', () => {
        void fetchWorkspace();
      });
    }

    const pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchWorkspace();
      }
    }, 8000);

    return () => {
      if (eventSource) eventSource.close();
      window.clearInterval(pollTimer);
      if (refreshDebounceRef.current) window.clearTimeout(refreshDebounceRef.current);
      if (liveStatusTimerRef.current) window.clearTimeout(liveStatusTimerRef.current);
    };
  }, [fetchWorkspace]);

  // Actions
  const handleStartFreshFiling = async () => {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `AY 2026-27 Return (${new Date().toLocaleDateString('en-IN')})`,
        preloadSyntheticDemo: false,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start new return.');
    applySnapshot(data.snapshot);
    setActiveStep('upload');
    setViewMode('workspace');
  };

  const handleStartDemo = async () => {
    const res = await fetch('/api/demo/start', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load sample tax pack.');
    applySnapshot(data.snapshot);
    setActiveStep('review');
    setViewMode('workspace');
  };

  const handleResetDemo = async () => {
    setResettingDemo(true);
    try {
      const res = await fetch('/api/demo/reset', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset sample session.');
      applySnapshot(data.snapshot);
      setActiveStep('review');
      setConfirmResetOpen(false);
    } finally {
      setResettingDemo(false);
    }
  };

  const handleSwitchSession = async (sessionId: string) => {
    const res = await fetch(`/api/sessions/${sessionId}/activate`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to switch return.');
    applySnapshot(data.snapshot);
    const nextSnap = data.snapshot as WorkspaceSnapshot;
    if (nextSnap.activeDraft.status === 'validated_ready') {
      setActiveStep('submit');
    } else if (nextSnap.documents.length > 0 || nextSnap.activeDraft.inputs.grossSalary > 0) {
      setActiveStep('review');
    } else {
      setActiveStep('upload');
    }
    setSessionMenuOpen(false);
  };

  const handleUploadBatch = async (
    files: File[],
    explicitCategory?: DocumentCategory
  ): Promise<void> => {
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    if (explicitCategory) formData.append('category', explicitCategory);

    const res = await fetch('/api/documents/upload-batch', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Document upload failed.');
    applySnapshot(data.snapshot);
  };

  const handleReextractDocument = async (docId: string): Promise<void> => {
    const res = await fetch(`/api/documents/${docId}/reextract`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not re-read document.');
    applySnapshot(data.snapshot);
  };

  const handleDeleteDocument = async (docId: string): Promise<void> => {
    const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not remove document.');
    applySnapshot(data.snapshot);
  };

  const handleDownloadSampleFiles = async () => {
    const res = await fetch('/api/demo/sample-documents.zip');
    if (!res.ok) throw new Error('Could not download sample ZIP pack.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'TaxShield_Sample_Documents_AY2026_27.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleUpdateProfile = async (partial: Partial<UserProfile>) => {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update profile.');
    applySnapshot(data.snapshot);
  };

  const handleFieldAction = async (payload: FieldActionPayload) => {
    const res = await fetch(`/api/fields/${encodeURIComponent(payload.fieldKey)}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save change.');
    applySnapshot(data.snapshot);
  };

  const handleClearUnsupportedFlags = async () => {
    const res = await fetch('/api/sessions/clear-unsupported', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to clear flag.');
    applySnapshot(data.snapshot);
  };

  const handleSendChatQuestion = async (question: string) => {
    setChatOpen(true);
    setPendingChatQuestion(question);
    setSendingChat(true);
    try {
      const formData = new FormData();
      formData.append('message', question);
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Tax Support request failed.');
      applySnapshot(data.snapshot);
    } finally {
      setPendingChatQuestion(null);
      setSendingChat(false);
    }
  };

  const handleResolveApproval = async (
    approvalId: string,
    action: 'approve' | 'reject' | 'cancel',
    decisionNote?: string
  ) => {
    const res = await fetch(`/api/approvals/${approvalId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, decisionNote }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to apply decision.');
    applySnapshot(data.snapshot);
  };

  const handleConfirmApprovalModal = async () => {
    if (!snapshot) return;
    setResolvingModal(true);
    try {
      if (approvalModalState.mode === 'approval_request' && approvalModalState.approval) {
        await handleResolveApproval(
          approvalModalState.approval.id,
          'approve',
          'Approved by taxpayer.'
        );
      } else {
        const existingPending = snapshot.approvals.find(
          (a) => a.status === 'pending' && a.toolName === 'generate_return_draft'
        );
        let targetApprovalId = existingPending?.id;
        if (!targetApprovalId) {
          const res = await fetch('/api/gateway/stage-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              selectedRegime: snapshot.activeDraft.selectedRegime,
              releaseNote: `Finalized validated ITR-1 draft under ${snapshot.activeDraft.selectedRegime.toUpperCase()} Regime.`,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to prepare final draft.');
          applySnapshot(data.snapshot);
          const stagedApproval = data.outcome?.approvalRequest as ApprovalRequest | undefined;
          if (stagedApproval?.status === 'pending') {
            targetApprovalId = stagedApproval.id;
          }
        }
        if (targetApprovalId) {
          await handleResolveApproval(
            targetApprovalId,
            'approve',
            'Finalized and approved by taxpayer.'
          );
        }
      }
      setApprovalModalState({ open: false, mode: 'approval_request', approval: null });
    } finally {
      setResolvingModal(false);
    }
  };

  const handleUpdateGatewayConfig = async (partial: Partial<SecurityGatewayConfig>) => {
    const res = await fetch('/api/gateway/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update security settings.');
    applySnapshot(data.snapshot);
  };

  const handleTestPiiMasking = async (
    text: string
  ): Promise<{ maskedText: string; maskedCount: number }> => {
    const res = await fetch('/api/gateway/mask-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    return res.json();
  };

  const triggerJsonDownload = (fileName: string, payload: unknown) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadItrJson = () => {
    if (!snapshot) return;
    triggerJsonDownload(
      `ITR1_${snapshot.activeSession.assessmentYear}_v${snapshot.activeDraft.version}.json`,
      snapshot.activeDraft.itrJson
    );
  };

  const handleDownloadReceiptAndAudit = () => {
    if (!snapshot) return;
    const calc =
      snapshot.activeDraft.selectedRegime === 'new'
        ? snapshot.activeDraft.taxSummary.newRegime
        : snapshot.activeDraft.taxSummary.oldRegime;

    const bundle = {
      receiptType: 'TaxShield Simulated Local Filing Receipt & Activity Log',
      disclaimer:
        'Local draft package only. Not submitted to the Income Tax Department e-Filing Portal.',
      generatedAt: new Date().toISOString(),
      sessionId: snapshot.activeSessionId,
      assessmentYear: snapshot.activeSession.assessmentYear,
      draftVersion: snapshot.activeDraft.version,
      draftStatus: snapshot.activeDraft.status,
      approvedBy: snapshot.activeDraft.approvedBy,
      selectedRegime: snapshot.activeDraft.selectedRegime,
      summary: {
        grossTotalIncome: calc.grossTotalIncome,
        taxableIncome: calc.taxableIncome,
        totalTaxLiability: calc.totalTaxLiability,
        tdsAndAdvanceTaxPaid: calc.tdsCredited + calc.advanceTaxPaid,
        refundDue: calc.refundDue,
        netTaxPayable: calc.netTaxPayable,
      },
      auditChainValid: snapshot.auditChainValid,
      auditLogCount: snapshot.auditLogs.length,
      auditLogs: snapshot.auditLogs,
    };
    triggerJsonDownload(
      `TaxShield_Receipt_Audit_${snapshot.activeSessionId}.json`,
      bundle
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-8">
        <div className="w-full max-w-4xl space-y-4">
          <div className="h-14 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl animate-pulse" />
          <div className="h-72 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (globalError || !snapshot) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-8 max-w-md w-full text-center shadow-[0_2px_12px_rgba(23,43,77,0.06)]">
          <h1 className="text-base font-semibold text-[#172B4D]">
            Unable to Connect to Workspace
          </h1>
          <p className="text-xs text-[#64748B] mt-2 leading-relaxed">{globalError}</p>
          <div className="mt-5 flex justify-center">
            <Button variant="primary" onClick={fetchWorkspace}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (viewMode === 'landing') {
    return (
      <LandingPageView
        snapshot={snapshot}
        onEnterWorkspace={() => {
          setActiveStep(
            snapshot.activeDraft.status === 'validated_ready'
              ? 'submit'
              : snapshot.documents.length > 0 || snapshot.activeDraft.inputs.grossSalary > 0
                ? 'review'
                : 'upload'
          );
          setViewMode('workspace');
        }}
        onStartDemo={handleStartDemo}
        onStartFreshFiling={handleStartFreshFiling}
        onExploreArchitecture={() => {
          setViewMode('workspace');
          setActivityDrawerOpen(true);
        }}
      />
    );
  }

  // Compute plain-English live header status
  const pendingApprovals = snapshot.approvals.filter((a) => a.status === 'pending');
  const pendingFieldReviews = Object.values(snapshot.fieldStates ?? {}).filter(
    (f) => f.status === 'pending_confirmation' || f.status === 'needs_review'
  );
  const missingProfileCount = [
    snapshot.profile.fullName,
    snapshot.profile.pan,
    snapshot.profile.dateOfBirth,
    snapshot.profile.aadhaarLast4,
    snapshot.profile.bankName,
    snapshot.profile.bankAccountNumber,
    snapshot.profile.bankIfsc,
  ].filter((v) => !String(v ?? '').trim()).length;
  const unresolvedDiffsCount = snapshot.reconciliation.items.filter(
    (i) =>
      i.resolutionStatus !== 'resolved' &&
      i.severity !== 'missing_document' &&
      !pendingFieldReviews.some((f) => f.fieldKey === i.recommendedAction?.fieldToUpdate)
  ).length;
  const attentionItemsCount =
    (snapshot.activeDraft.validation.unsupportedScenarios?.length ?? 0) +
    pendingApprovals.length +
    pendingFieldReviews.length +
    unresolvedDiffsCount +
    (missingProfileCount > 0 ? 1 : 0);

  const isFinalized = snapshot.activeDraft.changeNote.startsWith('ITR-1 Draft Finalized:');

  const plainStatus = activeLiveStatusText
    ? activeLiveStatusText
    : isFinalized
      ? 'Ready to download'
      : attentionItemsCount > 0
        ? `${attentionItemsCount} ${attentionItemsCount === 1 ? 'item needs' : 'items need'} attention`
        : snapshot.documents.length > 0 || snapshot.activeDraft.inputs.grossSalary > 0
          ? 'Ready to submit'
          : 'Waiting for documents';

  const statusToneClass = activeLiveStatusText
    ? 'text-[#2563EB]'
    : isFinalized ||
        (attentionItemsCount === 0 &&
          (snapshot.documents.length > 0 || snapshot.activeDraft.inputs.grossSalary > 0))
      ? 'text-[#0D9488]'
      : attentionItemsCount > 0
        ? 'text-amber-700'
        : 'text-[#64748B]';

  return (
    <div className="min-h-screen bg-white text-[#172B4D] flex flex-col">
      {/* Clean 3-Zone Top Header */}
      <header className="sticky top-0 z-30 h-16 bg-white border-b border-[#E2E8F0] px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
        {/* Left Zone: Brand + Optional Session Switcher */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('landing')}
            className="flex items-center gap-2 text-left cursor-pointer whitespace-nowrap"
          >
            <span className="w-7 h-7 rounded-lg bg-[#2563EB] text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </span>
            <span className="text-sm font-bold tracking-tight text-[#172B4D]">
              TaxShield
            </span>
          </button>

          <div ref={sessionMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setSessionMenuOpen((o) => !o)}
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#64748B] hover:text-[#172B4D] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg whitespace-nowrap cursor-pointer"
            >
              <span className="max-w-[140px] truncate">{snapshot.activeSession.title}</span>
              <ChevronDown className="w-3.5 h-3.5 shrink-0" />
            </button>

            {sessionMenuOpen && (
              <div className="absolute left-0 mt-2 w-72 bg-white border border-[#E2E8F0] rounded-xl shadow-[0_8px_24px_rgba(23,43,77,0.08)] py-2 z-50 text-xs">
                <div className="px-3.5 py-1.5 text-[11px] font-semibold text-[#64748B]">
                  Your Filing Sessions
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-[#E2E8F0]">
                  {snapshot.sessions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => void handleSwitchSession(s.id)}
                      className={`w-full text-left px-3.5 py-2 hover:bg-[#F8FAFC] cursor-pointer flex items-center justify-between gap-2 ${
                        s.id === snapshot.activeSessionId
                          ? 'font-semibold text-[#2563EB]'
                          : 'text-[#172B4D]'
                      }`}
                    >
                      <span className="truncate">{s.title}</span>
                      <span className="text-[11px] font-mono text-[#64748B] shrink-0">
                        v{s.activeDraftVersion}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="mt-1 pt-2 border-t border-[#E2E8F0] px-2 space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSessionMenuOpen(false);
                      void handleStartFreshFiling();
                    }}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[#F8FAFC] text-[#172B4D] font-medium flex items-center gap-2 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#2563EB]" />
                    <span>Start New Blank Return</span>
                  </button>
                  {snapshot.activeSession.isDemoSession ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSessionMenuOpen(false);
                        setConfirmResetOpen(true);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[#F8FAFC] text-[#64748B] flex items-center gap-2 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset Sample Tax Pack</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setSessionMenuOpen(false);
                        void handleStartDemo();
                      }}
                      className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[#F8FAFC] text-[#64748B] flex items-center gap-2 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-[#0D9488]" />
                      <span>Try Sample Tax Pack</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center Zone: Clean 3-Step Horizontal Stepper */}
        <nav
          aria-label="Filing steps"
          className="hidden md:flex items-center gap-1 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-1 shrink-0"
        >
          {STEPS.map((step) => {
            const isCurrent = activeStep === step.id;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setActiveStep(step.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isCurrent
                    ? 'bg-white text-[#2563EB] font-semibold border border-[#E2E8F0] shadow-[0_1px_2px_rgba(23,43,77,0.05)]'
                    : 'text-[#64748B] hover:text-[#172B4D] border border-transparent'
                }`}
              >
                {step.num}. {step.label}
              </button>
            );
          })}
        </nav>

        {/* Right Zone: Plain Status + Activity & Security + Support Chat Toggle */}
        <div className="flex items-center gap-2.5 shrink-0">
          <span
            className={`hidden xl:inline text-xs font-medium whitespace-nowrap ${statusToneClass}`}
          >
            {plainStatus}
          </span>

          <Button
            variant="outline"
            size="sm"
            icon={<Lock className="w-3.5 h-3.5 text-[#64748B]" />}
            onClick={() => setActivityDrawerOpen(true)}
          >
            Activity &amp; Security
          </Button>

          <Button
            variant={chatOpen ? 'primary' : 'secondary'}
            size="sm"
            icon={<HelpCircle className="w-3.5 h-3.5" />}
            onClick={() => setChatOpen((o) => !o)}
          >
            Tax Support
          </Button>
        </div>
      </header>

      {/* Mobile Stepper Strip */}
      <div className="md:hidden border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2 flex items-center justify-between gap-2 overflow-x-auto">
        {STEPS.map((step) => {
          const isCurrent = activeStep === step.id;
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => setActiveStep(step.id)}
              className={`px-2.5 py-1 rounded-md text-xs whitespace-nowrap shrink-0 cursor-pointer ${
                isCurrent
                  ? 'bg-white text-[#2563EB] font-semibold border border-[#E2E8F0]'
                  : 'text-[#64748B]'
              }`}
            >
              {step.num}. {step.label}
            </button>
          );
        })}
      </div>

      {/* Main Content + Collapsible Support Copilot */}
      <div className="flex-1 flex min-w-0">
        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-10 py-8">
          <ConsumerFilingWorkspace
            snapshot={snapshot}
            activeStep={activeStep}
            onStepChange={setActiveStep}
            onUploadFiles={(files) => handleUploadBatch(files)}
            onReextractDocument={handleReextractDocument}
            onDeleteDocument={handleDeleteDocument}
            onStartDemo={handleStartDemo}
            onDownloadSampleFiles={handleDownloadSampleFiles}
            onUpdateProfile={handleUpdateProfile}
            onFieldAction={handleFieldAction}
            onClearUnsupportedFlags={handleClearUnsupportedFlags}
            onAskQuestion={handleSendChatQuestion}
            onOpenBreakdown={() => setBreakdownModalOpen(true)}
            onOpenApprovalModal={(approval) =>
              setApprovalModalState({
                open: true,
                mode: 'approval_request',
                approval,
              })
            }
            onOpenFinalizeModal={() =>
              setApprovalModalState({
                open: true,
                mode: 'finalize_return',
                approval: null,
              })
            }
            onResolveApproval={handleResolveApproval}
            onDownloadItrJson={handleDownloadItrJson}
            onDownloadReceiptAndAudit={handleDownloadReceiptAndAudit}
            onOpenActivityDrawer={() => setActivityDrawerOpen(true)}
          />
        </main>

        <ChatSupportPanel
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          messages={snapshot.chatHistory}
          pendingApprovals={pendingApprovals}
          pendingQuestion={pendingChatQuestion}
          sending={sendingChat}
          onSendQuestion={handleSendChatQuestion}
          onResolveApproval={handleResolveApproval}
        />
      </div>

      {/* Tax Breakdown Modal */}
      <TaxBreakdownModal
        open={breakdownModalOpen}
        onClose={() => setBreakdownModalOpen(false)}
        summary={snapshot.activeDraft.taxSummary}
        selectedRegime={snapshot.activeDraft.selectedRegime}
      />

      {/* Human Approval Modal */}
      <ApprovalConfirmationModal
        open={approvalModalState.open}
        mode={approvalModalState.mode}
        approval={approvalModalState.approval}
        draft={snapshot.activeDraft}
        loading={resolvingModal}
        onConfirm={handleConfirmApprovalModal}
        onReject={
          approvalModalState.approval
            ? async () => {
                setResolvingModal(true);
                try {
                  await handleResolveApproval(
                    approvalModalState.approval!.id,
                    'reject'
                  );
                  setApprovalModalState({
                    open: false,
                    mode: 'approval_request',
                    approval: null,
                  });
                } finally {
                  setResolvingModal(false);
                }
              }
            : undefined
        }
        onClose={() =>
          setApprovalModalState({
            open: false,
            mode: 'approval_request',
            approval: null,
          })
        }
      />

      {/* Activity & Security Drawer */}
      <ActivitySecurityDrawer
        open={activityDrawerOpen}
        onClose={() => setActivityDrawerOpen(false)}
        snapshot={snapshot}
        onUpdateGatewayConfig={handleUpdateGatewayConfig}
        onTestPiiMasking={handleTestPiiMasking}
        onDownloadAuditBundle={handleDownloadReceiptAndAudit}
      />

      {/* Reset Sample Pack Confirmation */}
      <ConfirmDialog
        open={confirmResetOpen}
        title="Reset Sample Tax Pack"
        description="Reset the sample return back to its original Form 16, Bank Statement, FD Certificate, and Investment Proof documents?"
        confirmLabel="Reset Sample"
        confirmVariant="primary"
        loading={resettingDemo}
        onConfirm={handleResetDemo}
        onClose={() => setConfirmResetOpen(false)}
      />
    </div>
  );
}
