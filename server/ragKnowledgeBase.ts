import { RagRuleCitation } from '../src/shared/types.js';
import { loadValidatedTaxRules } from './taxEngine.js';

function buildCorpusFromYaml(): Array<RagRuleCitation & { keywords: string[] }> {
  const rules = loadValidatedTaxRules();
  const ay = rules.meta.assessment_year;

  return [
    {
      id: 'rule-115bac-new-regime',
      section: `Section ${rules.tax_parameters.new_regime.section}`,
      title: `New Tax Regime Default Slabs & Rates (${ay} / ${rules.meta.financial_year})`,
      assessmentYear: ay,
      regimeApplicability: 'New Tax Regime (Default)',
      statutoryLimit: rules.tax_parameters.new_regime.slabs
        .map((s) =>
          s.upper_bound === null
            ? `>${(s.lower_bound / 100000).toFixed(0)}L: ${(s.rate * 100).toFixed(0)}%`
            : `${(s.lower_bound / 100000).toFixed(0)}–${(s.upper_bound / 100000).toFixed(0)}L: ${(s.rate * 100).toFixed(0)}%`
        )
        .join(' | '),
      documentRequirement: 'Form 16 Part A & B, AIS/TIS',
      summary: `Section 115BAC(1A) grants a ₹${rules.tax_parameters.new_regime.standard_deduction.amount.toLocaleString('en-IN')} Standard Deduction u/s 16(ia), employer NPS u/s 80CCD(2) up to ${rules.deductions.section_80CCD_2.max_percent_of_base.new_regime}% of basic salary, and Section 87A rebate up to ₹${rules.rebate_87A.new_regime.max_rebate.toLocaleString('en-IN')} up to ₹${rules.rebate_87A.new_regime.eligible_total_income_max.toLocaleString('en-IN')} taxable income (with marginal relief above ₹12L). Disallows 80C, 80CCD(1B), 80D, and 80TTA.`,
      officialSource: `${rules.meta.governing_act} — ${rules.tax_parameters.new_regime.slabs_source.section}`,
      officialUrl: rules.tax_parameters.new_regime.slabs_source.url,
      snapshotVerified: Boolean(rules.tax_parameters.new_regime.slabs_source.retrieval_hash),
      keywords: ['new regime', '115bac', 'slabs', 'slab', 'default', 'rates', 'old vs new', '2026-27'],
    },
    {
      id: 'rule-87a-rebate',
      section: 'Section 87A',
      title: 'Tax Rebate & Marginal Relief for Resident Individuals',
      assessmentYear: ay,
      regimeApplicability: 'Both Regimes (Different Statutory Caps)',
      statutoryLimit: `New Regime: Up to ₹${rules.rebate_87A.new_regime.max_rebate.toLocaleString('en-IN')} if taxable income ≤ ₹${rules.rebate_87A.new_regime.eligible_total_income_max.toLocaleString('en-IN')} + Marginal Relief | Old Regime: Up to ₹${rules.rebate_87A.old_regime.max_rebate.toLocaleString('en-IN')} if taxable income ≤ ₹${rules.rebate_87A.old_regime.eligible_total_income_max.toLocaleString('en-IN')}`,
      documentRequirement: 'Residential status verification (Resident Individual)',
      summary: `Under New Regime (${ay}), resident individuals with net taxable income ≤ ₹12,00,000 pay zero slab tax after the ₹60,000 rebate. Above ₹12,00,000, marginal relief applies via ${rules.rebate_87A.new_regime.marginal_relief.formula} so tax before cess never exceeds income above ₹12,00,000. Under Old Regime, rebate applies only up to ₹5,00,000 without marginal relief.`,
      officialSource: `${rules.meta.governing_act} — ${rules.rebate_87A.source.section}`,
      officialUrl: rules.rebate_87A.source.url,
      snapshotVerified: Boolean(rules.rebate_87A.source.retrieval_hash),
      keywords: ['87a', 'rebate', '12 lakh', '60000', '12500', 'refund', 'zero tax', 'marginal relief'],
    },
    {
      id: 'rule-16-standard-deduction',
      section: 'Section 16(ia)',
      title: 'Standard Deduction on Salary Income',
      assessmentYear: ay,
      regimeApplicability: 'Both Regimes (Capped at Gross Salary)',
      statutoryLimit: `₹${rules.tax_parameters.new_regime.standard_deduction.amount.toLocaleString('en-IN')} (New Regime) / ₹${rules.tax_parameters.old_regime.standard_deduction.amount.toLocaleString('en-IN')} (Old Regime), capped at salary`,
      documentRequirement: 'Form 16 Part B or Salary Slips',
      summary: `Salaried taxpayers receive min(salary, ₹${rules.tax_parameters.new_regime.standard_deduction.amount.toLocaleString('en-IN')}) in the New Regime and min(salary, ₹${rules.tax_parameters.old_regime.standard_deduction.amount.toLocaleString('en-IN')}) in the Old Regime.`,
      officialSource: `${rules.meta.governing_act} — ${rules.tax_parameters.new_regime.standard_deduction.source.section}`,
      officialUrl: rules.tax_parameters.new_regime.standard_deduction.source.url,
      snapshotVerified: Boolean(rules.tax_parameters.new_regime.standard_deduction.source.retrieval_hash),
      keywords: ['standard deduction', '75000', '50000', 'section 16', 'professional tax', 'salary'],
    },
    {
      id: 'rule-80c-80ccd-investments',
      section: 'Sections 80C, 80CCD(1), 80CCD(1B) & 80CCD(2)',
      title: 'Specified Tax-Saving Investments & NPS Contributions',
      assessmentYear: ay,
      regimeApplicability: '80C / 80CCD(1) / 80CCD(1B): Old Only | 80CCD(2): Both Regimes',
      statutoryLimit: `80C + 80CCD(1) aggregate cap ₹${rules.deductions.aggregate_cap_groups['80C_80CCC_80CCD1'].limit.toLocaleString('en-IN')} | 80CCD(1B) ₹${rules.deductions.section_80CCD_1B.max_amount.toLocaleString('en-IN')} | 80CCD(2) up to ${rules.deductions.section_80CCD_2.max_percent_of_base.new_regime}% New / 10%-14% Old`,
      documentRequirement: 'PPF/ELSS/EPF/LIC receipts, PRAN NPS statement, Form 16 Part B',
      summary: `Aggregate deduction u/s 80C + 80CCC + 80CCD(1) is capped at ₹1,50,000 (Old Regime only, with 80CCD(1) ≤ 10% of salary). Additional ₹50,000 employee NPS u/s 80CCD(1B) applies in Old Regime. Employer NPS u/s 80CCD(2) is deductible in both regimes (up to 14% of basic+DA in New Regime; 10% non-govt / 14% govt in Old Regime).`,
      officialSource: `${rules.meta.governing_act} — ${rules.deductions.section_80C.source.section} & ${rules.deductions.section_80CCD_2.source.section}`,
      officialUrl: rules.deductions.section_80CCD_2.source.url,
      snapshotVerified: Boolean(rules.deductions.section_80C.source.retrieval_hash),
      keywords: ['80c', '80ccd', 'nps', '150000', '50000', 'ppf', 'epf', 'elss', 'lic', 'investment', 'proof'],
    },
    {
      id: 'rule-80d-medical',
      section: 'Section 80D',
      title: 'Health Insurance Premium & Preventive Check-up Deduction',
      assessmentYear: ay,
      regimeApplicability: 'Old Tax Regime Only',
      statutoryLimit: `₹${rules.deductions.section_80D.self_spouse_children.limit_below_60.toLocaleString('en-IN')} (self/spouse/children <60) + ₹${rules.deductions.section_80D.parents.limit_below_60.toLocaleString('en-IN')} parents (<60) or ₹${rules.deductions.section_80D.parents.limit_if_any_person_senior.toLocaleString('en-IN')} senior parents`,
      documentRequirement: 'Insurer 80D tax certificate & non-cash payment proof',
      summary: `Non-cash medical insurance premiums u/s 80D are allowed under the Old Regime. Preventive health check-up up to ₹${rules.deductions.section_80D.preventive_health_checkup.max_amount.toLocaleString('en-IN')} is included within (not additional to) the overall limit.`,
      officialSource: `${rules.meta.governing_act} — ${rules.deductions.section_80D.source.section}`,
      officialUrl: rules.deductions.section_80D.source.url,
      snapshotVerified: Boolean(rules.deductions.section_80D.source.retrieval_hash),
      keywords: ['80d', 'health insurance', 'medical', 'mediclaim', 'parents', '25000', '50000'],
    },
    {
      id: 'rule-80tta-interest',
      section: 'Section 56(2) & Section 80TTA',
      title: 'Separate Savings vs Fixed Deposit Interest & Section 80TTA',
      assessmentYear: ay,
      regimeApplicability: 'Taxable in Both Regimes | 80TTA Deduction: Old Regime Only (Savings Only)',
      statutoryLimit: `Up to ₹${rules.deductions.section_80TTA.max_amount.toLocaleString('en-IN')} u/s 80TTA strictly on Savings Bank Interest (Old Regime); ₹0 on Fixed Deposit Interest`,
      documentRequirement: 'Bank Statement, FD Interest Certificate, AIS/TIS',
      summary: `Savings bank interest and Fixed Deposit (FD) interest are both taxable under Income from Other Sources in both regimes and must NEVER be merged into a single field. Under Old Regime, Section 80TTA grants up to ₹10,000 deduction strictly on savings bank interest — FD interest is excluded from 80TTA.`,
      officialSource: `${rules.meta.governing_act} — ${rules.deductions.section_80TTA.source.section}`,
      officialUrl: rules.deductions.section_80TTA.source.url,
      snapshotVerified: Boolean(rules.deductions.section_80TTA.source.retrieval_hash),
      keywords: ['bank interest', 'savings interest', 'fd interest', 'fixed deposit', '80tta', '10000', 'other sources'],
    },
    {
      id: 'rule-288a-288b-rounding',
      section: 'Sections 288A & 288B',
      title: 'Statutory Rounding of Total Income & Net Payable/Refund',
      assessmentYear: ay,
      regimeApplicability: 'Mandatory Across Both Regimes',
      statutoryLimit: 'Nearest ₹10 via drop_paise_then_half_up',
      documentRequirement: 'Deterministic tax computation schedule',
      summary: `Total income u/s 288A and final net tax payable or refund u/s 288B are rounded to the nearest multiple of ₹10 by first ignoring paise and then rounding ≥5 up to the next ₹10 and <5 down.`,
      officialSource: `${rules.meta.governing_act} — Sections 288A & 288B`,
      officialUrl: rules.rounding.total_income.source.url,
      snapshotVerified: Boolean(rules.rounding.total_income.source.retrieval_hash),
      keywords: ['288a', '288b', 'rounding', 'nearest 10', 'cess', 'tds', 'advance tax'],
    },
    {
      id: 'rule-itr1-scope-exclusions',
      section: 'ITR-1 (Sahaj) Scope & Exclusions',
      title: 'Supported Salaried Resident Scope vs Unsupported Scenarios',
      assessmentYear: ay,
      regimeApplicability: 'Resident Individual (<60 yrs, 1 Employer, Income ≤ ₹50,00,000)',
      statutoryLimit: `Maximum Total Income ₹${rules.validation.itr1_income_limit.maximum_total_income.toLocaleString('en-IN')}`,
      documentRequirement: 'PAN, Aadhaar linkage, Pre-validated Bank IFSC & Account',
      summary: `Supported scope covers Resident salaried individuals (<60 years, single employer) with salary, savings bank interest, and fixed deposit interest up to ₹50,00,000. Unsupported items that safely halt ITR-1 draft generation: ${rules.scope.unsupported.join(', ')}.`,
      officialSource: `${rules.validation.itr1_income_limit.source.authority} — ${rules.validation.itr1_income_limit.source.section}`,
      officialUrl: rules.validation.itr1_income_limit.source.url,
      snapshotVerified: Boolean(rules.validation.itr1_income_limit.source.retrieval_hash),
      keywords: ['itr-1', 'sahaj', 'eligibility', 'unsupported', 'crypto', 'capital gains', 'house property', 'business', 'employer', '50 lakh'],
    },
  ];
}

export const TAX_KNOWLEDGE_CORPUS = buildCorpusFromYaml();

export function retrieveTaxRules(query: string, topK = 4): RagRuleCitation[] {
  const normalized = query.toLowerCase();
  const tokens = normalized
    .replace(/[^a-z0-9()\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  const scored = TAX_KNOWLEDGE_CORPUS.map((doc) => {
    let score = 0;
    for (const kw of doc.keywords) {
      if (normalized.includes(kw)) score += 5;
    }
    const haystack =
      `${doc.section} ${doc.title} ${doc.summary} ${doc.statutoryLimit} ${doc.documentRequirement}`.toLowerCase();
    for (const token of tokens) {
      if (doc.section.toLowerCase().includes(token)) score += 4;
      if (doc.title.toLowerCase().includes(token)) score += 3;
      if (haystack.includes(token)) score += 1.5;
    }
    return { doc, score };
  });

  const sorted = scored.sort((a, b) => b.score - a.score);
  const top = sorted.filter((s) => s.score > 0).slice(0, topK);
  const selected = top.length > 0 ? top : sorted.slice(0, Math.min(3, topK));

  return selected.map(({ doc, score }) => ({
    id: doc.id,
    section: doc.section,
    title: doc.title,
    assessmentYear: doc.assessmentYear,
    regimeApplicability: doc.regimeApplicability,
    statutoryLimit: doc.statutoryLimit,
    documentRequirement: doc.documentRequirement,
    summary: doc.summary,
    officialSource: doc.officialSource,
    officialUrl: doc.officialUrl,
    snapshotVerified: doc.snapshotVerified,
    relevanceScore: Number(Math.min(0.99, 0.55 + score * 0.04).toFixed(2)),
  }));
}
