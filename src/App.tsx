import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Calculator,
  ChevronDown,
  FileJson2,
  FileSpreadsheet,
  FileStack,
  Home,
  LayoutDashboard,
  Menu,
  MessageSquareCode,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Scale,
  ScrollText,
  ShieldCheck,
  User,
  Wrench,
  X,
} from 'lucide-react';
import taxpayerAvatar from './assets/images/avatar_taxpayer_profile_1793345336233.jpg';
import {
  AgentExecutionState,
  DocumentCategory,
  RagRuleCitation,
  ReturnFinancialInputs,
  SecurityGatewayConfig,
  TaxComparisonSummary,
  TaxRegime,
  UploadedDocument,
  UserProfile,
  WorkspaceSnapshot,
} from './shared/types';
import { maskPan } from './utils/format';
import { Button, ConfirmDialog, SemanticTone, StatusIndicator } from './components/DesignSystem';
import { LandingPageView } from './components/LandingPageView';
import { DashboardView, NavSection } from './components/DashboardView';
import { DocumentCenterView } from './components/DocumentCenterView';
import { AiAssistantView } from './components/AiAssistantView';
import { AgentActivityMonitorView } from './components/AgentActivityMonitorView';
import { McpToolsInspectorView } from './components/McpToolsInspectorView';
import { FinancialSummaryView } from './components/FinancialSummaryView';
import { TaxSummaryView } from './components/TaxSummaryView';
import { ApprovalCenterView } from './components/ApprovalCenterView';
import { Itr1FormPreviewView } from './components/Itr1FormPreviewView';
import { ReturnPreviewView } from './components/ReturnPreviewView';
import { AuditTrailView } from './components/AuditTrailView';
import { SystemArchitectureView } from './components/SystemArchitectureView';

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'assistant', label: 'AI Filing Assistant', icon: MessageSquareCode },
  { id: 'documents', label: 'Documents', icon: FileStack },
  { id: 'financial-summary', label: 'Financial Summary', icon: Scale },
  { id: 'tax-computation', label: 'Tax Computation', icon: Calculator },
  { id: 'activity-monitor', label: 'Agent Activity', icon: Activity },
  { id: 'mcp-tools', label: 'MCP Tools', icon: Wrench },
  { id: 'approvals', label: 'Approval Center', icon: ShieldCheck },
  { id: 'itr1-form', label: 'ITR-1 Form Preview', icon: FileSpreadsheet },
  { id: 'return-preview', label: 'Generated Return', icon: FileJson2 },
  { id: 'audit-trail', label: 'Audit Trail', icon: ScrollText },
  { id: 'architecture', label: 'System Architecture', icon: Network },
];

function getAgentStateTone(state: AgentExecutionState): SemanticTone {
  switch (state) {
    case 'COMPLETED':
      return 'success';
    case 'PLANNING':
    case 'EXECUTING_TOOLS':
      return 'info';
    case 'WAITING_FOR_HUMAN_APPROVAL':
    case 'WAITING_FOR_USER_CLARIFICATION':
      return 'warning';
    case 'HALTED_UNSUPPORTED_SCENARIO':
    case 'ERROR':
      return 'error';
    case 'IDLE':
    default:
      return 'neutral';
  }
}

function getAgentStateShortLabel(state: AgentExecutionState): string {
  switch (state) {
    case 'IDLE':
      return 'Agent Idle';
    case 'PLANNING':
      return 'Planning';
    case 'EXECUTING_TOOLS':
      return 'Executing Tools';
    case 'WAITING_FOR_USER_CLARIFICATION':
      return 'Needs Clarification';
    case 'WAITING_FOR_HUMAN_APPROVAL':
      return 'Awaiting Approval';
    case 'HALTED_UNSUPPORTED_SCENARIO':
      return 'Scope Halted';
    case 'COMPLETED':
      return 'Completed';
    case 'ERROR':
      return 'Error';
  }
}

export default function App() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'landing' | 'workspace'>('landing');
  const [activeNav, setActiveNav] = useState<NavSection>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [resettingDemo, setResettingDemo] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>(new Date().toISOString());

  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  const applySnapshot = useCallback((nextSnapshot: WorkspaceSnapshot) => {
    setSnapshot(nextSnapshot);
    setLastSyncedAt(new Date().toISOString());
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
        err instanceof Error ? err.message : 'Unable to reach MCP workspace server.'
      );
    } finally {
      setLoading(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    fetchWorkspace();
  }, [fetchWorkspace]);

  // Close profile menu when clicking outside
  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(e.target as Node)
      ) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [profileMenuOpen]);

  // Real-time Server-Sent Events (SSE) subscription + lightweight polling fallback
  useEffect(() => {
    let eventSource: EventSource | null = null;
    if (typeof window !== 'undefined' && 'EventSource' in window) {
      eventSource = new EventSource('/api/events');
      const handleWorkspaceUpdate = () => {
        void fetchWorkspace();
      };
      eventSource.addEventListener('workspace_updated', handleWorkspaceUpdate);
    }

    const pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchWorkspace();
      }
    }, 4000);

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      window.clearInterval(pollTimer);
    };
  }, [fetchWorkspace]);

  const handleStartInteractiveDemo = async () => {
    const res = await fetch('/api/demo/start', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to launch isolated demo session.');
    applySnapshot(data.snapshot);
    setActiveNav('assistant');
    setViewMode('workspace');
  };

  const handleResetDemo = async () => {
    setResettingDemo(true);
    try {
      const res = await fetch('/api/demo/reset', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset demo session.');
      applySnapshot(data.snapshot);
      setConfirmResetOpen(false);
    } finally {
      setResettingDemo(false);
    }
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

  const handleCreateSession = async (title: string, preloadSyntheticDemo: boolean) => {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, preloadSyntheticDemo }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create session.');
    applySnapshot(data.snapshot);
  };

  const handleSwitchSession = async (sessionId: string) => {
    const res = await fetch(`/api/sessions/${sessionId}/activate`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to switch session.');
    applySnapshot(data.snapshot);
  };

  const handleClearUnsupportedFlags = async () => {
    const res = await fetch('/api/sessions/clear-unsupported', {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to clear unsupported flags.');
    applySnapshot(data.snapshot);
  };

  const handleUploadBatch = async (
    files: File[],
    explicitCategory?: DocumentCategory
  ): Promise<UploadedDocument[]> => {
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    if (explicitCategory) {
      formData.append('category', explicitCategory);
    }

    const res = await fetch('/api/documents/upload-batch', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Batch document upload failed.');
    applySnapshot(data.snapshot);
    return (data.documents ?? []) as UploadedDocument[];
  };

  const handleReextractDocument = async (docId: string): Promise<void> => {
    const res = await fetch(`/api/documents/${docId}/reextract`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Document re-extraction failed.');
    applySnapshot(data.snapshot);
  };

  const handleUploadSyntheticDemoPack = async () => {
    const res = await fetch('/api/demo/upload-synthetic-pack', {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to ingest synthetic demo pack.');
    applySnapshot(data.snapshot);
  };

  const handleDownloadSyntheticFiles = async () => {
    const res = await fetch('/api/demo/synthetic-files');
    const data = (await res.json()) as {
      files: Array<{ fileName: string; mimeType: string; content: string }>;
    };
    if (!res.ok || !data.files) {
      throw new Error('Failed to fetch synthetic demo files.');
    }
    for (const file of data.files) {
      const blob = new Blob([file.content], { type: file.mimeType || 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleToggleAcl = async (docId: string, allowed: boolean) => {
    const res = await fetch(`/api/documents/${docId}/acl`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAccessAllowed: allowed }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to toggle ACL.');
    applySnapshot(data.snapshot);
  };

  const handleDeleteDocument = async (docId: string) => {
    const res = await fetch(`/api/documents/${docId}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete document.');
    applySnapshot(data.snapshot);
  };

  const handleSendMessage = async (message: string, files?: File[]) => {
    const formData = new FormData();
    formData.append('message', message);
    if (files && files.length > 0) {
      files.forEach((f) => formData.append('files', f));
    }

    const res = await fetch('/api/assistant/chat', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'AI Assistant error.');
    applySnapshot(data.snapshot);
  };

  const handleSearchRagRules = async (query: string): Promise<RagRuleCitation[]> => {
    const res = await fetch(`/api/rag/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    return (data.citations ?? []) as RagRuleCitation[];
  };

  const handleCalculatePreview = async (
    inputs: ReturnFinancialInputs
  ): Promise<TaxComparisonSummary> => {
    const res = await fetch('/api/tax/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
    });
    const data = await res.json();
    return data.summary as TaxComparisonSummary;
  };

  const handleStageUpdate = async (
    inputs: Partial<ReturnFinancialInputs>,
    reason: string,
    selectedRegime?: TaxRegime
  ) => {
    const res = await fetch('/api/gateway/stage-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs, selectedRegime, reason }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to stage update.');
    applySnapshot(data.snapshot);
  };

  const handleStageGenerateDraft = async (
    selectedRegime: TaxRegime,
    releaseNote: string
  ) => {
    const res = await fetch('/api/gateway/stage-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedRegime, releaseNote }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to stage ITR generation.');
    applySnapshot(data.snapshot);
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
    if (!res.ok) throw new Error(data.error || 'Failed to resolve approval.');
    applySnapshot(data.snapshot);
  };

  const handleUpdateGatewayConfig = async (partial: Partial<SecurityGatewayConfig>) => {
    const res = await fetch('/api/gateway/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update gateway policy.');
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

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-8">
        <div className="w-full max-w-5xl space-y-4">
          <div className="h-14 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="h-24 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl animate-pulse" />
            <div className="h-24 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl animate-pulse" />
            <div className="h-24 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl animate-pulse" />
            <div className="h-24 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl animate-pulse" />
          </div>
          <div className="h-80 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (globalError || !snapshot) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-8 max-w-md w-full text-center shadow-[0_2px_12px_rgba(23,43,77,0.06)]">
          <h1 className="text-base font-semibold text-[#172B4D]">
            Workspace Connection Error
          </h1>
          <p className="text-xs text-[#64748B] mt-2 leading-relaxed">{globalError}</p>
          <div className="mt-5 flex justify-center">
            <Button variant="primary" onClick={fetchWorkspace}>
              Retry Connection
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
          setActiveNav('overview');
          setViewMode('workspace');
        }}
        onStartDemo={handleStartInteractiveDemo}
        onExploreArchitecture={() => {
          setActiveNav('architecture');
          setViewMode('workspace');
        }}
      />
    );
  }

  const pendingApprovalsCount = snapshot.approvals.filter(
    (a) => a.status === 'pending'
  ).length;
  const activeNavLabel =
    NAV_ITEMS.find((i) => i.id === activeNav)?.label ?? 'Overview';
  const activeSession = snapshot.activeSession;

  const getNavBadge = (id: NavSection): string | number | null => {
    if (id === 'approvals' && pendingApprovalsCount > 0) return pendingApprovalsCount;
    if (id === 'documents' && snapshot.documents.length > 0) return snapshot.documents.length;
    if (id === 'financial-summary' && snapshot.reconciliation.conflictCount > 0) {
      return snapshot.reconciliation.conflictCount;
    }
    if (id === 'mcp-tools') return 22;
    if (id === 'itr1-form') return `v${snapshot.activeDraft.version}`;
    if (id === 'audit-trail' && snapshot.auditLogs.length > 0) return snapshot.auditLogs.length;
    return null;
  };

  return (
    <div className="min-h-screen bg-white text-[#172B4D] flex">
      {/* Desktop Collapsible White Sidebar */}
      <aside
        className={`hidden lg:flex lg:flex-col shrink-0 bg-white border-r border-[#E2E8F0] transition-[width] duration-200 ${
          sidebarCollapsed ? 'lg:w-[72px]' : 'lg:w-[260px]'
        }`}
      >
        <div className="h-16 px-4 flex items-center justify-between border-b border-[#E2E8F0]">
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setViewMode('landing')}
              title="Return to TaxShield MCP Product Home"
              className="text-base font-bold tracking-tight text-[#172B4D] hover:text-[#2563EB] transition-colors whitespace-nowrap truncate cursor-pointer"
            >
              TaxShield MCP
            </button>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            className="p-2 rounded-lg text-[#64748B] hover:text-[#172B4D] hover:bg-[#F8FAFC] transition-colors mx-auto lg:mx-0 cursor-pointer"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        </div>

        <nav
          aria-label="Primary workspace navigation"
          className="flex-1 px-2.5 py-4 space-y-0.5 overflow-y-auto"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.id;
            const badge = getNavBadge(item.id);

            return (
              <button
                key={item.id}
                type="button"
                title={sidebarCollapsed ? item.label : undefined}
                onClick={() => setActiveNav(item.id)}
                className={`w-full flex items-center ${
                  sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3'
                } py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-blue-50 text-[#2563EB] font-semibold'
                    : 'text-[#64748B] hover:text-[#172B4D] hover:bg-[#F8FAFC]'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-[#2563EB]' : 'text-[#64748B]'
                    }`}
                  />
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                </span>
                {!sidebarCollapsed && badge !== null && (
                  <span
                    className={`font-mono tabular-nums text-[11px] px-1.5 py-0.5 rounded ${
                      item.id === 'approvals' && pendingApprovalsCount > 0
                        ? 'bg-amber-100 text-amber-800 font-semibold'
                        : isActive
                          ? 'bg-blue-100/80 text-[#2563EB]'
                          : 'text-[#64748B]'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {!sidebarCollapsed && (
          <div className="p-4 border-t border-[#E2E8F0] bg-white text-xs space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[#172B4D] truncate">
                {snapshot.profile.fullName}
              </span>
              <span className="font-mono text-[10px] text-[#0D9488] font-semibold shrink-0">
                {snapshot.auditChainValid ? 'SHA-256 OK' : 'CHECK CHAIN'}
              </span>
            </div>
            <div className="font-mono tabular-nums text-[11px] text-[#64748B]">
              PAN {maskPan(snapshot.profile.pan)} · {activeSession.assessmentYear}
            </div>
            <button
              type="button"
              onClick={() => setViewMode('landing')}
              className="pt-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-[#2563EB] hover:underline cursor-pointer"
            >
              <Home className="w-3 h-3" />
              <span>Product Home</span>
            </button>
          </div>
        )}
      </aside>

      {/* Mobile & Tablet Slide-Over Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-[#172B4D]/25"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-72 bg-white border-r border-[#E2E8F0] flex flex-col">
            <div className="h-16 px-5 flex items-center justify-between border-b border-[#E2E8F0]">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setViewMode('landing');
                }}
                className="text-base font-bold tracking-tight text-[#172B4D]"
              >
                TaxShield MCP
              </button>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="p-1.5 text-[#64748B] hover:text-[#172B4D] rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeNav === item.id;
                const badge = getNavBadge(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveNav(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-lg text-xs font-medium ${
                      isActive
                        ? 'bg-blue-50 text-[#2563EB] font-semibold'
                        : 'text-[#64748B] hover:text-[#172B4D] hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </span>
                    {badge !== null && (
                      <span className="font-mono tabular-nums text-[11px]">{badge}</span>
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        {/* Pure White Top Navigation Bar */}
        <header className="sticky top-0 z-30 h-16 bg-white border-b border-[#E2E8F0] px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 shrink-0">
          {/* Left: Mobile Drawer Trigger + Brand/Section + AY + Active Session Selector */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-[#64748B] hover:text-[#172B4D] rounded-lg hover:bg-[#F8FAFC]"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 text-xs min-w-0">
              <span className="hidden sm:inline font-bold text-[#172B4D] whitespace-nowrap">
                TaxShield MCP
              </span>
              <span className="hidden sm:inline text-[#CBD5E1]" aria-hidden="true">
                /
              </span>
              <span className="font-semibold text-[#2563EB] whitespace-nowrap">
                {activeNavLabel}
              </span>
            </div>

            <span
              aria-hidden="true"
              className="hidden md:inline h-4 w-px bg-[#E2E8F0] mx-1"
            />

            <span className="hidden md:inline font-mono tabular-nums text-xs text-[#64748B] whitespace-nowrap">
              {activeSession.assessmentYear}
            </span>

            <select
              aria-label="Current filing session"
              value={snapshot.activeSessionId}
              onChange={(e) => handleSwitchSession(e.target.value)}
              className="hidden xl:block max-w-[230px] px-2.5 py-1.5 text-xs font-medium text-[#172B4D] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#2563EB] truncate cursor-pointer"
            >
              {snapshot.sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} (v{s.activeDraftVersion})
                </option>
              ))}
            </select>
          </div>

          {/* Right: Live Agent Status + Demo Mode Indicator + Pending Approval CTA + User/Profile Menu */}
          <div className="flex items-center gap-2.5 shrink-0">
            <StatusIndicator
              tone={getAgentStateTone(activeSession.agentState)}
              label={getAgentStateShortLabel(activeSession.agentState)}
              mono
            />

            {activeSession.isDemoSession ? (
              <div className="hidden sm:flex items-center gap-1.5">
                <StatusIndicator tone="teal" label="Demo Sandbox" />
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RotateCcw className="w-3.5 h-3.5" />}
                  onClick={() => setConfirmResetOpen(true)}
                  title="Reset synthetic demo session"
                >
                  Reset
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                className="hidden sm:inline-flex"
                onClick={handleStartInteractiveDemo}
              >
                Launch Demo
              </Button>
            )}

            {pendingApprovalsCount > 0 && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setActiveNav('approvals')}
              >
                Approve ({pendingApprovalsCount})
              </Button>
            )}

            {/* User / Profile Dropdown Menu */}
            <div ref={profileMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setProfileMenuOpen((o) => !o)}
                aria-expanded={profileMenuOpen}
                aria-haspopup="menu"
                className="inline-flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-xs font-medium text-[#172B4D] transition-colors cursor-pointer"
              >
                <span className="w-6 h-6 rounded-md bg-blue-50 text-[#2563EB] flex items-center justify-center font-semibold text-[11px]">
                  <User className="w-3.5 h-3.5" />
                </span>
                <span className="hidden md:inline max-w-[120px] truncate">
                  {snapshot.profile.fullName}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-[#64748B]" />
              </button>

              {profileMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-64 bg-white border border-[#E2E8F0] rounded-xl shadow-[0_8px_24px_rgba(23,43,77,0.08)] py-2 z-50 text-xs"
                >
                  <div className="px-4 py-2.5 border-b border-[#E2E8F0]">
                    <div className="font-semibold text-[#172B4D] truncate">
                      {snapshot.profile.fullName}
                    </div>
                    <div className="font-mono tabular-nums text-[11px] text-[#64748B] mt-0.5">
                      PAN {maskPan(snapshot.profile.pan)} · {activeSession.assessmentYear}
                    </div>
                    <div className="text-[11px] text-[#64748B] mt-0.5 truncate">
                      Session: {activeSession.title}
                    </div>
                  </div>

                  <div className="py-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        setActiveNav('overview');
                      }}
                      className="w-full text-left px-4 py-2 text-[#172B4D] hover:bg-[#F8FAFC] cursor-pointer"
                    >
                      Overview &amp; Taxpayer Profile
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        setActiveNav('assistant');
                      }}
                      className="w-full text-left px-4 py-2 text-[#172B4D] hover:bg-[#F8FAFC] cursor-pointer"
                    >
                      AI Filing Assistant
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        setActiveNav('return-preview');
                      }}
                      className="w-full text-left px-4 py-2 text-[#172B4D] hover:bg-[#F8FAFC] cursor-pointer"
                    >
                      Generated Return (Draft v{snapshot.activeDraft.version})
                    </button>
                    {activeSession.isDemoSession && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setProfileMenuOpen(false);
                          setConfirmResetOpen(true);
                        }}
                        className="w-full text-left px-4 py-2 text-[#0D9488] font-medium hover:bg-[#F8FAFC] cursor-pointer"
                      >
                        Reset Synthetic Demo Session
                      </button>
                    )}
                  </div>

                  <div className="pt-1 border-t border-[#E2E8F0]">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        setViewMode('landing');
                      }}
                      className="w-full text-left px-4 py-2 text-[#64748B] hover:text-[#172B4D] hover:bg-[#F8FAFC] cursor-pointer"
                    >
                      Return to Product Home
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-5 sm:p-6 lg:p-8 max-w-[1380px] w-full mx-auto bg-white">
          {activeNav === 'overview' && (
            <DashboardView
              snapshot={snapshot}
              onNavigate={setActiveNav}
              onUpdateProfile={handleUpdateProfile}
              onCreateSession={handleCreateSession}
              onSwitchSession={handleSwitchSession}
              onUploadSyntheticDemoPack={handleUploadSyntheticDemoPack}
              onResetDemo={() => setConfirmResetOpen(true)}
              avatarUrl={taxpayerAvatar}
            />
          )}

          {activeNav === 'assistant' && (
            <AiAssistantView
              snapshot={snapshot}
              onSendMessage={handleSendMessage}
              onStageUpdate={(inputs, reason) => handleStageUpdate(inputs, reason)}
              onUploadSyntheticDemoPack={handleUploadSyntheticDemoPack}
              onDownloadSyntheticFiles={handleDownloadSyntheticFiles}
              onResolveApproval={handleResolveApproval}
              onClearUnsupportedFlags={handleClearUnsupportedFlags}
              onSearchRagRules={handleSearchRagRules}
              onNavigateToItrForm={() => setActiveNav('itr1-form')}
              onNavigateToActivityMonitor={() => setActiveNav('activity-monitor')}
              onNavigateToTaxComputation={() => setActiveNav('tax-computation')}
            />
          )}

          {activeNav === 'activity-monitor' && (
            <AgentActivityMonitorView
              snapshot={snapshot}
              lastSyncedAt={lastSyncedAt}
              onRefresh={fetchWorkspace}
              onNavigateToAssistant={() => setActiveNav('assistant')}
              onNavigateToItrForm={() => setActiveNav('itr1-form')}
              onNavigateToApprovals={() => setActiveNav('approvals')}
            />
          )}

          {activeNav === 'mcp-tools' && (
            <McpToolsInspectorView snapshot={snapshot} />
          )}

          {activeNav === 'documents' && (
            <DocumentCenterView
              snapshot={snapshot}
              onUploadBatch={handleUploadBatch}
              onReextractDocument={handleReextractDocument}
              onUploadSyntheticDemoPack={handleUploadSyntheticDemoPack}
              onDownloadSyntheticFiles={handleDownloadSyntheticFiles}
              onToggleAcl={handleToggleAcl}
              onDeleteDocument={handleDeleteDocument}
              onNavigateToAssistant={() => setActiveNav('assistant')}
            />
          )}

          {activeNav === 'financial-summary' && (
            <FinancialSummaryView
              snapshot={snapshot}
              onStageUpdate={(inputs, reason) => handleStageUpdate(inputs, reason)}
              onNavigateToApprovals={() => setActiveNav('approvals')}
              onNavigateToTaxComputation={() => setActiveNav('tax-computation')}
            />
          )}

          {activeNav === 'tax-computation' && (
            <TaxSummaryView
              snapshot={snapshot}
              onCalculatePreview={handleCalculatePreview}
              onStageUpdate={handleStageUpdate}
              onNavigateToApprovals={() => setActiveNav('approvals')}
            />
          )}

          {activeNav === 'approvals' && (
            <ApprovalCenterView
              snapshot={snapshot}
              onResolveApproval={handleResolveApproval}
              onUpdateGatewayConfig={handleUpdateGatewayConfig}
              onTestPiiMasking={handleTestPiiMasking}
            />
          )}

          {activeNav === 'itr1-form' && (
            <Itr1FormPreviewView
              snapshot={snapshot}
              onNavigateToGeneratedReturn={() => setActiveNav('return-preview')}
              onNavigateToAssistant={() => setActiveNav('assistant')}
              onNavigateToApprovals={() => setActiveNav('approvals')}
            />
          )}

          {activeNav === 'return-preview' && (
            <ReturnPreviewView
              snapshot={snapshot}
              onStageGenerateDraft={handleStageGenerateDraft}
              onNavigateToApprovals={() => setActiveNav('approvals')}
            />
          )}

          {activeNav === 'audit-trail' && (
            <AuditTrailView
              snapshot={snapshot}
              onTestPiiMasking={handleTestPiiMasking}
            />
          )}

          {activeNav === 'architecture' && (
            <SystemArchitectureView
              snapshot={snapshot}
              onNavigateToMonitor={() => setActiveNav('activity-monitor')}
              onNavigateToMcpTools={() => setActiveNav('mcp-tools')}
              onNavigateToItrForm={() => setActiveNav('itr1-form')}
            />
          )}
        </main>
      </div>

      {/* Accessible Confirmation Dialog for Resetting Synthetic Demo */}
      <ConfirmDialog
        open={confirmResetOpen}
        title="Reset Synthetic Demo Session?"
        description="This will restore the isolated AY 2026-27 demo session to its clean starting state with the 4 synthetic documents, clear chat history and approvals, and reset Draft v1."
        confirmLabel="Reset Demo Session"
        confirmVariant="primary"
        loading={resettingDemo}
        onConfirm={handleResetDemo}
        onClose={() => setConfirmResetOpen(false)}
      />
    </div>
  );
}
