import React, { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Lock,
  Scale,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import { WorkspaceSnapshot } from '../shared/types';
import { Button } from './DesignSystem';

interface LandingPageViewProps {
  snapshot: WorkspaceSnapshot;
  onEnterWorkspace: () => void;
  onStartDemo: () => Promise<void>;
  onStartFreshFiling: () => Promise<void>;
  onExploreArchitecture: () => void;
}

const PREVIEW_FIELDS = [
  {
    section: 'Section C · Salary Income',
    field: 'Gross Salary (u/s 17(1))',
    value: '₹12,00,000',
    source: 'Form 16 · Page 1',
    status: 'Verified',
  },
  {
    section: 'Section C · Salary Income',
    field: 'Standard Deduction (u/s 16(ia))',
    value: '₹75,000',
    source: 'New Regime Rule · Automatic',
    status: 'Calculated',
  },
  {
    section: 'Section D · Other Sources',
    field: 'Savings Bank Interest',
    value: '₹10,000',
    source: 'Bank Statement · Page 2',
    status: 'Needs Confirmation',
  },
  {
    section: 'Section D · Other Sources',
    field: 'Fixed Deposit Interest',
    value: '₹45,000',
    source: 'FD Certificate · Page 1',
    status: 'Needs Confirmation',
  },
  {
    section: 'Section H · Taxes Paid',
    field: 'Total TDS Credit',
    value: '₹60,000',
    source: 'Form 16 & Form 26AS Match',
    status: 'Verified',
  },
];

export const LandingPageView: React.FC<LandingPageViewProps> = ({
  snapshot,
  onEnterWorkspace,
  onStartDemo,
  onStartFreshFiling,
  onExploreArchitecture,
}) => {
  const [startingDemo, setStartingDemo] = useState(false);
  const [startingFresh, setStartingFresh] = useState(false);

  const handleLaunchDemo = async () => {
    setStartingDemo(true);
    try {
      await onStartDemo();
    } finally {
      setStartingDemo(false);
    }
  };

  const handleStartFresh = async () => {
    setStartingFresh(true);
    try {
      await onStartFreshFiling();
    } finally {
      setStartingFresh(false);
    }
  };

  const hasPersonalProgress =
    !snapshot.activeSession.isDemoSession &&
    (snapshot.documents.length > 0 ||
      snapshot.activeDraft.inputs.grossSalary > 0 ||
      Boolean(snapshot.profile.fullName || snapshot.profile.pan));

  return (
    <div className="min-h-screen bg-white text-[#172B4D]">
      {/* Minimal Top Navigation */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-[#E2E8F0]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#2563EB] text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-[#172B4D]">
                TaxShield
              </div>
              <div className="text-[11px] text-[#64748B]">
                ITR-1 Sahaj · AY 2026-27
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {hasPersonalProgress && (
              <Button variant="outline" size="sm" onClick={onEnterWorkspace}>
                Resume Your Return
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              loading={startingFresh}
              onClick={handleStartFresh}
              rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
            >
              Start Filing
            </Button>
          </div>
        </div>
      </header>

      {/* Main Consumer Hero */}
      <main>
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-16 lg:pt-16 lg:pb-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            <div className="lg:col-span-6 space-y-6">
              <div className="text-xs font-medium text-[#2563EB]">
                Assessment Year 2026-27 · Salaried Individuals (ITR-1)
              </div>

              <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-[#172B4D] leading-[1.16]">
                File your taxes in 3 calm steps — upload, review, and approve.
              </h1>

              <p className="text-sm sm:text-base text-[#64748B] leading-relaxed">
                Upload your Form 16, bank statements, FD certificates, and investment proofs.
                TaxShield extracts every figure, compares Old vs New tax regimes automatically,
                flags anything needing your check, and explains any rule on demand.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  variant="primary"
                  size="lg"
                  loading={startingFresh}
                  onClick={handleStartFresh}
                  icon={<Upload className="w-4 h-4" />}
                >
                  Start Filing Your Return
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  loading={startingDemo}
                  onClick={handleLaunchDemo}
                  icon={<Sparkles className="w-4 h-4 text-[#0D9488]" />}
                >
                  Try Sample Tax Pack
                </Button>
                {hasPersonalProgress && (
                  <Button
                    variant="ghost"
                    size="lg"
                    onClick={onEnterWorkspace}
                    rightIcon={<ArrowRight className="w-4 h-4" />}
                  >
                    Open Current Session
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-[#E2E8F0] text-xs text-[#64748B]">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#0D9488] shrink-0" />
                  <span>Plain-English review with inline editing</span>
                </div>
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#2563EB] shrink-0" />
                  <span>Human approval before anything is saved</span>
                </div>
                <div className="flex items-center gap-2">
                  <Scale className="w-4 h-4 text-[#0D9488] shrink-0" />
                  <span>Accurate Old vs New Regime tax check</span>
                </div>
                <div className="flex items-center gap-2">
                  <FileCheck2 className="w-4 h-4 text-[#2563EB] shrink-0" />
                  <span>Local ITR-1 draft export — never auto-submitted</span>
                </div>
              </div>
            </div>

            {/* Clean Visual Live-Form Preview */}
            <div className="lg:col-span-6">
              <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-[0_8px_24px_rgba(23,43,77,0.06)] overflow-hidden">
                <div className="px-5 py-3.5 bg-[#F8FAFC] border-b border-[#E2E8F0] flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-[#2563EB]" />
                    <span className="text-xs font-semibold text-[#172B4D]">
                      Example · Automatic ITR-1 Summary
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-[#64748B]">
                    Sample Preview
                  </span>
                </div>

                <div className="divide-y divide-[#E2E8F0]">
                  {PREVIEW_FIELDS.map((item) => (
                    <div
                      key={item.field}
                      className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-[#F8FAFC]/70 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium text-[#64748B]">
                          {item.section}
                        </div>
                        <div className="text-xs font-semibold text-[#172B4D] mt-0.5">
                          {item.field}
                        </div>
                        <div className="text-[11px] text-[#64748B] mt-0.5">
                          Source: {item.source}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold font-mono tabular-nums text-[#172B4D]">
                          {item.value}
                        </div>
                        <div
                          className={`text-[11px] font-medium mt-0.5 ${
                            item.status === 'Verified'
                              ? 'text-emerald-700'
                              : item.status === 'Calculated'
                                ? 'text-[#2563EB]'
                                : 'text-amber-700'
                          }`}
                        >
                          {item.status}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="px-5 py-3 bg-[#F8FAFC] border-t border-[#E2E8F0] flex items-center justify-between gap-3 text-xs">
                  <span className="text-[#64748B]">
                    Savings &amp; FD interest kept separate (Section 80TTA accurate)
                  </span>
                  <span className="font-semibold text-[#2563EB]">
                    You approve every edit
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works — 3 Consumer Steps */}
        <section className="border-t border-[#E2E8F0] bg-[#F8FAFC]/70 py-14">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-8">
            <div className="max-w-2xl space-y-2">
              <h2 className="text-xl font-bold text-[#172B4D]">
                Simple, three-step tax filing without technical clutter
              </h2>
              <p className="text-xs sm:text-sm text-[#64748B]">
                Only the numbers and choices you need on screen — with a helpful Tax Support assistant and full security audit drawer ready whenever you want details.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {[
                {
                  step: '01',
                  Icon: Upload,
                  title: 'Upload Documents',
                  desc: 'Drop Form 16, bank statements, FD certificates, or investment proofs in one place.',
                },
                {
                  step: '02',
                  Icon: Scale,
                  title: 'Review Numbers & Tax',
                  desc: 'Edit figures inline, toggle eligible deductions, resolve any flagged items, and compare Old vs New regimes.',
                },
                {
                  step: '03',
                  Icon: ShieldCheck,
                  title: 'Approve & Submit',
                  desc: 'Confirm accuracy, grant approval, and download your finalized ITR-1 JSON draft and filing receipt.',
                },
              ].map((card) => (
                <div
                  key={card.step}
                  className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-8 h-8 rounded-lg bg-blue-50/90 border border-blue-200 text-[#2563EB] flex items-center justify-center">
                      <card.Icon className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-mono font-semibold text-[#64748B]">
                      Step {card.step}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-[#172B4D]">
                    {card.title}
                  </h3>
                  <p className="text-xs text-[#64748B] leading-relaxed">
                    {card.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Clean Footer */}
      <footer className="border-t border-[#E2E8F0] bg-white py-6">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-[#64748B]">
          <div>
            TaxShield · Local ITR-1 (Sahaj) Draft Preparation for AY 2026-27 (Drafts are not submitted to the Income Tax Portal)
          </div>
          <button
            type="button"
            onClick={onExploreArchitecture}
            className="text-left sm:text-right font-medium text-[#2563EB] hover:underline cursor-pointer"
          >
            Open Activity &amp; Security
          </button>
        </div>
      </footer>
    </div>
  );
};
