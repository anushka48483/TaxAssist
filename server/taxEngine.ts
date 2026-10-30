import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { z } from 'zod';
import {
  RegimeTaxComputation,
  ReturnFinancialInputs,
  RuleVerificationMetadata,
  RuleVerificationSourceEntry,
  SlabBreakdownRow,
  TaxComparisonSummary,
  TaxRegime,
  UnsupportedScenarioFlag,
  UploadedDocument,
  UserProfile,
  ValidationIssue,
  ValidationResult,
} from '../src/shared/types.js';

const SourceSchema = z.object({
  authority: z.string(),
  url: z.string().url(),
  section: z.string(),
  document_version: z.string().optional(),
  corroboration: z.string().optional(),
  note: z.string().optional(),
  retrieval_hash: z.string().nullable(),
  snapshot_path: z.string().nullable(),
  verified_on: z.string(),
});

const SlabItemSchema = z.object({
  lower_bound: z.number().nonnegative(),
  upper_bound: z.number().positive().nullable(),
  rate: z.number().min(0).max(1),
});

const TaxRulesYamlSchema = z.object({
  meta: z.object({
    rules_version: z.string(),
    assessment_year: z.string(),
    financial_year: z.string(),
    governing_act: z.string(),
    verified_on: z.string(),
    source_policy: z.object({
      authorities: z.array(z.string()),
      secondary_sources_allowed: z.boolean(),
      strip_url_tracking_params: z.boolean(),
    }),
    notes: z.array(z.string()).optional(),
  }),
  scope: z.object({
    taxpayer: z.object({
      residency: z.string(),
      age_category: z.string(),
      employment: z.string(),
      employers: z.number(),
      itr_style: z.string(),
    }),
    income_sources: z.array(z.string()),
    regimes: z.array(z.enum(['old', 'new'])),
    deductions_included: z.array(z.string()),
    unsupported: z.array(z.string()),
  }),
  validation: z.object({
    itr1_income_limit: z.object({
      maximum_total_income: z.number().positive(),
      action_if_exceeded: z.string(),
      source: SourceSchema,
    }),
    surcharge: z.object({
      in_scope: z.boolean(),
      reason: z.string(),
    }),
  }),
  calculation_order: z.array(z.string()).min(8),
  rounding: z.object({
    total_income: z.object({
      section: z.string(),
      multiple: z.number().int().positive(),
      mode: z.literal('drop_paise_then_half_up'),
      source: SourceSchema,
    }),
    amount_payable_or_refund: z.object({
      section: z.string(),
      multiple: z.number().int().positive(),
      mode: z.literal('drop_paise_then_half_up'),
      source: SourceSchema,
    }),
  }),
  tax_parameters: z.object({
    old_regime: z.object({
      slabs: z.array(SlabItemSchema).min(1),
      standard_deduction: z.object({
        amount: z.number().nonnegative(),
        cap_at_salary: z.boolean(),
        source: SourceSchema,
      }),
      slabs_source: SourceSchema,
    }),
    new_regime: z.object({
      section: z.string(),
      slabs: z.array(SlabItemSchema).min(1),
      standard_deduction: z.object({
        amount: z.number().nonnegative(),
        cap_at_salary: z.boolean(),
        source: SourceSchema,
      }),
      slabs_source: SourceSchema,
    }),
  }),
  rebate_87A: z.object({
    old_regime: z.object({
      eligible_total_income_max: z.number().nonnegative(),
      max_rebate: z.number().nonnegative(),
      marginal_relief: z.literal(false),
    }),
    new_regime: z.object({
      eligible_total_income_max: z.number().nonnegative(),
      max_rebate: z.number().nonnegative(),
      marginal_relief: z.object({
        enabled: z.boolean(),
        threshold: z.number().nonnegative(),
        formula: z.string(),
      }),
    }),
    source: SourceSchema,
  }),
  cess: z.object({
    health_and_education: z.object({
      rate: z.number().min(0).max(1),
      applies_to: z.array(z.string()),
      source: SourceSchema,
    }),
  }),
  deductions: z.object({
    aggregate_cap_groups: z.object({
      '80C_80CCC_80CCD1': z.object({
        limit: z.number().nonnegative(),
        members: z.array(z.string()),
      }),
    }),
    section_80C: z.object({
      group: z.string(),
      regimes: z.object({ old: z.boolean(), new: z.boolean() }),
      source: SourceSchema,
    }),
    section_80CCD_1: z.object({
      group: z.string(),
      max_percent_of_salary_employee: z.number().positive(),
      regimes: z.object({ old: z.boolean(), new: z.boolean() }),
      source: SourceSchema,
    }),
    section_80CCD_1B: z.object({
      max_amount: z.number().nonnegative(),
      regimes: z.object({ old: z.boolean(), new: z.boolean() }),
      source: SourceSchema,
    }),
    section_80CCD_2: z.object({
      input: z.string(),
      base: z.string(),
      user_confirms_base: z.boolean(),
      max_percent_of_base: z.object({
        new_regime: z.number().positive(),
        old_regime: z.object({
          central_or_state_government: z.number().positive(),
          other_employers: z.number().positive(),
        }),
      }),
      regimes: z.object({ old: z.boolean(), new: z.boolean() }),
      source: SourceSchema,
    }),
    section_80D: z.object({
      regimes: z.object({ old: z.boolean(), new: z.boolean() }),
      self_spouse_children: z.object({
        limit_below_60: z.number().nonnegative(),
        limit_if_any_person_senior: z.number().nonnegative(),
      }),
      parents: z.object({
        limit_below_60: z.number().nonnegative(),
        limit_if_any_person_senior: z.number().nonnegative(),
      }),
      preventive_health_checkup: z.object({
        max_amount: z.number().nonnegative(),
        included_within_limit: z.boolean(),
      }),
      medical_expenditure_senior_no_premium: z.object({
        in_scope: z.boolean(),
        note: z.string().optional(),
      }),
      source: SourceSchema,
    }),
    section_80TTA: z.object({
      max_amount: z.number().nonnegative(),
      applies_to: z.array(z.string()),
      excludes: z.array(z.string()),
      regimes: z.object({ old: z.boolean(), new: z.boolean() }),
      source: SourceSchema,
    }),
  }),
  income_rules: z.object({
    savings_bank_interest: z.object({ taxable: z.boolean() }),
    fixed_deposit_interest: z.object({
      taxable: z.boolean(),
      deduction_under_80TTA: z.boolean(),
    }),
  }),
});

export type ValidatedTaxRules = z.infer<typeof TaxRulesYamlSchema>;

let cachedRules: ValidatedTaxRules | null = null;
let cachedRuleVerification: RuleVerificationMetadata | null = null;

function resolveRulesPath(): string {
  const primary = path.resolve(process.cwd(), 'rules/AY2026-27.yaml');
  if (fs.existsSync(primary)) return primary;
  const fallback = path.resolve(
    process.cwd(),
    'public/assets/aistudio/AY2026-27_0b163f99.yaml'
  );
  if (fs.existsSync(fallback)) return fallback;
  throw new Error('ERR_MISSING_TAX_RULES_YAML: Missing rules/AY2026-27.yaml.');
}

export function loadValidatedTaxRules(): ValidatedTaxRules {
  if (cachedRules) return cachedRules;
  const rawYaml = fs.readFileSync(resolveRulesPath(), 'utf-8');
  const parsedObj = YAML.parse(rawYaml);
  cachedRules = TaxRulesYamlSchema.parse(parsedObj);
  return cachedRules;
}

export function getRuleVerificationMetadata(): RuleVerificationMetadata {
  if (cachedRuleVerification) return cachedRuleVerification;
  const rules = loadValidatedTaxRules();

  const sourcePairs: Array<[string, z.infer<typeof SourceSchema>]> = [
    ['ITR-1 ₹50L Ceiling', rules.validation.itr1_income_limit.source],
    ['Section 288A Total Income Rounding', rules.rounding.total_income.source],
    ['Section 288B Tax/Refund Rounding', rules.rounding.amount_payable_or_refund.source],
    ['Old Regime Standard Deduction', rules.tax_parameters.old_regime.standard_deduction.source],
    ['Old Regime Slabs', rules.tax_parameters.old_regime.slabs_source],
    ['New Regime Standard Deduction u/s 115BAC(1A)', rules.tax_parameters.new_regime.standard_deduction.source],
    ['New Regime Slabs u/s 115BAC(1A)', rules.tax_parameters.new_regime.slabs_source],
    ['Section 87A Rebate & Marginal Relief', rules.rebate_87A.source],
    ['Health & Education Cess (4%)', rules.cess.health_and_education.source],
    ['Section 80C', rules.deductions.section_80C.source],
    ['Section 80CCD(1)', rules.deductions.section_80CCD_1.source],
    ['Section 80CCD(1B)', rules.deductions.section_80CCD_1B.source],
    ['Section 80CCD(2)', rules.deductions.section_80CCD_2.source],
    ['Section 80D', rules.deductions.section_80D.source],
    ['Section 80TTA', rules.deductions.section_80TTA.source],
  ];

  const sources: RuleVerificationSourceEntry[] = sourcePairs.map(([parameter, src]) => ({
    parameter,
    authority: src.authority,
    url: src.url,
    section: src.section,
    verifiedOn: src.verified_on,
    snapshotVerified: Boolean(src.retrieval_hash && src.snapshot_path),
  }));

  const unhashedSnapshotCount = sources.filter((s) => !s.snapshotVerified).length;

  cachedRuleVerification = {
    rulesVersion: `AY2026-27-YAML-v${rules.meta.rules_version}`,
    assessmentYear: rules.meta.assessment_year,
    financialYear: rules.meta.financial_year,
    governingAct: rules.meta.governing_act,
    verifiedOn: rules.meta.verified_on,
    calculationOrder: [...rules.calculation_order],
    totalSourcesCited: sources.length,
    unhashedSnapshotCount,
    verificationWarning:
      unhashedSnapshotCount > 0
        ? `${unhashedSnapshotCount} of ${sources.length} statutory parameters cite official Income Tax Department URLs (reviewed ${rules.meta.verified_on}), but local page snapshots (retrieval_hash / snapshot_path) are currently null in rules/AY2026-27.yaml.`
        : null,
    sources,
  };

  return cachedRuleVerification;
}

export const TAX_RULE_ENGINE_VERSION = `AY2026-27-YAML-v${loadValidatedTaxRules().meta.rules_version}`;

function clampNonNegativeAmount(val: number | undefined | null): number {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) return 0;
  return val;
}

/**
 * Sections 288A & 288B statutory rounding (`drop_paise_then_half_up` to nearest multiple of 10):
 * 1. Drop paise (any fraction of a rupee is ignored -> Math.floor on non-negative amount).
 * 2. Half-up to nearest multiple of 10: if last digit >= 5, round up to next 10; else round down.
 */
export function roundSection288(amount: number, multiple = 10): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const wholeRupees = Math.floor(amount);
  const remainder = wholeRupees % multiple;
  const half = multiple / 2;
  return remainder >= half ? wholeRupees + (multiple - remainder) : wholeRupees - remainder;
}

function formatInrSlabBound(val: number): string {
  return `₹${val.toLocaleString('en-IN')}`;
}

function computeSlabsFromYaml(
  taxableIncome: number,
  yamlSlabs: Array<{ lower_bound: number; upper_bound: number | null; rate: number }>
): { breakdown: SlabBreakdownRow[]; total: number } {
  const breakdown: SlabBreakdownRow[] = [];
  let total = 0;

  for (const slab of yamlSlabs) {
    const label =
      slab.lower_bound === 0 && slab.upper_bound !== null
        ? `Up to ${formatInrSlabBound(slab.upper_bound)}`
        : slab.upper_bound === null
          ? `Above ${formatInrSlabBound(slab.lower_bound)}`
          : `${formatInrSlabBound(slab.lower_bound + 1)} – ${formatInrSlabBound(slab.upper_bound)}`;

    if (taxableIncome <= slab.lower_bound) {
      breakdown.push({
        slabLabel: label,
        ratePercent: Number((slab.rate * 100).toFixed(2)),
        taxableInSlab: 0,
        taxAmount: 0,
      });
      continue;
    }

    const upper =
      slab.upper_bound === null ? taxableIncome : Math.min(taxableIncome, slab.upper_bound);
    const taxableInSlab = Math.max(0, upper - slab.lower_bound);
    // Exact integer rupee math on 10-rupee rounded taxableIncome
    const taxAmount = Math.round(taxableInSlab * slab.rate);
    total += taxAmount;

    breakdown.push({
      slabLabel: label,
      ratePercent: Number((slab.rate * 100).toFixed(2)),
      taxableInSlab,
      taxAmount,
    });
  }

  return { breakdown, total };
}

/**
 * Enforces `scope.unsupported` from `rules/AY2026-27.yaml`:
 * capital_gains, business_income, foreign_income, multiple_employers, non_resident,
 * senior_citizen, super_senior_citizen, section_80TTB, house_property, surcharge (>50L).
 */
export function detectUnsupportedFilingScenario(
  textOrCategory: string
): UnsupportedScenarioFlag | null {
  const lower = textOrCategory.toLowerCase();

  if (
    lower.includes('crypto') ||
    lower.includes('bitcoin') ||
    lower.includes('virtual digital asset') ||
    lower.includes('vda') ||
    lower.includes('115bbh')
  ) {
    return {
      code: 'UNSUPPORTED_VDA_CRYPTO',
      title: 'Virtual Digital Assets (Crypto) Income Detected',
      reason:
        'Income from Virtual Digital Assets u/s 115BBH (flat 30% tax) is outside supported ITR-1 scope.',
      recommendedItrForm: 'ITR-2 or ITR-3',
      detectedFrom: textOrCategory.slice(0, 120),
    };
  }

  if (
    lower.includes('capital gain') ||
    lower.includes('stcg') ||
    lower.includes('ltcg') ||
    lower.includes('sold shares') ||
    lower.includes('sold mutual fund') ||
    lower.includes('equity sale') ||
    lower.includes('property sale')
  ) {
    return {
      code: 'UNSUPPORTED_CAPITAL_GAINS',
      title: 'Capital Gains Income Detected',
      reason:
        'Capital gains (STCG/LTCG on shares, mutual funds, or property) are listed as unsupported in rules/AY2026-27.yaml scope.',
      recommendedItrForm: 'ITR-2',
      detectedFrom: textOrCategory.slice(0, 120),
    };
  }

  if (
    lower.includes('business income') ||
    lower.includes('freelance') ||
    lower.includes('consultancy income') ||
    lower.includes('44ada') ||
    lower.includes('44ad') ||
    lower.includes('intraday') ||
    lower.includes('f&o') ||
    lower.includes('futures and options')
  ) {
    return {
      code: 'UNSUPPORTED_BUSINESS_INCOME',
      title: 'Business / Freelance / Speculative Income Detected',
      reason:
        'Business or profession income (including 44AD/44ADA freelance or F&O trading) is unsupported in ITR-1 scope.',
      recommendedItrForm: 'ITR-3 or ITR-4 (Sugam)',
      detectedFrom: textOrCategory.slice(0, 120),
    };
  }

  if (
    lower.includes('two house') ||
    lower.includes('2 house') ||
    lower.includes('multiple house') ||
    lower.includes('two properties') ||
    lower.includes('multiple rental') ||
    lower.includes('rental income') ||
    lower.includes('house property') ||
    lower.includes('let out property')
  ) {
    const isMulti =
      lower.includes('two') || lower.includes('2 ') || lower.includes('multiple');
    return {
      code: isMulti ? 'UNSUPPORTED_MULTIPLE_HOUSE_PROPERTIES' : 'UNSUPPORTED_HOUSE_PROPERTY',
      title: isMulti
        ? 'More Than One House Property Detected'
        : 'House Property / Rental Income Outside Supported YAML Scope',
      reason: isMulti
        ? 'Income from more than one house property requires ITR-2.'
        : 'House property income is explicitly marked unsupported in rules/AY2026-27.yaml scope (restricted to single-employer salary + savings/FD interest).',
      recommendedItrForm: isMulti ? 'ITR-2' : 'ITR-1 Manual / ITR-2',
      detectedFrom: textOrCategory.slice(0, 120),
    };
  }

  if (
    lower.includes('multiple employer') ||
    lower.includes('two employer') ||
    lower.includes('2 employer') ||
    lower.includes('switched job') ||
    lower.includes('changed employer') ||
    lower.includes('two form 16')
  ) {
    return {
      code: 'UNSUPPORTED_MULTIPLE_EMPLOYERS',
      title: 'Multiple Employers in Financial Year',
      reason:
        'rules/AY2026-27.yaml restricts automated scope to salaried individuals with exactly 1 employer.',
      recommendedItrForm: 'Manual Multi-Form-16 Consolidation',
      detectedFrom: textOrCategory.slice(0, 120),
    };
  }

  if (
    lower.includes('foreign stock') ||
    lower.includes('foreign asset') ||
    lower.includes('foreign income') ||
    lower.includes('rsu us') ||
    lower.includes('foreign bank') ||
    lower.includes('non-resident') ||
    lower.includes('non resident') ||
    /\bnri\b/.test(lower)
  ) {
    return {
      code: 'UNSUPPORTED_FOREIGN_OR_NRI',
      title: 'Foreign Income / Foreign Assets / Non-Resident Status',
      reason:
        'Foreign income, Schedule FA foreign assets, and Non-Resident status are ineligible under rules/AY2026-27.yaml.',
      recommendedItrForm: 'ITR-2',
      detectedFrom: textOrCategory.slice(0, 120),
    };
  }

  if (
    lower.includes('80ttb') ||
    lower.includes('senior citizen taxpayer') ||
    lower.includes('super senior citizen') ||
    lower.includes('age 65') ||
    lower.includes('age 70') ||
    lower.includes('age 82')
  ) {
    return {
      code: 'UNSUPPORTED_SENIOR_CITIZEN_80TTB',
      title: 'Senior / Super-Senior Citizen Taxpayer or Section 80TTB',
      reason:
        'rules/AY2026-27.yaml restricts taxpayer age scope to below_senior_citizen (< 60 years) and excludes Section 80TTB.',
      recommendedItrForm: 'Senior Citizen Slab Computation (Out of Scope)',
      detectedFrom: textOrCategory.slice(0, 120),
    };
  }

  return null;
}

export function detectAgeScopeViolation(dateOfBirth: string): UnsupportedScenarioFlag | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  // FY 2025-26 ends on 2026-03-31; an individual turning 60 on or before 2026-04-01 is a senior citizen for AY 2026-27
  const fyEnd = new Date('2026-04-01T00:00:00Z');
  let age = fyEnd.getUTCFullYear() - dob.getUTCFullYear();
  const mDiff = fyEnd.getUTCMonth() - dob.getUTCMonth();
  if (mDiff < 0 || (mDiff === 0 && fyEnd.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  if (age >= 60) {
    return {
      code: age >= 80 ? 'UNSUPPORTED_SUPER_SENIOR_CITIZEN' : 'UNSUPPORTED_SENIOR_CITIZEN',
      title: age >= 80 ? 'Super Senior Citizen (80+)' : 'Senior Citizen (60+)',
      reason:
        'rules/AY2026-27.yaml supports resident salaried individuals below 60 years of age (below_senior_citizen).',
      recommendedItrForm: 'Senior Citizen Tax Rules (Out of Scope)',
      detectedFrom: `DOB ${dateOfBirth} (Age ${age} in FY 2025-26)`,
    };
  }
  return null;
}

/**
 * Deterministic Tax Computation strictly following `calculation_order` in `rules/AY2026-27.yaml`:
 * 1. compute_gross_salary_and_other_income
 * 2. apply_standard_deduction (min(amount, salary))
 * 3. apply_chapter_VIA_deductions (regime-specific, with caps)
 * 4. total_income_before_rounding
 * 5. round_total_income (Section 288A: drop_paise_then_half_up to multiple of 10)
 * 6. compute_slab_tax
 * 7. apply_87A_rebate_and_marginal_relief
 * 8. add_cess (4% on tax after rebate)
 * 9. subtract_tds_and_advance_tax
 * 10. round_net_payable_or_refund (Section 288B: drop_paise_then_half_up to multiple of 10)
 */
export function computeSingleRegime(
  inputs: ReturnFinancialInputs,
  regime: TaxRegime
): RegimeTaxComputation {
  const rules = loadValidatedTaxRules();

  // Step 1: compute_gross_salary_and_other_income
  const grossSalary = clampNonNegativeAmount(inputs.grossSalary);
  const savingsInterest = rules.income_rules.savings_bank_interest.taxable
    ? clampNonNegativeAmount(inputs.savingsInterest)
    : 0;
  const fdInterest = rules.income_rules.fixed_deposit_interest.taxable
    ? clampNonNegativeAmount(inputs.fdInterest)
    : 0;
  const otherIncome = clampNonNegativeAmount(inputs.otherIncome);
  const incomeFromOtherSources = savingsInterest + fdInterest + otherIncome;

  const exemptAllowances =
    regime === 'old'
      ? Math.min(clampNonNegativeAmount(inputs.hraExemption), grossSalary)
      : 0;
  const salaryAfterExemptions = Math.max(0, grossSalary - exemptAllowances);

  // Step 2: apply_standard_deduction (min(amount, salary))
  const regimeParams =
    regime === 'new' ? rules.tax_parameters.new_regime : rules.tax_parameters.old_regime;
  const stdDedConfigured = regimeParams.standard_deduction.amount;
  const standardDeduction = regimeParams.standard_deduction.cap_at_salary
    ? Math.min(salaryAfterExemptions, stdDedConfigured)
    : stdDedConfigured;

  const professionalTaxDeduction =
    regime === 'old'
      ? Math.min(
          Math.max(0, salaryAfterExemptions - standardDeduction),
          Math.min(clampNonNegativeAmount(inputs.professionalTax), 2_500)
        )
      : 0;

  const netSalaryIncome = Math.max(
    0,
    salaryAfterExemptions - standardDeduction - professionalTaxDeduction
  );
  const grossTotalIncome = netSalaryIncome + incomeFromOtherSources;

  // Step 3: apply_chapter_VIA_deductions (regime-specific, with caps from YAML)
  const salaryBaseForNps =
    clampNonNegativeAmount(inputs.basicSalary) > 0
      ? clampNonNegativeAmount(inputs.basicSalary)
      : grossSalary;

  const group80CLimit = rules.deductions.aggregate_cap_groups['80C_80CCC_80CCD1'].limit;

  let eligible80C = 0;
  if (rules.deductions.section_80C.regimes[regime]) {
    eligible80C = Math.min(clampNonNegativeAmount(inputs.section80C), group80CLimit);
  }

  let eligible80CCD1 = 0;
  if (rules.deductions.section_80CCD_1.regimes[regime]) {
    const maxEmployeeNps = Math.floor(
      salaryBaseForNps * (rules.deductions.section_80CCD_1.max_percent_of_salary_employee / 100)
    );
    const raw80CCD1 = Math.min(clampNonNegativeAmount(inputs.section80CCD1), maxEmployeeNps);
    const remainingIn80CGroup = Math.max(0, group80CLimit - eligible80C);
    eligible80CCD1 = Math.min(raw80CCD1, remainingIn80CGroup);
  }

  let eligible80CCD1B = 0;
  if (rules.deductions.section_80CCD_1B.regimes[regime]) {
    eligible80CCD1B = Math.min(
      clampNonNegativeAmount(inputs.section80CCD1B),
      rules.deductions.section_80CCD_1B.max_amount
    );
  }

  let eligible80CCD2 = 0;
  if (rules.deductions.section_80CCD_2.regimes[regime]) {
    const maxPct =
      regime === 'new'
        ? rules.deductions.section_80CCD_2.max_percent_of_base.new_regime
        : inputs.isGovernmentEmployer
          ? rules.deductions.section_80CCD_2.max_percent_of_base.old_regime
              .central_or_state_government
          : rules.deductions.section_80CCD_2.max_percent_of_base.old_regime.other_employers;
    const maxEmployerNps = Math.floor(salaryBaseForNps * (maxPct / 100));
    eligible80CCD2 = Math.min(clampNonNegativeAmount(inputs.section80CCD2), maxEmployerNps);
  }

  let eligible80D = 0;
  if (rules.deductions.section_80D.regimes[regime]) {
    const selfLimit = rules.deductions.section_80D.self_spouse_children.limit_below_60;
    const parentsLimit = inputs.hasSeniorParents
      ? rules.deductions.section_80D.parents.limit_if_any_person_senior
      : rules.deductions.section_80D.parents.limit_below_60;

    if (inputs.section80DParents !== undefined) {
      const selfClaim = Math.min(clampNonNegativeAmount(inputs.section80D), selfLimit);
      const parentsClaim = Math.min(
        clampNonNegativeAmount(inputs.section80DParents),
        parentsLimit
      );
      eligible80D = selfClaim + parentsClaim;
    } else {
      // Single-field 80D claim (self below 60 limit = ₹25,000; if hasSeniorParents = ₹75,000)
      const cap = inputs.hasSeniorParents ? selfLimit + parentsLimit : selfLimit;
      eligible80D = Math.min(clampNonNegativeAmount(inputs.section80D), cap);
    }
  }

  // Section 80TTA: strictly on savings_bank_interest, NEVER on fixed_deposit_interest!
  let eligible80TTA = 0;
  if (
    rules.deductions.section_80TTA.regimes[regime] &&
    rules.deductions.section_80TTA.applies_to.includes('savings_bank_interest') &&
    !rules.income_rules.fixed_deposit_interest.deduction_under_80TTA
  ) {
    eligible80TTA = Math.min(savingsInterest, rules.deductions.section_80TTA.max_amount);
  }

  const rawChapterVIA =
    eligible80C +
    eligible80CCD1 +
    eligible80CCD1B +
    eligible80CCD2 +
    eligible80D +
    eligible80TTA;
  const totalChapterVIADeductions = Math.min(grossTotalIncome, rawChapterVIA);

  // Step 4: total_income_before_rounding
  const totalIncomeBeforeRounding = Math.max(0, grossTotalIncome - totalChapterVIADeductions);

  // Step 5: round_total_income (Section 288A)
  const taxableIncome = roundSection288(
    totalIncomeBeforeRounding,
    rules.rounding.total_income.multiple
  );

  // Step 6: compute_slab_tax
  const { breakdown: slabBreakdown, total: taxBeforeRebate } = computeSlabsFromYaml(
    taxableIncome,
    regimeParams.slabs
  );

  // Step 7: apply_87A_rebate_and_marginal_relief
  let rebate87A = 0;
  let marginalReliefApplied = false;

  if (regime === 'new') {
    const newRebateCfg = rules.rebate_87A.new_regime;
    if (taxableIncome <= newRebateCfg.eligible_total_income_max) {
      rebate87A = Math.min(taxBeforeRebate, newRebateCfg.max_rebate);
    } else if (newRebateCfg.marginal_relief.enabled) {
      const excessOverThreshold = taxableIncome - newRebateCfg.marginal_relief.threshold;
      const marginalRebate = Math.max(0, taxBeforeRebate - excessOverThreshold);
      if (marginalRebate > 0) {
        rebate87A = Math.min(taxBeforeRebate, marginalRebate);
        marginalReliefApplied = true;
      }
    }
  } else {
    const oldRebateCfg = rules.rebate_87A.old_regime;
    if (taxableIncome <= oldRebateCfg.eligible_total_income_max) {
      rebate87A = Math.min(taxBeforeRebate, oldRebateCfg.max_rebate);
    }
  }

  const taxAfterRebate = Math.max(0, taxBeforeRebate - rebate87A);

  // Step 8: add_cess (4% on tax after rebate)
  const cessRate = rules.cess.health_and_education.rate;
  const healthAndEducationCess = Math.round(taxAfterRebate * cessRate);
  const totalTaxLiability = taxAfterRebate + healthAndEducationCess;

  // Step 9: subtract_tds_and_advance_tax
  const tdsCredited = Math.round(clampNonNegativeAmount(inputs.tdsClaimed));
  const advanceTaxPaid = Math.round(clampNonNegativeAmount(inputs.advanceTax));
  const totalTaxesPaid = tdsCredited + advanceTaxPaid;
  const rawNetDiff = totalTaxLiability - totalTaxesPaid;

  // Step 10: round_net_payable_or_refund (Section 288B)
  const payableMultiple = rules.rounding.amount_payable_or_refund.multiple;
  const netTaxPayable =
    rawNetDiff > 0 ? roundSection288(rawNetDiff, payableMultiple) : 0;
  const refundDue =
    rawNetDiff < 0 ? roundSection288(Math.abs(rawNetDiff), payableMultiple) : 0;

  return {
    regime,
    ruleVersion: TAX_RULE_ENGINE_VERSION,
    grossSalary: Math.round(grossSalary),
    exemptAllowances: Math.round(exemptAllowances),
    standardDeduction: Math.round(standardDeduction),
    professionalTaxDeduction: Math.round(professionalTaxDeduction),
    netSalaryIncome: Math.round(netSalaryIncome),
    savingsInterest: Math.round(savingsInterest),
    fdInterest: Math.round(fdInterest),
    otherIncome: Math.round(otherIncome),
    incomeFromOtherSources: Math.round(incomeFromOtherSources),
    grossTotalIncome: Math.round(grossTotalIncome),
    eligible80C: Math.round(eligible80C),
    eligible80CCD1: Math.round(eligible80CCD1),
    eligible80CCD1B: Math.round(eligible80CCD1B),
    eligible80CCD2: Math.round(eligible80CCD2),
    eligible80D: Math.round(eligible80D),
    eligible80TTA: Math.round(eligible80TTA),
    totalChapterVIADeductions: Math.round(totalChapterVIADeductions),
    totalIncomeBeforeRounding,
    taxableIncome,
    slabBreakdown,
    taxBeforeRebate,
    rebate87A,
    marginalReliefApplied,
    taxAfterRebate,
    healthAndEducationCess,
    totalTaxLiability,
    tdsCredited,
    advanceTaxPaid,
    netTaxPayable,
    refundDue,
  };
}

export function calculateTaxComparison(
  inputs: ReturnFinancialInputs,
  assessmentYear?: string,
  financialYear?: string
): TaxComparisonSummary {
  const rules = loadValidatedTaxRules();
  const newRegime = computeSingleRegime(inputs, 'new');
  const oldRegime = computeSingleRegime(inputs, 'old');

  const recommendedRegime: TaxRegime =
    newRegime.totalTaxLiability <= oldRegime.totalTaxLiability ? 'new' : 'old';

  const netSavingsInRecommended = Math.abs(
    newRegime.totalTaxLiability - oldRegime.totalTaxLiability
  );

  return {
    assessmentYear: assessmentYear || rules.meta.assessment_year,
    financialYear: financialYear || rules.meta.financial_year,
    ruleEngineVersion: TAX_RULE_ENGINE_VERSION,
    newRegime,
    oldRegime,
    recommendedRegime,
    netSavingsInRecommended,
    ruleVerification: getRuleVerificationMetadata(),
    computedAt: new Date().toISOString(),
  };
}

export function validateReturnData(
  profile: UserProfile,
  inputs: ReturnFinancialInputs,
  selectedRegime: TaxRegime,
  documents: UploadedDocument[],
  unsupportedScenarios: UnsupportedScenarioFlag[] = []
): ValidationResult {
  const rules = loadValidatedTaxRules();
  const issues: ValidationIssue[] = [];
  const activeUnsupported = [...unsupportedScenarios];

  // Check taxpayer age scope (< 60 years per YAML)
  const ageFlag = detectAgeScopeViolation(profile.dateOfBirth);
  if (ageFlag && !activeUnsupported.some((f) => f.code === ageFlag.code)) {
    activeUnsupported.push(ageFlag);
  }

  // Check multiple Form 16s from different employer TANs
  const form16Tans = new Set(
    documents
      .filter((d) => d.category === 'form_16' && d.structuredData.employerTan)
      .map((d) => d.structuredData.employerTan!)
  );
  if (form16Tans.size > rules.scope.taxpayer.employers) {
    const multiEmpFlag: UnsupportedScenarioFlag = {
      code: 'UNSUPPORTED_MULTIPLE_EMPLOYERS',
      title: 'Multiple Employers Detected Across Form 16 Uploads',
      reason: `Uploaded Form 16 documents contain ${form16Tans.size} distinct employer TANs, exceeding YAML scope limit (${rules.scope.taxpayer.employers}).`,
      recommendedItrForm: 'Manual Multi-Employer ITR-1 Review',
      detectedFrom: Array.from(form16Tans).join(', '),
    };
    if (!activeUnsupported.some((f) => f.code === multiEmpFlag.code)) {
      activeUnsupported.push(multiEmpFlag);
    }
  }

  for (const flag of activeUnsupported) {
    issues.push({
      code: flag.code,
      field: 'itrFormEligibility',
      severity: 'error',
      message: `${flag.title}: ${flag.reason} Required handling: ${flag.recommendedItrForm}.`,
    });
  }

  // PAN validation
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  if (!panRegex.test(profile.pan)) {
    issues.push({
      code: 'PAN_INVALID',
      field: 'profile.pan',
      severity: 'error',
      message: 'PAN must match 10-character statutory format (AAAAA9999A).',
    });
  } else {
    issues.push({
      code: 'PAN_VALID',
      field: 'profile.pan',
      severity: 'pass',
      message: 'Taxpayer PAN format verified.',
    });
  }

  // IFSC validation
  const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  if (!ifscRegex.test(profile.bankIfsc)) {
    issues.push({
      code: 'IFSC_INVALID',
      field: 'profile.bankIfsc',
      severity: 'error',
      message: 'Refund bank account IFSC code is invalid (expected 11-character RBI IFSC).',
    });
  } else {
    issues.push({
      code: 'IFSC_VALID',
      field: 'profile.bankIfsc',
      severity: 'pass',
      message: 'Pre-validated bank IFSC verified for refund/payment schedule.',
    });
  }

  // ITR-1 ₹50,00,000 cap from YAML
  const maxIncome = rules.validation.itr1_income_limit.maximum_total_income;
  const comparison = calculateTaxComparison(inputs);
  const chosen = selectedRegime === 'new' ? comparison.newRegime : comparison.oldRegime;

  if (
    chosen.taxableIncome > maxIncome ||
    comparison.newRegime.taxableIncome > maxIncome ||
    comparison.oldRegime.taxableIncome > maxIncome
  ) {
    const capFlag: UnsupportedScenarioFlag = {
      code: 'ITR1_INCOME_EXCEEDS_50L',
      title: `Total Income Exceeds ₹${maxIncome.toLocaleString('en-IN')} Ceiling`,
      reason: `Resident individuals with total taxable income above ₹${maxIncome.toLocaleString('en-IN')} (surcharge zone) cannot file ITR-1 (Sahaj).`,
      recommendedItrForm: 'ITR-2',
      detectedFrom: `Taxable Income ₹${Math.max(chosen.taxableIncome, comparison.newRegime.taxableIncome).toLocaleString('en-IN')}`,
    };
    if (!activeUnsupported.some((f) => f.code === capFlag.code)) {
      activeUnsupported.push(capFlag);
    }
    issues.push({
      code: 'ITR1_INCOME_CAP',
      field: 'taxableIncome',
      severity: 'error',
      message: capFlag.reason,
    });
  } else {
    issues.push({
      code: 'ITR1_ELIGIBLE',
      field: 'taxableIncome',
      severity: 'pass',
      message: `Resident individual income is within ₹${maxIncome.toLocaleString('en-IN')} ITR-1 (Sahaj) ceiling.`,
    });
  }

  // Salary presence check
  if (inputs.grossSalary <= 0) {
    issues.push({
      code: 'SALARY_ZERO',
      field: 'inputs.grossSalary',
      severity: 'error',
      message: 'Gross salary is ₹0. Upload Form 16 or confirm salary income before finalizing.',
    });
  } else {
    issues.push({
      code: 'SALARY_PRESENT',
      field: 'inputs.grossSalary',
      severity: 'pass',
      message: `Gross salary schedule populated (₹${inputs.grossSalary.toLocaleString('en-IN')}).`,
    });
  }

  // Separate check for Savings Interest vs FD Interest across uploaded documents
  const activeDocs = documents.filter(
    (d) => d.processingStatus === 'extracted' && d.agentAccessAllowed !== false
  );
  let docSavingsMax = 0;
  let docFdMax = 0;
  for (const d of activeDocs) {
    docSavingsMax = Math.max(
      docSavingsMax,
      d.structuredData.savingsBankInterest ?? 0,
      d.structuredData.aisReportedSavingsInterest ?? 0
    );
    docFdMax = Math.max(
      docFdMax,
      d.structuredData.fdInterest ?? 0,
      d.structuredData.aisReportedFdInterest ?? 0
    );
  }

  if (docSavingsMax > 0 && inputs.savingsInterest < docSavingsMax) {
    issues.push({
      code: 'SAVINGS_INTEREST_UNRECONCILED',
      field: 'inputs.savingsInterest',
      severity: 'warning',
      message: `Uploaded documents report ₹${docSavingsMax.toLocaleString('en-IN')} in Savings Bank Interest, while return draft holds ₹${inputs.savingsInterest.toLocaleString('en-IN')}.`,
    });
  } else if (inputs.savingsInterest > 0) {
    issues.push({
      code: 'SAVINGS_INTEREST_VERIFIED',
      field: 'inputs.savingsInterest',
      severity: 'pass',
      message: `Savings Bank Interest verified separately (₹${inputs.savingsInterest.toLocaleString('en-IN')}).`,
    });
  }

  if (docFdMax > 0 && inputs.fdInterest < docFdMax) {
    issues.push({
      code: 'FD_INTEREST_UNRECONCILED',
      field: 'inputs.fdInterest',
      severity: 'warning',
      message: `Uploaded documents report ₹${docFdMax.toLocaleString('en-IN')} in Fixed Deposit Interest, while return draft holds ₹${inputs.fdInterest.toLocaleString('en-IN')}.`,
    });
  } else if (inputs.fdInterest > 0) {
    issues.push({
      code: 'FD_INTEREST_VERIFIED',
      field: 'inputs.fdInterest',
      severity: 'pass',
      message: `Fixed Deposit Interest verified separately (₹${inputs.fdInterest.toLocaleString('en-IN')}; excluded from 80TTA).`,
    });
  }

  // Low-confidence OCR review check
  const lowConfDocs = activeDocs.filter((d) =>
    d.extractedFacts.some((f) => f.validationStatus === 'needs_review')
  );
  if (lowConfDocs.length > 0) {
    issues.push({
      code: 'OCR_NEEDS_USER_REVIEW',
      field: 'documents',
      severity: 'warning',
      message: `${lowConfDocs.length} document(s) contain low-confidence OCR values flagged for user review (${lowConfDocs.map((d) => d.fileName).join(', ')}).`,
    });
  }

  // Cross-check Form 26AS if uploaded
  const form26as = activeDocs.find((d) => d.category === 'form_26as');
  if (form26as?.structuredData.totalTdsCredited26AS !== undefined) {
    const credited = form26as.structuredData.totalTdsCredited26AS;
    if (inputs.tdsClaimed > credited) {
      issues.push({
        code: 'TDS_EXCEEDS_26AS',
        field: 'inputs.tdsClaimed',
        severity: 'warning',
        message: `TDS claimed (₹${inputs.tdsClaimed.toLocaleString('en-IN')}) exceeds Form 26AS credit (₹${credited.toLocaleString('en-IN')}).`,
      });
    } else {
      issues.push({
        code: 'TDS_MATCHES_26AS',
        field: 'inputs.tdsClaimed',
        severity: 'pass',
        message: `TDS claimed verified against Form 26AS (₹${credited.toLocaleString('en-IN')}).`,
      });
    }
  }

  // Regime optimality check
  if (selectedRegime !== comparison.recommendedRegime && comparison.netSavingsInRecommended > 0) {
    issues.push({
      code: 'SUBOPTIMAL_REGIME',
      field: 'selectedRegime',
      severity: 'warning',
      message: `Selected ${selectedRegime.toUpperCase()} regime incurs ₹${comparison.netSavingsInRecommended.toLocaleString('en-IN')} higher tax than ${comparison.recommendedRegime.toUpperCase()} regime.`,
    });
  } else if (inputs.grossSalary > 0) {
    issues.push({
      code: 'OPTIMAL_REGIME',
      field: 'selectedRegime',
      severity: 'pass',
      message: `${selectedRegime.toUpperCase()} regime is optimal (${TAX_RULE_ENGINE_VERSION}).`,
    });
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const passCount = issues.filter((i) => i.severity === 'pass').length;

  return {
    isValid: errorCount === 0,
    checkedAt: new Date().toISOString(),
    errorCount,
    warningCount,
    passCount,
    unsupportedScenarios: activeUnsupported,
    issues,
  };
}

export function buildStructuredItr1Json(
  profile: UserProfile,
  inputs: ReturnFinancialInputs,
  selectedRegime: TaxRegime,
  taxSummary: TaxComparisonSummary,
  version: number
): Record<string, unknown> {
  const active = selectedRegime === 'new' ? taxSummary.newRegime : taxSummary.oldRegime;

  return {
    _notice:
      'DRAFT FOR REVIEW & OFFLINE PREPARATION ONLY — NOT SUBMITTED TO INCOME TAX DEPARTMENT PORTAL',
    ITR: {
      ITR1: {
        CreationInfo: {
          SWVersionNo: `TaxShield-MCP-${TAX_RULE_ENGINE_VERSION}-Draft-${version}`,
          SWCreatedBy: 'TaxShield-Deterministic-YAML-Engine',
          JSONCreatedDate: new Date().toISOString().slice(0, 10),
          IntermediaryCity: 'Bengaluru',
        },
        Form_ITR1: {
          FormName: 'ITR-1',
          Description:
            'For Individuals being a Resident (other than Not Ordinarily Resident) having Total Income upto Rs.50 lakhs',
          AssessmentYear: '2026',
          SchemaVer: 'Ver1.0',
          FormVer: 'Ver1.0',
        },
        PersonalInfo: {
          AssesseeName: {
            FirstName: profile.fullName.split(' ')[0] || profile.fullName,
            SurNameOrOrgName: profile.fullName.split(' ').slice(1).join(' ') || 'NA',
          },
          PAN: profile.pan,
          DOB: profile.dateOfBirth,
          AadhaarCardNo: `XXXXXXXX${profile.aadhaarLast4}`,
          Status: 'I',
          ResidentialStatus: 'RES',
        },
        FilingStatus: {
          ReturnFileSec: 139,
          NewTaxRegime115BAC: selectedRegime === 'new' ? 'Y' : 'N',
          PortalSubmissionStatus: 'NOT_SUBMITTED_LOCAL_DRAFT_ONLY',
        },
        ITR1_IncomeDeductions: {
          GrossSalary: active.grossSalary,
          BasicSalary: inputs.basicSalary,
          AllwncExemptUs10: {
            TotalAllwncExemptUs10: active.exemptAllowances,
          },
          NetSalary: active.grossSalary - active.exemptAllowances,
          DeductionUs16: active.standardDeduction + active.professionalTaxDeduction,
          DeductionUs16ia: active.standardDeduction,
          ProfessionalTaxUs16iii: active.professionalTaxDeduction,
          IncomeFromSal: active.netSalaryIncome,
          IncomeOthSrc: active.incomeFromOtherSources,
          OthersIncDtlsOthSrc: [
            { OthSrcNatureDesc: 'SAV', OthSrcOthAmount: active.savingsInterest },
            { OthSrcNatureDesc: 'IFD', OthSrcOthAmount: active.fdInterest },
            { OthSrcNatureDesc: 'OTH', OthSrcOthAmount: active.otherIncome },
          ],
          GrossTotIncome: active.grossTotalIncome,
          UsrDeductUndChapVIA: {
            Section80C: active.eligible80C,
            Section80CCD1: active.eligible80CCD1,
            Section80CCD1B: active.eligible80CCD1B,
            Section80CCD2: active.eligible80CCD2,
            Section80D: active.eligible80D,
            Section80TTA: active.eligible80TTA,
            TotalChapVIADeductions: active.totalChapterVIADeductions,
          },
          TotalIncomeBeforeRounding: active.totalIncomeBeforeRounding,
          TotalIncome: active.taxableIncome,
        },
        ITR1_TaxComputation: {
          TotalTaxPayable: active.taxBeforeRebate,
          Rebate87A: active.rebate87A,
          MarginalReliefApplied: active.marginalReliefApplied,
          TaxPayableOnRebate: active.taxAfterRebate,
          EducationCess: active.healthAndEducationCess,
          GrossTaxLiability: active.totalTaxLiability,
          NetTaxLiability: active.totalTaxLiability,
        },
        TaxPaid: {
          TaxesPaid: {
            TDS: active.tdsCredited,
            TCS: 0,
            AdvanceTax: active.advanceTaxPaid,
            SelfAssessmentTax: 0,
            TotalTaxesPaid: active.tdsCredited + active.advanceTaxPaid,
          },
          BalTaxPayable: active.netTaxPayable,
        },
        Refund: {
          RefundDue: active.refundDue,
          BankAccountDtls: {
            AddtnlBankDetails: [
              {
                IFSCCode: profile.bankIfsc,
                BankName: profile.bankName,
                BankAccountNo: profile.bankAccountNumber,
                UseForRefund: 'true',
              },
            ],
          },
        },
        TDSonSalaries: [
          {
            EmployerOrDeductorOrCollectDetl: {
              TAN: profile.employerTan,
              EmployerOrDeductorOrCollecterName: profile.employerName,
            },
            IncChrgSal: active.grossSalary,
            TotalTDSSal: active.tdsCredited,
          },
        ],
      },
    },
  };
}
