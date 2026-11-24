import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateTaxComparison,
  computeSingleRegime,
  detectAgeScopeViolation,
  detectUnsupportedFilingScenario,
  getRuleVerificationMetadata,
  loadValidatedTaxRules,
  roundSection288,
  validateReturnData,
} from '../server/taxEngine.js';
import { ReturnFinancialInputs, UserProfile } from '../src/shared/types.js';

function makeInputs(partial: Partial<ReturnFinancialInputs> = {}): ReturnFinancialInputs {
  return {
    grossSalary: 0,
    basicSalary: 0,
    hraExemption: 0,
    professionalTax: 0,
    savingsInterest: 0,
    fdInterest: 0,
    otherIncome: 0,
    section80C: 0,
    section80CCD1: 0,
    section80CCD1B: 0,
    section80CCD2: 0,
    isGovernmentEmployer: false,
    section80D: 0,
    section80DParents: 0,
    hasSeniorParents: false,
    tdsClaimed: 0,
    advanceTax: 0,
    ...partial,
  };
}

const VALID_PROFILE: UserProfile = {
  fullName: 'Rohan Deshmukh',
  pan: 'SYNTP1234K',
  aadhaarLast4: '8821',
  dateOfBirth: '1993-08-14',
  residentialStatus: 'Resident (ROR)',
  email: 'rohan.synthetic@example.in',
  phone: '9876543210',
  employerName: 'AetherStack Technologies Pvt Ltd',
  employerTan: 'BLRA99120F',
  bankName: 'State Bank of India',
  bankIfsc: 'SBIN0004122',
  bankAccountNumber: '409988112233',
  preferredRegime: 'new',
};

test('YAML Rules Loader & Rule Verification Metadata load and validate rules/AY2026-27.yaml', () => {
  const rules = loadValidatedTaxRules();
  assert.equal(rules.meta.assessment_year, 'AY 2026-27');
  assert.equal(rules.meta.financial_year, 'FY 2025-26');
  assert.equal(rules.calculation_order.length, 10);

  const meta = getRuleVerificationMetadata();
  assert.equal(meta.totalSourcesCited, 15);
  assert.equal(meta.unhashedSnapshotCount, 15);
  assert.ok(meta.verificationWarning && meta.verificationWarning.includes('null'));

  // Section 288A/288B drop_paise_then_half_up rounding checks
  assert.equal(roundSection288(1234.99), 1230); // drop paise -> 1234 -> 1230
  assert.equal(roundSection288(1235.01), 1240); // drop paise -> 1235 -> half up -> 1240
});

test('Case 1: Salary below taxable threshold results in zero tax under both regimes', () => {
  const summary = calculateTaxComparison(makeInputs({ grossSalary: 300_000 }));
  assert.equal(summary.newRegime.taxBeforeRebate, 0);
  assert.equal(summary.newRegime.totalTaxLiability, 0);
  assert.equal(summary.oldRegime.taxBeforeRebate, 0);
  assert.equal(summary.oldRegime.totalTaxLiability, 0);
});

test('Case 2: Old regime Section 87A rebate at ₹5,00,000 taxable income', () => {
  // ₹5,50,000 salary - ₹50,000 Old Regime Std Ded = ₹5,00,000 taxable income
  const oldCalc = computeSingleRegime(makeInputs({ grossSalary: 550_000 }), 'old');
  assert.equal(oldCalc.taxableIncome, 500_000);
  assert.equal(oldCalc.taxBeforeRebate, 12_500);
  assert.equal(oldCalc.rebate87A, 12_500);
  assert.equal(oldCalc.totalTaxLiability, 0);
});

test('Case 3: New regime Section 87A rebate at ₹12,00,000 taxable income', () => {
  // ₹12,75,000 salary - ₹75,000 New Regime Std Ded = ₹12,00,000 taxable income
  const newCalc = computeSingleRegime(makeInputs({ grossSalary: 1_275_000 }), 'new');
  assert.equal(newCalc.taxableIncome, 1_200_000);
  assert.equal(newCalc.taxBeforeRebate, 60_000);
  assert.equal(newCalc.rebate87A, 60_000);
  assert.equal(newCalc.marginalReliefApplied, false);
  assert.equal(newCalc.totalTaxLiability, 0);
});

test('Case 4: New regime marginal relief u/s 87A just above ₹12,00,000 taxable income', () => {
  // ₹12,85,000 salary - ₹75,000 Std Ded = ₹12,10,000 taxable income
  // Slab tax: 0-4L (0) + 4-8L @5% (20,000) + 8-12L @10% (40,000) + 10k @15% (1,500) = ₹61,500
  // Excess income over ₹12L = ₹10,000 -> Marginal relief rebate = 61,500 - 10,000 = ₹51,500
  // Tax after rebate = ₹10,000 + 4% cess (₹400) = ₹10,400
  const newCalc = computeSingleRegime(makeInputs({ grossSalary: 1_285_000 }), 'new');
  assert.equal(newCalc.taxableIncome, 1_210_000);
  assert.equal(newCalc.taxBeforeRebate, 61_500);
  assert.equal(newCalc.marginalReliefApplied, true);
  assert.equal(newCalc.rebate87A, 51_500);
  assert.equal(newCalc.taxAfterRebate, 10_000);
  assert.equal(newCalc.healthAndEducationCess, 400);
  assert.equal(newCalc.totalTaxLiability, 10_400);
});

test('Case 5: Section 80C cap at ₹1,50,000 in Old Regime (₹0 in New Regime)', () => {
  const comp = calculateTaxComparison(
    makeInputs({ grossSalary: 1_500_000, section80C: 240_000 })
  );
  assert.equal(comp.oldRegime.eligible80C, 150_000);
  assert.equal(comp.newRegime.eligible80C, 0);
});

test('Case 6: Section 80C + 80CCD(1) combined cap at ₹1,50,000 under Section 80CCE', () => {
  const comp = calculateTaxComparison(
    makeInputs({
      grossSalary: 1_600_000,
      basicSalary: 900_000,
      section80C: 110_000,
      section80CCD1: 80_000, // 10% of 9L = 90k individual cap, but 80CCE caps 110k + 80k at 150k -> 40k allowed
    })
  );
  assert.equal(comp.oldRegime.eligible80C, 110_000);
  assert.equal(comp.oldRegime.eligible80CCD1, 40_000);
  assert.equal(comp.oldRegime.eligible80C + comp.oldRegime.eligible80CCD1, 150_000);
});

test('Case 7: Section 80CCD(1B) additional ₹50,000 over ₹1.5L 80C in Old Regime & 80CCD(2) in both', () => {
  const comp = calculateTaxComparison(
    makeInputs({
      grossSalary: 1_800_000,
      basicSalary: 1_000_000,
      section80C: 150_000,
      section80CCD1B: 75_000,
      section80CCD2: 120_000, // New regime 14% of 10L = 1.4L (120k allowed); Old private 10% of 10L = 1L
    })
  );
  assert.equal(comp.oldRegime.eligible80C, 150_000);
  assert.equal(comp.oldRegime.eligible80CCD1B, 50_000);
  assert.equal(comp.newRegime.eligible80CCD1B, 0);
  assert.equal(comp.newRegime.eligible80CCD2, 120_000);
  assert.equal(comp.oldRegime.eligible80CCD2, 100_000);
});

test('Case 8: Section 80D self (₹25,000) + parents (₹25,000 below 60 / ₹50,000 senior) cap', () => {
  const nonSeniorParents = computeSingleRegime(
    makeInputs({
      grossSalary: 1_500_000,
      section80D: 40_000,
      section80DParents: 45_000,
      hasSeniorParents: false,
    }),
    'old'
  );
  assert.equal(nonSeniorParents.eligible80D, 50_000); // 25k + 25k

  const seniorParents = computeSingleRegime(
    makeInputs({
      grossSalary: 1_500_000,
      section80D: 40_000,
      section80DParents: 60_000,
      hasSeniorParents: true,
    }),
    'old'
  );
  assert.equal(seniorParents.eligible80D, 75_000); // 25k + 50k
});

test('Case 9: Section 80TTA applied to savings bank interest up to ₹10,000 in Old Regime', () => {
  const comp = calculateTaxComparison(
    makeInputs({ grossSalary: 1_400_000, savingsInterest: 16_000 })
  );
  assert.equal(comp.oldRegime.eligible80TTA, 10_000);
  assert.equal(comp.newRegime.eligible80TTA, 0);
});

test('Case 10: Section 80TTA is NEVER applied to Fixed Deposit (FD) interest', () => {
  const fdOnly = calculateTaxComparison(
    makeInputs({ grossSalary: 1_400_000, savingsInterest: 0, fdInterest: 45_000 })
  );
  assert.equal(fdOnly.oldRegime.eligible80TTA, 0);
  assert.equal(fdOnly.newRegime.eligible80TTA, 0);

  const mixedInterest = calculateTaxComparison(
    makeInputs({ grossSalary: 1_400_000, savingsInterest: 4_000, fdInterest: 25_000 })
  );
  assert.equal(mixedInterest.oldRegime.eligible80TTA, 4_000);
});

test('Case 11: Standard deduction is capped at salary when gross salary < statutory deduction', () => {
  const comp = calculateTaxComparison(
    makeInputs({ grossSalary: 40_000, fdInterest: 200_000 })
  );
  assert.equal(comp.newRegime.standardDeduction, 40_000);
  assert.equal(comp.oldRegime.standardDeduction, 40_000);
  assert.equal(comp.newRegime.netSalaryIncome, 0);
  assert.equal(comp.oldRegime.netSalaryIncome, 0);
});

test('Case 12: TDS greater than tax liability produces exact refundDue and zero netTaxPayable', () => {
  const comp = calculateTaxComparison(
    makeInputs({
      grossSalary: 1_200_000,
      savingsInterest: 10_000,
      fdInterest: 15_000,
      tdsClaimed: 60_000,
    })
  );
  assert.equal(comp.newRegime.totalTaxLiability, 0);
  assert.equal(comp.newRegime.refundDue, 60_000);
  assert.equal(comp.newRegime.netTaxPayable, 0);
});

test('Case 13: TDS less than tax liability produces rounded netTaxPayable and zero refundDue', () => {
  const comp = calculateTaxComparison(
    makeInputs({ grossSalary: 2_000_000, tdsClaimed: 100_000 })
  );
  assert.equal(comp.newRegime.totalTaxLiability, 192_400);
  assert.equal(comp.newRegime.netTaxPayable, 92_400);
  assert.equal(comp.newRegime.refundDue, 0);
});

test('Case 14: Unsupported scenario rejection across income > ₹50L, capital gains, crypto, multiple employers, house property, and senior citizen age ≥ 60', () => {
  // 14a. Total income > ₹50,00,000 blocked in validateReturnData
  const highIncomeInputs = makeInputs({ grossSalary: 5_500_000, tdsClaimed: 1_000_000 });
  const valHigh = validateReturnData(VALID_PROFILE, highIncomeInputs, 'new', [], []);
  assert.equal(valHigh.isValid, false);
  assert.ok(valHigh.issues.some((i) => i.code === 'ITR1_INCOME_CAP'));

  // 14b. Senior citizen (DOB 1960 -> age >= 60 in FY 2025-26) blocked per YAML scope
  const seniorProfile: UserProfile = { ...VALID_PROFILE, dateOfBirth: '1960-05-10' };
  const ageFlag = detectAgeScopeViolation(seniorProfile.dateOfBirth);
  assert.ok(ageFlag);
  assert.equal(ageFlag.code, 'UNSUPPORTED_SENIOR_CITIZEN');

  const normalInputs = makeInputs({ grossSalary: 1_200_000, tdsClaimed: 60_000 });
  const valSenior = validateReturnData(seniorProfile, normalInputs, 'new', [], []);
  assert.equal(valSenior.isValid, false);
  assert.ok(
    valSenior.unsupportedScenarios.some((u) => u.code === 'UNSUPPORTED_SENIOR_CITIZEN')
  );

  // 14c. Text-detected unsupported categories
  assert.equal(
    detectUnsupportedFilingScenario('Sold mutual funds with long term capital gains')?.code,
    'UNSUPPORTED_CAPITAL_GAINS'
  );
  assert.equal(
    detectUnsupportedFilingScenario('Earned profit from Bitcoin VDA crypto')?.code,
    'UNSUPPORTED_VDA_CRYPTO'
  );
  assert.equal(
    detectUnsupportedFilingScenario('Switched jobs and have two Form 16s from multiple employers')?.code,
    'UNSUPPORTED_MULTIPLE_EMPLOYERS'
  );
  assert.ok(
    detectUnsupportedFilingScenario('Paying home loan interest on house property u/s 24(b)')?.code.includes(
      'HOUSE'
    )
  );
  assert.equal(
    detectUnsupportedFilingScenario('Received foreign income from overseas bank')?.code,
    'UNSUPPORTED_FOREIGN_OR_NRI'
  );
});
