import { DocumentCategory } from '../src/shared/types.js';

export interface SyntheticDemoFile {
  fileName: string;
  category: DocumentCategory;
  mimeType: string;
  content: string;
}

/**
 * Complete 4-Document Synthetic Demo Pack (Part 9):
 * 1. Form 16: Gross Salary ₹12,00,000, Basic ₹6,00,000, TDS ₹60,000
 * 2. Bank Statement: Savings Bank Interest ₹10,000
 * 3. Fixed Deposit Certificate: Fixed Deposit Interest ₹15,000
 * 4. Investment Proof: Section 80C Investments ₹1,00,000
 *
 * Every file is explicitly watermarked as [SYNTHETIC DEMO DATA — NOT A REAL TAX DOCUMENT].
 */
export const SYNTHETIC_DEMO_FILES: SyntheticDemoFile[] = [
  {
    fileName: 'SYNTHETIC_Form16_AY2026_27.txt',
    category: 'form_16',
    mimeType: 'text/plain',
    content: `[SYNTHETIC DEMO DATA — FOR DEMONSTRATION ONLY — NOT A REAL GOVERNMENT CERTIFICATE]
--- [PAGE 1] ---
FORM NO. 16 [See rule 31(1)(a)]
PART A — Certificate under section 203 of the Income-tax Act, 1961 for Tax Deducted at Source on Salary
Certificate No: SYN-F16-2026-001
Name and Address of Employer: ASTRAVEDA DIGITAL SYSTEMS PVT LTD, Outer Ring Road, Bengaluru 560103
TAN of Deductor: BLRA99120F
PAN of Employee: SYNTP1234K
Employee Name: Rohan Deshmukh
Assessment Year: 2026-27 (Financial Year: 2025-26)
Summary of Tax Deducted & Deposited across Q1-Q4:
Total Tax Deducted & Deposited (TDS on Salary u/s 192): Rs. 60,000

--- [PAGE 2] ---
PART B (Annexure) — Details of Salary Paid and Any Other Income and Tax Deducted
1. Gross Salary:
   (a) Basic Salary: Rs. 6,00,000
   (b) House Rent Allowance (HRA Received): Rs. 2,40,000
   (c) Special & Conveyance Allowances: Rs. 3,60,000
   Total Gross Salary u/s 17(1): Rs. 12,00,000
2. Allowances Exempt u/s 10:
   House Rent Allowance Exemption u/s 10(13A): Rs. 0 (No rent receipts submitted to payroll)
3. Deductions u/s 16:
   Standard Deduction u/s 16(ia): Rs. 75,000 (New Regime Default) / Rs. 50,000 (Old Regime)
   Professional Tax u/s 16(iii): Rs. 0
4. Income under head "Income from Other Sources" reported to employer: Rs. 0
5. Chapter VI-A Deductions declared to employer before payroll cutoff:
   Section 80C Declared in Form 16: Rs. 0 (Proofs not submitted before employer cutoff)
   Section 80D Declared in Form 16: Rs. 0
[END OF SYNTHETIC FORM 16]`,
  },
  {
    fileName: 'SYNTHETIC_BankStatement_AY2026_27.txt',
    category: 'bank_statements',
    mimeType: 'text/plain',
    content: `[SYNTHETIC DEMO DATA — FOR DEMONSTRATION ONLY — NOT A REAL BANK STATEMENT]
--- [PAGE 1] ---
STATE SAVINGS BANK OF INDIA — ANNUAL SAVINGS ACCOUNT STATEMENT & INTEREST SUMMARY
Financial Year: 2025-26 (01-Apr-2025 to 31-Mar-2026) | Assessment Year: 2026-27
Account Holder: Rohan Deshmukh (PAN: SYNTP1234K)
Account Number: 409988112233 | IFSC: SBIN0004120

Quarterly Interest Credits (Savings Account):
- 30-Jun-2025 Quarterly Savings Interest Credit: Rs. 2,400
- 30-Sep-2025 Quarterly Savings Interest Credit: Rs. 2,500
- 31-Dec-2025 Quarterly Savings Interest Credit: Rs. 2,500
- 31-Mar-2026 Quarterly Savings Interest Credit: Rs. 2,600

Total Savings Bank Interest Credited in FY 2025-26: Rs. 10,000
Fixed Deposit Interest Credited in Savings Passbook: Rs. 0
TDS Deducted by Bank u/s 194A: Rs. 0
[END OF SYNTHETIC BANK STATEMENT]`,
  },
  {
    fileName: 'SYNTHETIC_FD_Certificate_AY2026_27.txt',
    category: 'interest_certificates',
    mimeType: 'text/plain',
    content: `[SYNTHETIC DEMO DATA — FOR DEMONSTRATION ONLY — NOT A REAL INTEREST CERTIFICATE]
--- [PAGE 1] ---
STATE SAVINGS BANK OF INDIA — TERM / FIXED DEPOSIT ANNUAL INTEREST CERTIFICATE
Financial Year: 2025-26 | Assessment Year: 2026-27
Depositor Name: Rohan Deshmukh | PAN: SYNTP1234K
FD Receipt Number: FD-SYN-884420 | Branch IFSC: SBIN0004120

Term Deposit Accrual & Credit Summary (FY 2025-26):
- Fixed Deposit Principal: Rs. 2,00,000 @ 7.50% p.a.
- Fixed Deposit Interest Accrued & Credited in FY 2025-26: Rs. 15,000
- Note: Fixed Deposit Interest is fully taxable under Income from Other Sources and is NOT eligible for Section 80TTA deduction.
- TDS Deducted u/s 194A: Rs. 0 (Below Rs. 50,000 / Rs. 40,000 bank TDS threshold)
[END OF SYNTHETIC FD INTEREST CERTIFICATE]`,
  },
  {
    fileName: 'SYNTHETIC_InvestmentProof_80C_AY2026_27.txt',
    category: 'investment_proofs',
    mimeType: 'text/plain',
    content: `[SYNTHETIC DEMO DATA — FOR DEMONSTRATION ONLY — NOT A REAL INVESTMENT RECEIPT]
--- [PAGE 1] ---
CONSOLIDATED TAX-SAVING INVESTMENT STATEMENT (SECTION 80C — FY 2025-26)
Investor Name: Rohan Deshmukh | PAN: SYNTP1234K | Assessment Year: 2026-27

1. Public Provident Fund (PPF) Contribution Receipt (Date: 12-Jan-2026): Rs. 40,000
2. Axis ELSS Tax Saver Fund — Lock-in 3 Years (Date: 18-Mar-2026): Rs. 60,000

Total Eligible Section 80C Investments Paid in FY 2025-26: Rs. 1,00,000
Section 80D Health Insurance Proofs Attached: Rs. 0
[END OF SYNTHETIC INVESTMENT PROOF]`,
  },
];
