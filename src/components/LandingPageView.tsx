import React, { useState } from 'react';
import {
  ArrowRight,
  Bot,
  Calculator,
  CheckCircle2,
  Database,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Lock,
  Network,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  User,
  Wrench,
} from 'lucide-react';
import { WorkspaceSnapshot } from '../shared/types';
import { formatINR } from '../utils/format';
import {
  Button,
  LightCodeBlock,
  SegmentedControl,
  StatusIndicator,
} from './DesignSystem';

interface LandingPageViewProps {
  snapshot: WorkspaceSnapshot;
  onEnterWorkspace: () => void;
  onStartDemo: () => Promise<void>;
  onExploreArchitecture: () => void;
}

const SAMPLE_ITR_PREVIEW = `{
  "ITR": {
    "ITR1": {
      "Form_ITR1": {
        "FormName": "ITR-1",
        "AssessmentYear": "2026"
      },
      "FilingStatus": {
        "NewTaxRegime": "Y",
        "SubmissionStatus": "LOCAL_DRAFT_NOT_FILED"
      },
      "ITR1_IncomeDeductions": {
        "IncomeFromSal": 1125000,
        "IncomeOthSrc": 25000,
        "TotalIncome": 1150000
      },
      "Refund": {
        "RefundDue": 60000
      }
    }
  }
}`;

export const LandingPageView: React.FC<LandingPageViewProps> = ({
  snapshot,
  onEnterWorkspace,
  onStartDemo,
  onExploreArchitecture,
}) => {
  const [startingDemo, setStartingDemo] = useState(false);
  const [previewTab, setPreviewTab] = useState<
    'pipeline' | 'regimes' | 'approval' | 'draft'
  >('pipeline');

  const handleLaunchDemo = async () => {
    setStartingDemo(true);
    try {
      await onStartDemo();
    } finally {
      setStartingDemo(false);
    }
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div id="home" className="min-h-screen bg-white text-[#172B4D]">
      {/* Pure White Top Navigation Bar */}
      <header className="sticky top-0 z-40 h-16 bg-white border-b border-[#E2E8F0] px-6 lg:px-10 flex items-center justify-between gap-8">
        <a
          href="#home"
          onClick={(e) => {
            e.preventDefault();
            scrollToSection('home');
          }}
          className="text-lg font-bold tracking-tight text-[#172B4D] whitespace-nowrap shrink-0"
        >
          TaxShield MCP
        </a>

        <nav
          aria-label="Landing page sections"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-[#64748B]"
        >
          <a
            href="#how-it-works"
            onClick={(e) => {
              e.preventDefault();
              scrollToSection('how-it-works');
            }}
            className="hover:text-[#172B4D] transition-colors whitespace-nowrap shrink-0"
          >
            How It Works
          </a>
          <a
            href="#features"
            onClick={(e) => {
              e.preventDefault();
              scrollToSection('features');
            }}
            className="hover:text-[#172B4D] transition-colors whitespace-nowrap shrink-0"
          >
            Core Features
          </a>
          <a
            href="#architecture"
            onClick={(e) => {
              e.preventDefault();
              scrollToSection('architecture');
            }}
            className="hover:text-[#172B4D] transition-colors whitespace-nowrap shrink-0"
          >
            Architecture
          </a>
          <a
            href="#security"
            onClick={(e) => {
              e.preventDefault();
              scrollToSection('security');
            }}
            className="hover:text-[#172B4D] transition-colors whitespace-nowrap shrink-0"
          >
            Security
          </a>
          <a
            href="#demo"
            onClick={(e) => {
              e.preventDefault();
              scrollToSection('demo');
            }}
            className="hover:text-[#172B4D] transition-colors whitespace-nowrap shrink-0"
          >
            Interactive Demo
          </a>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <Button variant="primary" size="md" onClick={onEnterWorkspace}>
            Start Filing
          </Button>
        </div>
      </header>

      {/* 1. HERO SECTION */}
      <section className="bg-white max-w-[1280px] mx-auto px-6 lg:px-10 pt-14 pb-20 lg:pt-20 lg:pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left Column: Product Copy & CTAs */}
          <div className="lg:col-span-6 space-y-6">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#2563EB]">
              <span>Assessment Year 2026-27 (FY 2025-26)</span>
              <span aria-hidden="true" className="text-[#CBD5E1]">
                ·
              </span>
              <span className="text-[#0D9488]">22 Controlled MCP Tools</span>
              <span aria-hidden="true" className="text-[#CBD5E1]">
                ·
              </span>
              <span className="text-[#64748B]">ITR-1 (Sahaj) Local Drafts</span>
            </div>

            <h1
              className="font-bold tracking-tight text-[#172B4D] leading-[1.12]"
              style={{
                fontSize: 'clamp(2.25rem, 3.8vw, 3.35rem)',
                textWrap: 'balance',
              }}
            >
              Intelligent Tax Filing. Transparent AI. Complete Control.
            </h1>

            <p className="text-base text-[#64748B] leading-relaxed max-w-xl">
              TaxShield MCP transforms financial documents into a validated income tax return draft through autonomous AI orchestration, secure MCP tools, deterministic tax computation, and human-controlled approvals.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button
                variant="primary"
                size="lg"
                onClick={onEnterWorkspace}
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                Start Filing
              </Button>

              <Button
                variant="outline"
                size="lg"
                loading={startingDemo}
                onClick={handleLaunchDemo}
              >
                Launch Interactive Demo
              </Button>

              <Button
                variant="secondary"
                size="lg"
                onClick={() => scrollToSection('architecture')}
              >
                Explore Architecture
              </Button>
            </div>

            <div className="pt-6 border-t border-[#E2E8F0] grid grid-cols-3 gap-6 text-xs">
              <div>
                <div className="text-base font-bold text-[#172B4D] font-mono tabular-nums">
                  100% Rule-Based
                </div>
                <div className="text-[#64748B] mt-1 leading-relaxed">
                  Deterministic YAML engine for Section 115BAC &amp; Old Regime
                </div>
              </div>
              <div>
                <div className="text-base font-bold text-[#172B4D] font-mono tabular-nums">
                  Zero Auto-Writes
                </div>
                <div className="text-[#64748B] mt-1 leading-relaxed">
                  Every financial mutation requires explicit human approval
                </div>
              </div>
              <div>
                <div className="text-base font-bold text-[#172B4D] font-mono tabular-nums">
                  SHA-256 Chained
                </div>
                <div className="text-[#64748B] mt-1 leading-relaxed">
                  PII-redacted audit ledger across all 22 MCP tools
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Clean Interactive Product Preview Card */}
          <div className="lg:col-span-6">
            <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden shadow-[0_6px_24px_rgba(23,43,77,0.06)]">
              <div className="px-5 py-4 border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3 bg-[#F8FAFC]">
                <div>
                  <div className="text-xs font-semibold text-[#172B4D]">
                    Interactive Product &amp; Governance Preview
                  </div>
                  <div className="text-[11px] text-[#64748B] font-mono tabular-nums mt-0.5">
                    AY 2026-27 · Rules v{snapshot.ruleVerification.rulesVersion} · {snapshot.documents.length} Active Session Docs
                  </div>
                </div>

                <SegmentedControl
                  ariaLabel="Product preview tabs"
                  value={previewTab}
                  onChange={setPreviewTab}
                  options={[
                    { value: 'pipeline', label: 'Documents' },
                    { value: 'regimes', label: 'Tax Math' },
                    { value: 'approval', label: 'Approval' },
                    { value: 'draft', label: 'ITR-1 JSON' },
                  ]}
                />
              </div>

              <div className="p-6 bg-white">
                {previewTab === 'pipeline' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-xs text-[#64748B]">
                      <span>Salaried Taxpayer Document Vault</span>
                      <span className="font-mono tabular-nums text-[#2563EB] font-medium">
                        Page-cited extraction
                      </span>
                    </div>

                    <div className="divide-y divide-[#E2E8F0] border border-[#E2E8F0] rounded-lg text-xs">
                      <div className="p-3.5 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-[#172B4D]">
                            Form 16 (Part A &amp; B)
                          </div>
                          <div className="text-[#64748B] font-mono tabular-nums text-[11px] mt-0.5">
                            Gross Salary ₹12,00,000 · TDS Deducted ₹60,000 · Page 1
                          </div>
                        </div>
                        <StatusIndicator tone="success" label="Verified · 99%" mono />
                      </div>

                      <div className="p-3.5 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-[#172B4D]">
                            Savings Bank Statement
                          </div>
                          <div className="text-[#64748B] font-mono tabular-nums text-[11px] mt-0.5">
                            Savings Interest ₹10,000 (Eligible u/s 80TTA in Old Regime)
                          </div>
                        </div>
                        <StatusIndicator tone="warning" label="Variance +₹10,000" mono />
                      </div>

                      <div className="p-3.5 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-[#172B4D]">
                            Fixed Deposit Interest Certificate
                          </div>
                          <div className="text-[#64748B] font-mono tabular-nums text-[11px] mt-0.5">
                            FD Interest ₹15,000 (Taxable Schedule OS · Non-80TTA)
                          </div>
                        </div>
                        <StatusIndicator tone="warning" label="Variance +₹15,000" mono />
                      </div>

                      <div className="p-3.5 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-[#172B4D]">
                            Section 80C Investment Proof
                          </div>
                          <div className="text-[#64748B] font-mono tabular-nums text-[11px] mt-0.5">
                            PPF + ELSS Receipts ₹1,00,000 (Not in Form 16 Part B)
                          </div>
                        </div>
                        <StatusIndicator tone="info" label="Proof +₹1,00,000" mono />
                      </div>
                    </div>
                  </div>
                )}

                {previewTab === 'regimes' && (
                  <div className="space-y-4 text-xs">
                    <div className="flex items-center justify-between text-[#64748B]">
                      <span>Deterministic YAML Computation (Zero LLM Arithmetic)</span>
                      <span className="font-mono tabular-nums text-emerald-700 font-semibold">
                        New Regime Saves {formatINR(137_280)}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-4 rounded-lg border-2 border-[#2563EB] bg-blue-50/40 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#172B4D]">
                            New Regime (115BAC)
                          </span>
                          <span className="text-[11px] font-semibold text-[#2563EB]">
                            Recommended
                          </span>
                        </div>
                        <div className="space-y-1.5 font-mono tabular-nums text-[11px] text-[#64748B] pt-1">
                          <div className="flex justify-between">
                            <span>Net Salary (after ₹75k)</span>
                            <span className="text-[#172B4D]">₹11,25,000</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Savings + FD Interest</span>
                            <span className="text-[#172B4D]">₹25,000</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Taxable Income</span>
                            <span className="text-[#172B4D]">₹11,50,000</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Slab Tax − 87A Rebate</span>
                            <span className="text-emerald-700">₹55,000 − ₹55,000</span>
                          </div>
                          <div className="flex justify-between font-semibold text-xs text-[#172B4D] pt-2 border-t border-blue-200">
                            <span>Net Refund Due</span>
                            <span className="text-emerald-700">₹60,000</span>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#172B4D]">Old Regime</span>
                          <span className="text-[11px] text-[#64748B]">Comparison</span>
                        </div>
                        <div className="space-y-1.5 font-mono tabular-nums text-[11px] text-[#64748B] pt-1">
                          <div className="flex justify-between">
                            <span>Net Salary (after ₹50k)</span>
                            <span className="text-[#172B4D]">₹11,50,000</span>
                          </div>
                          <div className="flex justify-between">
                            <span>80C (₹1L) + 80TTA (₹10k)</span>
                            <span className="text-[#172B4D]">−₹1,10,000</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Taxable Income</span>
                            <span className="text-[#172B4D]">₹10,65,000</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Tax + 4% Cess</span>
                            <span className="text-[#172B4D]">₹1,37,280</span>
                          </div>
                          <div className="flex justify-between font-semibold text-xs text-[#172B4D] pt-2 border-t border-[#E2E8F0]">
                            <span>Balance Tax Payable</span>
                            <span className="text-rose-700">₹77,280</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {previewTab === 'approval' && (
                  <div className="space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#172B4D]">
                        SecurityGateway Human-in-the-Loop Gate
                      </span>
                      <StatusIndicator
                        tone="warning"
                        label="WAITING_FOR_HUMAN_APPROVAL"
                        mono
                      />
                    </div>
                    <p className="text-[#64748B] leading-relaxed">
                      Sensitive MCP operations (<span className="font-mono text-[#172B4D]">update_return_information</span>,{' '}
                      <span className="font-mono text-[#172B4D]">generate_return_draft</span>) pause with exact before/after field diffs and deterministic tax impact before mutating SQLite return state.
                    </p>
                    <div className="border border-[#E2E8F0] rounded-lg divide-y divide-[#E2E8F0] font-mono tabular-nums text-[11px] bg-[#F8FAFC]">
                      <div className="px-3.5 py-2.5 flex justify-between">
                        <span className="font-sans text-[#172B4D]">Savings Bank Interest</span>
                        <span>
                          <span className="text-[#64748B] line-through mr-2">₹0</span>
                          <span className="text-[#2563EB] font-semibold">₹10,000</span>
                        </span>
                      </div>
                      <div className="px-3.5 py-2.5 flex justify-between">
                        <span className="font-sans text-[#172B4D]">Fixed Deposit Interest</span>
                        <span>
                          <span className="text-[#64748B] line-through mr-2">₹0</span>
                          <span className="text-[#2563EB] font-semibold">₹15,000</span>
                        </span>
                      </div>
                      <div className="px-3.5 py-2.5 flex justify-between">
                        <span className="font-sans text-[#172B4D]">Section 80C Investments</span>
                        <span>
                          <span className="text-[#64748B] line-through mr-2">₹0</span>
                          <span className="text-[#2563EB] font-semibold">₹1,00,000</span>
                        </span>
                      </div>
                    </div>
                    <div className="text-[11px] text-[#64748B]">
                      Approving executes the staged mutation once and automatically resumes the AI orchestrator to validate and prepare the ITR-1 draft.
                    </div>
                  </div>
                )}

                {previewTab === 'draft' && (
                  <div className="space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#172B4D]">
                        Validated ITR-1 (Sahaj) Local JSON Export
                      </span>
                      <StatusIndicator
                        tone="success"
                        label="LOCAL_DRAFT_NOT_FILED"
                        mono
                      />
                    </div>
                    <LightCodeBlock
                      title="ITR1_AY2026_27_Draft.json"
                      code={SAMPLE_ITR_PREVIEW}
                      maxHeightClass="max-h-56"
                    />
                  </div>
                )}

                <div className="mt-5 pt-4 border-t border-[#E2E8F0] flex items-center justify-between text-xs">
                  <span className="text-[#64748B]">
                    Isolated synthetic sandbox · Resettable anytime
                  </span>
                  <button
                    type="button"
                    onClick={handleLaunchDemo}
                    className="font-semibold text-[#2563EB] hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    Run Full Interactive Flow
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. HOW IT WORKS SECTION */}
      <section
        id="how-it-works"
        className="bg-[#F8FAFC] border-y border-[#E2E8F0] py-20"
      >
        <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-wider text-[#2563EB]">
              Autonomous Filing Workflow
            </div>
            <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-[#172B4D] mt-1">
              Five transparent stages from financial PDFs to a validated ITR-1 draft
            </h2>
            <p className="text-sm text-[#64748B] mt-2 leading-relaxed">
              The AI orchestrator plans tool calls dynamically while keeping deterministic tax computation and sensitive state mutations strictly separated from the language model.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-5 mt-12">
            {[
              {
                step: '01',
                title: 'Upload Documents',
                desc: 'Attach Form 16, salary slips, bank statements, FD certificates, Form 26AS, AIS/TIS, or 80C/80D receipts in PDF, image, or text format.',
              },
              {
                step: '02',
                title: 'Extract & Reconcile',
                desc: 'PDF parsing and Tesseract OCR capture structured values with page references, confidence scores, and cross-document variance checks.',
              },
              {
                step: '03',
                title: 'Clarify Variances',
                desc: 'When bank interest or investment proofs differ from Form 16, the assistant presents structured options rather than guessing.',
              },
              {
                step: '04',
                title: 'Approve Updates',
                desc: 'SecurityGateway holds every income addition, deduction claim, and draft lock with exact field diffs until you approve or reject.',
              },
              {
                step: '05',
                title: 'Export Validated Draft',
                desc: 'Compare Old vs. New regime results, inspect Sections A–G of ITR-1, and download a validated local JSON return draft.',
              },
            ].map((item) => (
              <div
                key={item.step}
                className="p-5 rounded-xl bg-white border border-[#E2E8F0] shadow-[0_1px_2px_rgba(23,43,77,0.03)] flex flex-col justify-between"
              >
                <div>
                  <div className="font-mono text-xs font-semibold text-[#2563EB]">
                    Step {item.step}
                  </div>
                  <h3 className="text-sm font-semibold text-[#172B4D] mt-1.5">
                    {item.title}
                  </h3>
                  <p className="text-xs text-[#64748B] mt-2 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. CORE FEATURES SECTION (Asymmetric Bento Grid) */}
      <section id="features" className="bg-white max-w-[1280px] mx-auto px-6 lg:px-10 py-20">
        <div className="max-w-2xl">
          <div className="text-xs font-semibold uppercase tracking-wider text-[#2563EB]">
            Platform Capabilities
          </div>
          <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-[#172B4D] mt-1">
            Engineered for statutory precision and verifiable AI governance
          </h2>
          <p className="text-sm text-[#64748B] mt-2 leading-relaxed">
            Every module in TaxShield MCP enforces strict boundaries between natural-language reasoning, controlled MCP tool execution, and Indian income tax computation.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 mt-12">
          <div className="md:col-span-7 bg-white border border-[#E2E8F0] rounded-xl p-6 shadow-[0_1px_2px_rgba(23,43,77,0.03)]">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-base font-semibold text-[#172B4D]">
                Autonomous AI Tax Assistant with Explicit 8-State Machine
              </h3>
              <SlidersHorizontal className="w-4 h-4 text-[#2563EB] shrink-0" />
            </div>
            <p className="text-xs text-[#64748B] mt-2.5 leading-relaxed">
              Communicate in plain English — ask the assistant to prepare your return, explain discrepancies, or add missing deductions. The orchestrator transitions cleanly across planning, read-only MCP inspection, taxpayer clarification, SecurityGateway approval pauses, and automatic post-approval continuation.
            </p>
          </div>

          <div className="md:col-span-5 bg-white border border-[#E2E8F0] rounded-xl p-6 shadow-[0_1px_2px_rgba(23,43,77,0.03)]">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-base font-semibold text-[#172B4D]">
                Document Vault &amp; OCR Confidence Gate
              </h3>
              <FileText className="w-4 h-4 text-[#2563EB] shrink-0" />
            </div>
            <p className="text-xs text-[#64748B] mt-2.5 leading-relaxed">
              Parses multi-page PDFs with <span className="font-mono text-[#172B4D]">unpdf</span> and scanned receipts with <span className="font-mono text-[#172B4D]">Tesseract.js</span>. Low-confidence OCR items are flagged for review rather than overwriting verified return numbers.
            </p>
          </div>

          <div className="md:col-span-4 bg-white border border-[#E2E8F0] rounded-xl p-6 shadow-[0_1px_2px_rgba(23,43,77,0.03)]">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-base font-semibold text-[#172B4D]">
                Cross-Document Reconciliation
              </h3>
              <Scale className="w-4 h-4 text-[#0D9488] shrink-0" />
            </div>
            <p className="text-xs text-[#64748B] mt-2.5 leading-relaxed">
              Compares Form 16 vs. salary slips, Form 16 TDS vs. Form 26AS, savings interest vs. FD interest, and 80C/80D receipts while deduplicating overlapping AIS entries.
            </p>
          </div>

          <div className="md:col-span-4 bg-white border border-[#E2E8F0] rounded-xl p-6 shadow-[0_1px_2px_rgba(23,43,77,0.03)]">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-base font-semibold text-[#172B4D]">
                Old vs. New Regime Engine
              </h3>
              <FileSpreadsheet className="w-4 h-4 text-[#2563EB] shrink-0" />
            </div>
            <p className="text-xs text-[#64748B] mt-2.5 leading-relaxed">
              Computes AY 2026-27 tax strictly from <span className="font-mono text-[#172B4D]">rules/AY2026-27.yaml</span>, including ₹75,000 standard deduction, Section 87A ₹12L rebate, marginal relief, and u/s 288A/288B rounding.
            </p>
          </div>

          <div className="md:col-span-4 bg-white border border-[#E2E8F0] rounded-xl p-6 shadow-[0_1px_2px_rgba(23,43,77,0.03)]">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-base font-semibold text-[#172B4D]">
                Live ITR-1 Form Preview
              </h3>
              <CheckCircle2 className="w-4 h-4 text-[#0D9488] shrink-0" />
            </div>
            <p className="text-xs text-[#64748B] mt-2.5 leading-relaxed">
              Auto-populates Sections A–G of ITR-1 (Sahaj) over real-time Server-Sent Events with expandable per-field provenance and mandatory schedule validation.
            </p>
          </div>
        </div>
      </section>

      {/* 4. AGENTIC AI ARCHITECTURE SECTION */}
      <section
        id="architecture"
        className="bg-[#F8FAFC] border-y border-[#E2E8F0] py-20"
      >
        <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div className="max-w-2xl">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#2563EB]">
                Agentic AI Architecture
              </div>
              <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-[#172B4D] mt-1">
                11-layer controlled Model Context Protocol pipeline
              </h2>
              <p className="text-sm text-[#64748B] mt-2 leading-relaxed">
                Every user instruction travels through a deterministic security and audit boundary — ensuring the language model never directly accesses SQLite or fabricates tax math.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={onExploreArchitecture}
              rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
            >
              Inspect Live Architecture View
            </Button>
          </div>

          <div className="mt-10 bg-white border border-[#E2E8F0] rounded-xl p-6 lg:p-8 shadow-[0_1px_2px_rgba(23,43,77,0.04)]">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  step: '01–03',
                  title: 'User → Frontend → Orchestrator',
                  desc: 'React workspace streams SSE state while the 8-state orchestrator plans turns and handles clarifications.',
                  Icon: User,
                },
                {
                  step: '04–06',
                  title: 'LLM → MCP Client → SecurityGateway',
                  desc: 'PII-masked prompts plan JSON-RPC calls; SecurityGateway enforces schemas, ACLs, and human approvals.',
                  Icon: ShieldCheck,
                },
                {
                  step: '07–09',
                  title: '22 MCP Tools → Ledger → Tax Engine',
                  desc: 'Controlled tools update the 3-tier provenance ledger and run deterministic AY 2026-27 YAML calculations.',
                  Icon: Calculator,
                },
                {
                  step: '10–11',
                  title: 'ITR-1 Draft → Validation & Audit',
                  desc: 'Generates versioned ITR-1 JSON drafts verified against statutory rules and SHA-256 hash-chained audit logs.',
                  Icon: FileCheck2,
                },
              ].map(({ step, title, desc, Icon }) => (
                <div
                  key={step}
                  className="p-5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-[#2563EB]">
                      Layers {step}
                    </span>
                    <Icon className="w-4 h-4 text-[#0D9488]" />
                  </div>
                  <h3 className="text-sm font-semibold text-[#172B4D]">{title}</h3>
                  <p className="text-xs text-[#64748B] leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-5 border-t border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-[#64748B]">
              <div className="flex flex-wrap items-center gap-2">
                <Bot className="w-4 h-4 text-[#2563EB]" />
                <span>
                  User → Frontend → AI Orchestrator → LLM → MCP Client → SecurityGateway → MCP Tools → Financial Ledger → Tax Engine → ITR Draft → Validation
                </span>
              </div>
              <span className="text-[#0D9488] font-semibold">22 Registered Tools</span>
            </div>
          </div>
        </div>
      </section>

      {/* 5. SECURITY AND HUMAN APPROVAL SECTION (Pure White / Light Surface — Zero Dark Mode) */}
      <section id="security" className="bg-white py-20">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
            <div className="lg:col-span-5 space-y-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#2563EB]">
                Security &amp; Human Control
              </div>
              <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-[#172B4D]">
                Why sensitive tax workflows belong behind an MCP SecurityGateway
              </h2>
              <p className="text-sm text-[#64748B] leading-relaxed">
                Language models excel at interpreting messy documents and conversing naturally, but should never be trusted to invent tax numbers or silently mutate financial records.
              </p>

              <div className="p-5 rounded-xl bg-blue-50/60 border border-blue-200 text-xs text-[#172B4D] leading-relaxed space-y-1.5">
                <div className="flex items-center gap-2 font-semibold text-[#2563EB]">
                  <Lock className="w-4 h-4 shrink-0" />
                  <span>Mandatory Human-in-the-Loop Authorization</span>
                </div>
                <p className="text-[#64748B]">
                  Every write operation (<span className="font-mono text-[#172B4D]">add_income_information</span>,{' '}
                  <span className="font-mono text-[#172B4D]">add_deduction_information</span>,{' '}
                  <span className="font-mono text-[#172B4D]">update_return_information</span>,{' '}
                  <span className="font-mono text-[#172B4D]">generate_return_draft</span>) is staged with an idempotency key until you click Approve, Reject, or Cancel.
                </p>
              </div>
            </div>

            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="p-5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#172B4D]">
                    1. Controlled MCP Protocol Boundary
                  </h3>
                  <Network className="w-4 h-4 text-[#2563EB]" />
                </div>
                <p className="text-xs text-[#64748B] mt-2 leading-relaxed">
                  The AI agent has zero direct SQLite or filesystem access. Every action passes through an in-memory MCP transport mediated by SecurityGateway.
                </p>
              </div>

              <div className="p-5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#172B4D]">
                    2. Deterministic Statutory Engine
                  </h3>
                  <Wrench className="w-4 h-4 text-[#0D9488]" />
                </div>
                <p className="text-xs text-[#64748B] mt-2 leading-relaxed">
                  All tax liabilities, rebates, marginal relief, and cess amounts are calculated in TypeScript from <span className="font-mono text-[#172B4D]">rules/AY2026-27.yaml</span> — never estimated by LLM prose.
                </p>
              </div>

              <div className="p-5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#172B4D]">
                    3. Tamper-Evident Redacted Audit Chain
                  </h3>
                  <Database className="w-4 h-4 text-[#2563EB]" />
                </div>
                <p className="text-xs text-[#64748B] mt-2 leading-relaxed">
                  Every tool call records a SHA-256 hash linked to the preceding log entry while scrubbing raw PAN, TAN, bank account, email, and phone strings from UI payloads.
                </p>
              </div>

              <div className="p-5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#172B4D]">
                    4. Unsupported Scope Safeguards
                  </h3>
                  <ShieldCheck className="w-4 h-4 text-[#0D9488]" />
                </div>
                <p className="text-xs text-[#64748B] mt-2 leading-relaxed">
                  Automatically halts ITR-1 preparation when capital gains, VDA/crypto, foreign assets, business income, multiple employers, or income above ₹50,00,000 are detected.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. INTERACTIVE DEMO SECTION */}
      <section
        id="demo"
        className="bg-[#F8FAFC] border-t border-[#E2E8F0] py-20"
      >
        <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-8 lg:p-12 shadow-[0_2px_12px_rgba(23,43,77,0.04)] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
            <div className="max-w-2xl space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#0D9488]">
                Isolated Synthetic Taxpayer Sandbox · Resettable Anytime
              </div>
              <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-[#172B4D]">
                Test the complete autonomous filing journey
              </h2>
              <p className="text-sm text-[#64748B] leading-relaxed">
                Launch an isolated AY 2026-27 demo session preloaded with 4 synthetic documents: Form 16 (₹12,00,000 salary &amp; ₹60,000 TDS), Savings Bank Statement (₹10,000 interest), Fixed Deposit Certificate (₹15,000 interest), and Section 80C Proof (₹1,00,000). Experience autonomous reconciliation, human approval continuation, and ITR-1 JSON export end to end.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <Button
                variant="primary"
                size="lg"
                loading={startingDemo}
                onClick={handleLaunchDemo}
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                Launch Interactive Demo
              </Button>
              <Button variant="outline" size="lg" onClick={onEnterWorkspace}>
                Start Filing
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* 7. DISCLAIMER AND FOOTER */}
      <footer id="disclaimer" className="border-t border-[#E2E8F0] bg-white py-12">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-10 space-y-6">
          <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#64748B] leading-relaxed">
            <span className="font-semibold text-[#172B4D]">
              Important Regulatory &amp; Non-Submission Disclaimer:{' '}
            </span>
            TaxShield MCP is an autonomous AI income tax preparation and verification assistant that generates local, validated ITR-1 (Sahaj) JSON drafts strictly for personal review and academic demonstration. It is not affiliated with and does not transmit or submit returns directly to the official Income Tax Department e-Filing portal. Always verify final figures with a qualified Chartered Accountant or official e-Filing utility before filing.
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs text-[#64748B] pt-2">
            <div>
              <span className="font-bold text-[#172B4D]">TaxShield MCP</span> · Autonomous Agentic AI Income Tax Filing Assistant · AY 2026-27
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <button
                type="button"
                onClick={() => scrollToSection('how-it-works')}
                className="hover:text-[#172B4D] cursor-pointer"
              >
                How It Works
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('features')}
                className="hover:text-[#172B4D] cursor-pointer"
              >
                Core Features
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('architecture')}
                className="hover:text-[#172B4D] cursor-pointer"
              >
                Architecture
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('security')}
                className="hover:text-[#172B4D] cursor-pointer"
              >
                Security
              </button>
              <button
                type="button"
                onClick={onEnterWorkspace}
                className="font-semibold text-[#2563EB] hover:underline cursor-pointer"
              >
                Open Workspace
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
