import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileWarning,
  ShieldCheck,
} from 'lucide-react';
import {
  ReconciliationItem,
  ReturnFinancialInputs,
  WorkspaceSnapshot,
} from '../shared/types';
import { formatINR } from '../utils/format';
import {
  Button,
  EmptyState,
  SegmentedControl,
  SemanticTone,
  StatusIndicator,
  SurfaceCard,
} from './DesignSystem';

interface ReconciliationViewProps {
  snapshot: WorkspaceSnapshot;
  onStageUpdate: (
    inputs: Partial<ReturnFinancialInputs>,
    reason: string
  ) => Promise<void>;
  onNavigateToApprovals: () => void;
}

function getReconciliationTone(
  severity: ReconciliationItem['severity']
): SemanticTone {
  if (severity === 'matched') return 'success';
  if (severity === 'duplicate_detected') return 'teal';
  if (severity === 'missing_document') return 'neutral';
  return 'warning';
}

function getReconciliationLabel(item: ReconciliationItem): string {
  if (item.severity === 'matched') return 'Matched';
  if (item.severity === 'duplicate_detected') return 'Duplicate Deduplicated';
  if (item.severity === 'missing_proof') return 'Proof Variance';
  if (item.severity === 'missing_document') return 'Missing Document';
  return `Variance ${formatINR(item.varianceAmount)}`;
}

export const ReconciliationView: React.FC<ReconciliationViewProps> = ({
  snapshot,
  onStageUpdate,
  onNavigateToApprovals,
}) => {
  const { reconciliation } = snapshot;
  const [filter, setFilter] = useState<'all' | 'issues' | 'matched'>('all');
  const [stagingId, setStagingId] = useState<string | null>(null);
  const [stagedFeedback, setStagedFeedback] = useState<string | null>(null);

  const filteredItems = reconciliation.items.filter((item) => {
    if (filter === 'issues') return item.severity !== 'matched';
    if (filter === 'matched') return item.severity === 'matched';
    return true;
  });

  const handleStageSingle = async (item: ReconciliationItem) => {
    if (!item.recommendedAction) return;
    setStagingId(item.id);
    setStagedFeedback(null);
    try {
      await onStageUpdate(
        {
          [item.recommendedAction.fieldToUpdate]:
            item.recommendedAction.proposedValue,
        },
        item.recommendedAction.reason
      );
      setStagedFeedback(
        `Staged "${item.recommendedAction.label}" in the SecurityGateway Approval Center.`
      );
    } finally {
      setStagingId(null);
    }
  };

  const handleStageAllReconciled = async () => {
    setStagingId('batch-all');
    setStagedFeedback(null);
    try {
      const updates: Partial<ReturnFinancialInputs> = {};
      for (const item of reconciliation.items) {
        if (item.recommendedAction) {
          updates[item.recommendedAction.fieldToUpdate] =
            item.recommendedAction.proposedValue as never;
        }
      }

      if (Object.keys(updates).length === 0) {
        setStagedFeedback(
          'All reconcilable fields are already aligned with the active return draft.'
        );
        return;
      }

      await onStageUpdate(
        updates,
        'Batch cross-document reconciliation: synced verified Salary, Savings Interest (80TTA), FD Interest (Schedule OS), TDS Credit, and Section 80C/80D receipts.'
      );
      setStagedFeedback(
        'All cross-document reconciliations have been staged in the SecurityGateway Approval Center.'
      );
    } finally {
      setStagingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Reconciliation Header & Controls */}
      <SurfaceCard>
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-[#172B4D]">
                Cross-Document Reconciliation &amp; Duplicate-Income Guard
              </h2>
              <StatusIndicator
                tone={reconciliation.conflictCount > 0 ? 'warning' : 'success'}
                label={
                  reconciliation.conflictCount > 0
                    ? `${reconciliation.conflictCount} Variances Detected`
                    : 'All Checks Aligned'
                }
              />
            </div>
            <p className="text-xs text-[#64748B] leading-relaxed">
              Compares Form 16 vs Salary Slips, Form 16 TDS vs Form 26AS,
              Savings Bank Interest vs FD Interest vs AIS/TIS, and Investment
              Proofs with page citations. Overlapping entries across documents
              are deduplicated automatically.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <SegmentedControl
              ariaLabel="Filter reconciliation checks"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `All (${reconciliation.totalChecks})` },
                {
                  value: 'issues',
                  label: `Variances & Missing (${
                    reconciliation.conflictCount + reconciliation.missingCount
                  })`,
                },
                {
                  value: 'matched',
                  label: `Matched (${reconciliation.matchedCount})`,
                },
              ]}
            />

            {reconciliation.conflictCount > 0 && (
              <Button
                variant="primary"
                loading={stagingId === 'batch-all'}
                onClick={handleStageAllReconciled}
                icon={<ShieldCheck className="w-3.5 h-3.5" />}
              >
                Stage All Reconciled Fixes
              </Button>
            )}
          </div>
        </div>

        {stagedFeedback && (
          <div className="mt-4 px-4 py-3 rounded-lg bg-blue-50/80 border border-blue-200 flex flex-wrap items-center justify-between gap-3 text-xs text-[#172B4D]">
            <span>{stagedFeedback}</span>
            <button
              type="button"
              onClick={onNavigateToApprovals}
              className="font-semibold text-[#2563EB] inline-flex items-center gap-1 hover:underline shrink-0 cursor-pointer"
            >
              Open Approval Center
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </SurfaceCard>

      {/* Detailed Cross-Document Comparison List */}
      <SurfaceCard noPadding>
        {filteredItems.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="w-5 h-5" />}
            title="No reconciliation items match this filter"
            description="Switch to All checks above to review verified cross-document comparisons."
          />
        ) : (
          <div className="divide-y divide-[#E2E8F0]">
            {filteredItems.map((item) => (
              <div key={item.id} className="p-6 bg-white">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#64748B]">
                      {item.severity === 'matched' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                      ) : item.severity === 'missing_document' ? (
                        <FileWarning className="w-4 h-4 text-[#64748B] shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                      )}
                      <span className="font-semibold text-[#172B4D]">
                        {item.category}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-[11px] text-[#64748B]">
                        {item.reconciliationRule}
                      </span>
                      <StatusIndicator
                        tone={getReconciliationTone(item.severity)}
                        label={getReconciliationLabel(item)}
                        mono
                      />
                      <span className="text-[#64748B] font-mono text-[11px]">
                        Status: {item.resolutionStatus.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-[#172B4D]">
                      {item.title}
                    </h3>
                  </div>

                  {item.recommendedAction && (
                    <Button
                      variant="teal"
                      size="sm"
                      loading={stagingId === item.id}
                      onClick={() => handleStageSingle(item)}
                    >
                      {item.recommendedAction.label}
                    </Button>
                  )}
                </div>

                {/* Source A vs Source B Comparison Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-[#E2E8F0]">
                  <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-semibold text-[#172B4D]">
                        {item.sourceALabel}
                      </span>
                      <span className="text-sm font-bold text-[#172B4D] font-mono tabular-nums">
                        {formatINR(item.sourceAValue)}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#64748B] mt-1 font-mono tabular-nums">
                      {item.sourceADocName}
                      {item.sourceAPage ? ` · Page ${item.sourceAPage}` : ''}
                    </div>
                    <div className="text-xs text-[#172B4D] mt-2 font-mono bg-white px-3 py-1.5 rounded border border-[#E2E8F0]">
                      “{item.sourceASnippet}”
                    </div>
                  </div>

                  <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-semibold text-[#172B4D]">
                        {item.sourceBLabel}
                      </span>
                      <span className="text-sm font-bold text-[#172B4D] font-mono tabular-nums">
                        {formatINR(item.sourceBValue)}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#64748B] mt-1 font-mono tabular-nums">
                      {item.sourceBDocName}
                      {item.sourceBPage ? ` · Page ${item.sourceBPage}` : ''}
                    </div>
                    <div className="text-xs text-[#172B4D] mt-2 font-mono bg-white px-3 py-1.5 rounded border border-[#E2E8F0]">
                      “{item.sourceBSnippet}”
                    </div>
                  </div>
                </div>

                <p className="text-xs text-[#64748B] mt-3 leading-relaxed">
                  {item.explanation}
                </p>

                {item.clarificationPrompt && (
                  <div className="mt-3 text-xs text-amber-900 bg-amber-50/80 border border-amber-200 rounded-lg px-3.5 py-2.5">
                    <span className="font-semibold">
                      Taxpayer Confirmation Prompt:{' '}
                    </span>
                    {item.clarificationPrompt}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};
