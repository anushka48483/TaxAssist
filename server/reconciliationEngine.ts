import {
  DocumentCategory,
  DOCUMENT_CATEGORY_LABELS,
  ReconciliationItem,
  ReconciliationReport,
  ReturnFinancialInputs,
  UploadedDocument,
} from '../src/shared/types.js';

const CORE_EXPECTED_CATEGORIES: DocumentCategory[] = [
  'form_16',
  'bank_statements',
  'investment_proofs',
];

const OPTIONAL_RECOMMENDED_CATEGORIES: DocumentCategory[] = [
  'form_26as',
  'ais',
];

function findExtractedDoc(
  documents: UploadedDocument[],
  categories: DocumentCategory[]
): UploadedDocument | undefined {
  return documents.find(
    (d) =>
      categories.includes(d.category) &&
      d.processingStatus === 'extracted' &&
      d.agentAccessAllowed !== false
  );
}

function findExtractedDocs(
  documents: UploadedDocument[],
  categories: DocumentCategory[]
): UploadedDocument[] {
  return documents.filter(
    (d) =>
      categories.includes(d.category) &&
      d.processingStatus === 'extracted' &&
      d.agentAccessAllowed !== false
  );
}

function findFactRef(
  doc: UploadedDocument | undefined,
  fieldKey: string,
  fallbackSnippet: string
): { page: number | null; snippet: string } {
  if (!doc) return { page: null, snippet: fallbackSnippet };
  const fact = doc.extractedFacts.find((f) => f.field === fieldKey);
  if (fact) {
    return {
      page: fact.pageNumber,
      snippet: fact.sourceSnippet,
    };
  }
  return {
    page: 1,
    snippet: fallbackSnippet,
  };
}

/**
 * Deduplicates extracted values across multiple documents (e.g., Bank Statement + AIS/TIS, or
 * FD Certificate + Bank Statement) so identical reported figures are NEVER double-counted!
 */
function aggregateDeduplicatedField(
  docs: UploadedDocument[],
  extractor: (doc: UploadedDocument) => number | undefined
): {
  deduplicatedTotal: number;
  rawSum: number;
  hasDuplicateAcrossDocs: boolean;
  primaryDoc?: UploadedDocument;
  secondaryDoc?: UploadedDocument;
} {
  const nonZero = docs
    .map((doc) => ({ doc, val: extractor(doc) ?? 0 }))
    .filter((entry) => entry.val > 0);

  if (nonZero.length === 0) {
    return { deduplicatedTotal: 0, rawSum: 0, hasDuplicateAcrossDocs: false };
  }
  if (nonZero.length === 1) {
    return {
      deduplicatedTotal: nonZero[0].val,
      rawSum: nonZero[0].val,
      hasDuplicateAcrossDocs: false,
      primaryDoc: nonZero[0].doc,
    };
  }

  const rawSum = nonZero.reduce((acc, item) => acc + item.val, 0);
  // Check if AIS/TIS mirrors a primary statement or if two files report the exact same amount
  const aisEntry = nonZero.find((e) => e.doc.category === 'ais' || e.doc.category === 'tis');
  const primaryEntries = nonZero.filter(
    (e) => e.doc.category !== 'ais' && e.doc.category !== 'tis'
  );

  if (aisEntry && primaryEntries.length > 0) {
    const primarySum = primaryEntries.reduce((acc, item) => acc + item.val, 0);
    return {
      deduplicatedTotal: Math.max(primarySum, aisEntry.val),
      rawSum,
      hasDuplicateAcrossDocs: true,
      primaryDoc: primaryEntries[0].doc,
      secondaryDoc: aisEntry.doc,
    };
  }

  // Check exact duplicate amount across distinct files of same/related category
  const uniqueValues = new Set(nonZero.map((e) => e.val));
  if (uniqueValues.size < nonZero.length) {
    const dedup = Array.from(uniqueValues).reduce((a, b) => a + b, 0);
    return {
      deduplicatedTotal: dedup,
      rawSum,
      hasDuplicateAcrossDocs: true,
      primaryDoc: nonZero[0].doc,
      secondaryDoc: nonZero[1].doc,
    };
  }

  return {
    deduplicatedTotal: rawSum,
    rawSum,
    hasDuplicateAcrossDocs: false,
    primaryDoc: nonZero[0].doc,
    secondaryDoc: nonZero[1]?.doc,
  };
}

/**
 * Documented Financial Reconciliation Engine:
 * - Strictly separates Savings Bank Interest (`savingsInterest`) from Fixed Deposit Interest (`fdInterest`).
 * - Detects cross-document duplicate entries (e.g. Bank Statement + AIS) so income is never double-counted.
 * - Never silently overwrites conflicting figures without user confirmation or approval.
 */
export function reconcileDocumentsAndReturn(
  documents: UploadedDocument[],
  currentInputs: ReturnFinancialInputs
): ReconciliationReport {
  const items: ReconciliationItem[] = [];

  const extractedCategories = new Set(
    documents.filter((d) => d.processingStatus === 'extracted').map((d) => d.category)
  );

  const missingCategories: DocumentCategory[] = [];
  for (const cat of [...CORE_EXPECTED_CATEGORIES, ...OPTIONAL_RECOMMENDED_CATEGORIES]) {
    if (!extractedCategories.has(cat)) {
      if (cat === 'bank_statements' && extractedCategories.has('interest_certificates')) continue;
      if (cat === 'ais' && extractedCategories.has('tis')) continue;
      missingCategories.push(cat);
    }
  }

  const form16 = findExtractedDoc(documents, ['form_16']);
  const salarySlips = findExtractedDoc(documents, ['salary_slips']);
  const interestDocs = findExtractedDocs(documents, [
    'bank_statements',
    'interest_certificates',
    'ais',
    'tis',
  ]);
  const invProofs = findExtractedDoc(documents, ['investment_proofs']);
  const form26as = findExtractedDoc(documents, ['form_26as']);

  // 1. Form 16 vs Salary Slips (or Return Draft)
  if (form16 && salarySlips) {
    const f16Salary = form16.structuredData.grossSalary ?? 0;
    const slipSalary = salarySlips.structuredData.grossSalary ?? 0;
    const variance = Math.abs(f16Salary - slipSalary);
    const refA = findFactRef(form16, 'grossSalary', 'Part B Gross Salary u/s 17(1)');
    const refB = findFactRef(salarySlips, 'grossSalary', 'Annualized Payslip Total');

    items.push({
      id: 'rec-salary-f16-slips',
      category: 'Salary Income',
      title: 'Gross Salary: Form 16 vs Salary Slips',
      severity: variance === 0 ? 'matched' : 'conflict',
      resolutionStatus:
        variance === 0 || currentInputs.grossSalary === f16Salary
          ? 'resolved'
          : 'needs_clarification',
      sourceALabel: 'Form 16 (Part B)',
      sourceADocName: form16.fileName,
      sourceAPage: refA.page,
      sourceASnippet: refA.snippet,
      sourceAValue: f16Salary,
      sourceBLabel: 'Salary Slips',
      sourceBDocName: salarySlips.fileName,
      sourceBPage: refB.page,
      sourceBSnippet: refB.snippet,
      sourceBValue: slipSalary,
      varianceAmount: variance,
      reconciliationRule:
        'RULE-SAL-01: Employer Form 16 Part B is statutory salary certificate u/s 203; variances with payslips require taxpayer confirmation.',
      explanation:
        variance === 0
          ? 'Form 16 gross salary matches salary slips.'
          : `Difference of ₹${variance.toLocaleString('en-IN')} between Form 16 (₹${f16Salary.toLocaleString('en-IN')}) and Salary Slips (₹${slipSalary.toLocaleString('en-IN')}).`,
      clarificationPrompt:
        variance > 0
          ? `Should we confirm ₹${f16Salary.toLocaleString('en-IN')} from Form 16 or ₹${slipSalary.toLocaleString('en-IN')} from Salary Slips as your Gross Salary?`
          : undefined,
      recommendedAction:
        currentInputs.grossSalary !== f16Salary && f16Salary > 0
          ? {
              label: `Confirm Form 16 Salary (₹${f16Salary.toLocaleString('en-IN')})`,
              fieldToUpdate: 'grossSalary',
              proposedValue: f16Salary,
              reason: `Reconciled Schedule S Gross Salary with ${form16.fileName} (Page ${refA.page ?? 1}).`,
            }
          : undefined,
    });
  } else if (form16) {
    const f16Salary = form16.structuredData.grossSalary ?? 0;
    const variance = Math.abs(f16Salary - currentInputs.grossSalary);
    const refA = findFactRef(form16, 'grossSalary', 'Part B Gross Salary u/s 17(1)');
    items.push({
      id: 'rec-salary-f16-return',
      category: 'Salary Income',
      title: 'Gross Salary: Form 16 vs Active Return State',
      severity: variance === 0 ? 'matched' : 'conflict',
      resolutionStatus: variance === 0 ? 'resolved' : 'needs_clarification',
      sourceALabel: 'Form 16 (Part B)',
      sourceADocName: form16.fileName,
      sourceAPage: refA.page,
      sourceASnippet: refA.snippet,
      sourceAValue: f16Salary,
      sourceBLabel: 'Active Return Draft',
      sourceBDocName: 'Return State (Schedule S)',
      sourceBPage: null,
      sourceBSnippet: `Declared Gross Salary: ₹${currentInputs.grossSalary.toLocaleString('en-IN')}`,
      sourceBValue: currentInputs.grossSalary,
      varianceAmount: variance,
      reconciliationRule:
        'RULE-SAL-02: Schedule S Gross Salary must match certified Form 16 Part B.',
      explanation:
        variance === 0
          ? `Form 16 Gross Salary (₹${f16Salary.toLocaleString('en-IN')}) is synced with the return draft.`
          : `Form 16 reports ₹${f16Salary.toLocaleString('en-IN')}, whereas the return draft currently holds ₹${currentInputs.grossSalary.toLocaleString('en-IN')}.`,
      recommendedAction:
        variance > 0
          ? {
              label: `Sync Salary to Form 16 (₹${f16Salary.toLocaleString('en-IN')})`,
              fieldToUpdate: 'grossSalary',
              proposedValue: f16Salary,
              reason: `Sync Gross Salary from ${form16.fileName} (Page ${refA.page ?? 1}).`,
            }
          : undefined,
    });
  }

  // 2. Form 16 TDS vs Form 26AS (or Return Draft)
  if (form16 && form26as) {
    const f16Tds = form16.structuredData.tdsOnSalary ?? 0;
    const tr26asTds = form26as.structuredData.totalTdsCredited26AS ?? 0;
    const variance = Math.abs(f16Tds - tr26asTds);
    const refA = findFactRef(form16, 'tdsOnSalary', 'Part A Total Tax Deducted & Deposited');
    const refB = findFactRef(form26as, 'totalTdsCredited26AS', 'Part A1 Tax Credited');

    items.push({
      id: 'rec-tds-f16-26as',
      category: 'TDS Verification',
      title: 'Tax Deducted at Source: Form 16 vs Form 26AS',
      severity: variance === 0 ? 'matched' : 'conflict',
      resolutionStatus:
        currentInputs.tdsClaimed === tr26asTds ? 'resolved' : 'needs_clarification',
      sourceALabel: 'Form 16 (Part A)',
      sourceADocName: form16.fileName,
      sourceAPage: refA.page,
      sourceASnippet: refA.snippet,
      sourceAValue: f16Tds,
      sourceBLabel: 'Form 26AS (TRACES)',
      sourceBDocName: form26as.fileName,
      sourceBPage: refB.page,
      sourceBSnippet: refB.snippet,
      sourceBValue: tr26asTds,
      varianceAmount: variance,
      reconciliationRule:
        'RULE-TDS-01: Under Section 199 & Rule 37BA, TDS credit is granted strictly up to verified TRACES Form 26AS entries.',
      explanation:
        variance === 0
          ? 'Form 16 TDS matches Form 26AS tax credit.'
          : `Form 16 reports ₹${f16Tds.toLocaleString('en-IN')} while Form 26AS shows ₹${tr26asTds.toLocaleString('en-IN')}.`,
      clarificationPrompt:
        variance > 0
          ? `Form 26AS shows ₹${tr26asTds.toLocaleString('en-IN')} TDS credit vs ₹${f16Tds.toLocaleString('en-IN')} in Form 16. Confirm updating TDS credit to ₹${tr26asTds.toLocaleString('en-IN')}?`
          : undefined,
      recommendedAction:
        currentInputs.tdsClaimed !== tr26asTds && tr26asTds > 0
          ? {
              label: `Sync TDS to Form 26AS (₹${tr26asTds.toLocaleString('en-IN')})`,
              fieldToUpdate: 'tdsClaimed',
              proposedValue: tr26asTds,
              reason: `Reconciled Schedule TDS with ${form26as.fileName} (Page ${refB.page ?? 1}).`,
            }
          : undefined,
    });
  } else if (form16) {
    const f16Tds = form16.structuredData.tdsOnSalary ?? 0;
    const refA = findFactRef(form16, 'tdsOnSalary', 'Part A Total Tax Deducted & Deposited');
    items.push({
      id: 'rec-tds-f16-only',
      category: 'TDS Verification',
      title: 'Salary TDS: Form 16 Part A vs Active Return',
      severity: f16Tds === currentInputs.tdsClaimed ? 'matched' : 'conflict',
      resolutionStatus: f16Tds === currentInputs.tdsClaimed ? 'resolved' : 'needs_clarification',
      sourceALabel: 'Form 16 (Part A)',
      sourceADocName: form16.fileName,
      sourceAPage: refA.page,
      sourceASnippet: refA.snippet,
      sourceAValue: f16Tds,
      sourceBLabel: 'Active Return Draft',
      sourceBDocName: 'Schedule TDS',
      sourceBPage: null,
      sourceBSnippet: `TDS Claimed: ₹${currentInputs.tdsClaimed.toLocaleString('en-IN')}`,
      sourceBValue: currentInputs.tdsClaimed,
      varianceAmount: Math.abs(f16Tds - currentInputs.tdsClaimed),
      reconciliationRule:
        'RULE-TDS-02: Form 16 Part A certifies employer TDS; cross-verify against Form 26AS if available.',
      explanation:
        f16Tds === currentInputs.tdsClaimed
          ? `TDS of ₹${f16Tds.toLocaleString('en-IN')} from Form 16 is recorded.`
          : `Form 16 certifies ₹${f16Tds.toLocaleString('en-IN')} TDS, while return draft has ₹${currentInputs.tdsClaimed.toLocaleString('en-IN')}.`,
      recommendedAction:
        f16Tds !== currentInputs.tdsClaimed && f16Tds > 0
          ? {
              label: `Include Form 16 TDS (₹${f16Tds.toLocaleString('en-IN')})`,
              fieldToUpdate: 'tdsClaimed',
              proposedValue: f16Tds,
              reason: `Include verified TDS from ${form16.fileName} (Page ${refA.page ?? 1}).`,
            }
          : undefined,
    });
  }

  // 3A. SEPARATE Savings Bank Interest Reconciliation (Eligible for Section 80TTA in Old Regime)
  const savingsAgg = aggregateDeduplicatedField(
    interestDocs,
    (d) => d.structuredData.savingsBankInterest ?? d.structuredData.aisReportedSavingsInterest
  );

  if (savingsAgg.deduplicatedTotal > 0 || currentInputs.savingsInterest > 0) {
    const docSavings = savingsAgg.deduplicatedTotal;
    const variance = Math.abs(currentInputs.savingsInterest - docSavings);
    const pDoc = savingsAgg.primaryDoc;
    const refA = findFactRef(pDoc, 'savingsBankInterest', 'Savings Account Interest Credits');

    if (savingsAgg.hasDuplicateAcrossDocs && savingsAgg.secondaryDoc) {
      items.push({
        id: 'rec-savings-duplicate-guard',
        category: 'Duplicate Income Guard',
        title: 'Savings Interest Deduplicated Across Multiple Documents',
        severity: 'duplicate_detected',
        resolutionStatus: 'resolved',
        sourceALabel: pDoc ? DOCUMENT_CATEGORY_LABELS[pDoc.category] : 'Primary Statement',
        sourceADocName: pDoc?.fileName ?? 'Statement',
        sourceAPage: refA.page,
        sourceASnippet: refA.snippet,
        sourceAValue: docSavings,
        sourceBLabel: DOCUMENT_CATEGORY_LABELS[savingsAgg.secondaryDoc.category],
        sourceBDocName: savingsAgg.secondaryDoc.fileName,
        sourceBPage: 1,
        sourceBSnippet: `Overlapping report detected (Raw sum ₹${savingsAgg.rawSum.toLocaleString('en-IN')} -> Deduplicated ₹${docSavings.toLocaleString('en-IN')})`,
        sourceBValue: savingsAgg.rawSum - docSavings,
        varianceAmount: 0,
        reconciliationRule:
          'RULE-DEDUP-SAV: Identical savings interest appearing in both Bank Statement and AIS/secondary file is deduplicated to prevent double taxation.',
        explanation: `Detected overlapping ₹${docSavings.toLocaleString('en-IN')} savings interest across ${pDoc?.fileName} and ${savingsAgg.secondaryDoc.fileName}; deduplicated to ₹${docSavings.toLocaleString('en-IN')}.`,
      });
    }

    items.push({
      id: 'rec-interest-bank-return',
      category: 'Savings Bank Interest (80TTA Eligible)',
      title: 'Savings Bank Interest: Bank Statement vs Declared Schedule OS (SAV)',
      severity: variance === 0 ? 'matched' : 'conflict',
      resolutionStatus: variance === 0 ? 'resolved' : 'needs_clarification',
      sourceALabel: pDoc ? DOCUMENT_CATEGORY_LABELS[pDoc.category] : 'Bank Statement',
      sourceADocName: pDoc?.fileName ?? 'Not Uploaded',
      sourceAPage: refA.page,
      sourceASnippet: refA.snippet,
      sourceAValue: docSavings,
      sourceBLabel: 'Active Return (Savings Interest)',
      sourceBDocName: 'Schedule OS — SAV',
      sourceBPage: null,
      sourceBSnippet: `Declared Savings Interest: ₹${currentInputs.savingsInterest.toLocaleString('en-IN')}`,
      sourceBValue: currentInputs.savingsInterest,
      varianceAmount: variance,
      reconciliationRule:
        'RULE-INT-SAV: Savings bank interest is tracked separately from FD interest because Section 80TTA (up to ₹10,000 in Old Regime) applies strictly to savings interest.',
      explanation:
        variance === 0
          ? `Savings bank interest of ₹${docSavings.toLocaleString('en-IN')} is confirmed in Schedule OS (SAV).`
          : `${pDoc?.fileName ?? 'Uploaded statement'} reports ₹${docSavings.toLocaleString('en-IN')} in Savings Bank Interest, whereas declared savings interest in the return is ₹${currentInputs.savingsInterest.toLocaleString('en-IN')}.`,
      clarificationPrompt:
        variance > 0
          ? `Your ${pDoc?.fileName ?? 'bank statement'} shows ₹${docSavings.toLocaleString('en-IN')} in Savings Bank Interest not yet confirmed in your return. Should I include ₹${docSavings.toLocaleString('en-IN')} as Savings Interest (eligible for Section 80TTA in Old Regime)?`
          : undefined,
      recommendedAction:
        variance > 0 && docSavings > 0
          ? {
              label: `Include Savings Interest (₹${docSavings.toLocaleString('en-IN')})`,
              fieldToUpdate: 'savingsInterest',
              proposedValue: docSavings,
              reason: `Confirmed inclusion of ₹${docSavings.toLocaleString('en-IN')} Savings Bank Interest from ${pDoc?.fileName ?? 'Bank Statement'} (Page ${refA.page ?? 1}).`,
            }
          : undefined,
    });
  }

  // 3B. SEPARATE Fixed Deposit (FD) Interest Reconciliation (Excluded from Section 80TTA!)
  const fdAgg = aggregateDeduplicatedField(
    interestDocs,
    (d) => d.structuredData.fdInterest ?? d.structuredData.aisReportedFdInterest
  );

  if (fdAgg.deduplicatedTotal > 0 || currentInputs.fdInterest > 0) {
    const docFd = fdAgg.deduplicatedTotal;
    const variance = Math.abs(currentInputs.fdInterest - docFd);
    const pDoc = fdAgg.primaryDoc;
    const refA = findFactRef(pDoc, 'fdInterest', 'Fixed Deposit Interest Certificate');

    if (fdAgg.hasDuplicateAcrossDocs && fdAgg.secondaryDoc) {
      items.push({
        id: 'rec-fd-duplicate-guard',
        category: 'Duplicate Income Guard',
        title: 'Fixed Deposit Interest Deduplicated Across Multiple Documents',
        severity: 'duplicate_detected',
        resolutionStatus: 'resolved',
        sourceALabel: pDoc ? DOCUMENT_CATEGORY_LABELS[pDoc.category] : 'FD Certificate',
        sourceADocName: pDoc?.fileName ?? 'FD Certificate',
        sourceAPage: refA.page,
        sourceASnippet: refA.snippet,
        sourceAValue: docFd,
        sourceBLabel: DOCUMENT_CATEGORY_LABELS[fdAgg.secondaryDoc.category],
        sourceBDocName: fdAgg.secondaryDoc.fileName,
        sourceBPage: 1,
        sourceBSnippet: `Overlapping FD interest deduplicated to ₹${docFd.toLocaleString('en-IN')}`,
        sourceBValue: fdAgg.rawSum - docFd,
        varianceAmount: 0,
        reconciliationRule:
          'RULE-DEDUP-FD: Identical FD interest across FD Certificate and AIS/Bank summary is deduplicated.',
        explanation: `Deduplicated overlapping ₹${docFd.toLocaleString('en-IN')} Fixed Deposit interest across ${pDoc?.fileName} and ${fdAgg.secondaryDoc.fileName}.`,
      });
    }

    items.push({
      id: 'rec-fd-interest-return',
      category: 'Fixed Deposit Interest (Non-80TTA)',
      title: 'Fixed Deposit Interest: FD Certificate vs Declared Schedule OS (IFD)',
      severity: variance === 0 ? 'matched' : 'conflict',
      resolutionStatus: variance === 0 ? 'resolved' : 'needs_clarification',
      sourceALabel: pDoc ? DOCUMENT_CATEGORY_LABELS[pDoc.category] : 'FD Interest Certificate',
      sourceADocName: pDoc?.fileName ?? 'Not Uploaded',
      sourceAPage: refA.page,
      sourceASnippet: refA.snippet,
      sourceAValue: docFd,
      sourceBLabel: 'Active Return (FD Interest)',
      sourceBDocName: 'Schedule OS — IFD',
      sourceBPage: null,
      sourceBSnippet: `Declared FD Interest: ₹${currentInputs.fdInterest.toLocaleString('en-IN')} (80TTA Ineligible)`,
      sourceBValue: currentInputs.fdInterest,
      varianceAmount: variance,
      reconciliationRule:
        'RULE-INT-FD: Fixed deposit interest is fully taxable in both regimes and strictly excluded from Section 80TTA deduction.',
      explanation:
        variance === 0
          ? `Fixed Deposit interest of ₹${docFd.toLocaleString('en-IN')} is confirmed separately in Schedule OS (IFD).`
          : `${pDoc?.fileName ?? 'FD Certificate'} reports ₹${docFd.toLocaleString('en-IN')} in Fixed Deposit Interest, whereas declared FD interest in the return is ₹${currentInputs.fdInterest.toLocaleString('en-IN')}.`,
      clarificationPrompt:
        variance > 0
          ? `Your ${pDoc?.fileName ?? 'FD certificate'} shows ₹${docFd.toLocaleString('en-IN')} in Fixed Deposit Interest. Should I include ₹${docFd.toLocaleString('en-IN')} separately under Fixed Deposit Interest (taxable in both regimes, excluded from 80TTA)?`
          : undefined,
      recommendedAction:
        variance > 0 && docFd > 0
          ? {
              label: `Include FD Interest (₹${docFd.toLocaleString('en-IN')})`,
              fieldToUpdate: 'fdInterest',
              proposedValue: docFd,
              reason: `Confirmed inclusion of ₹${docFd.toLocaleString('en-IN')} Fixed Deposit Interest from ${pDoc?.fileName ?? 'FD Certificate'} (Page ${refA.page ?? 1}).`,
            }
          : undefined,
    });
  }

  // 4. Investment Declarations (Form 16) vs Investment Proofs (80C & 80D)
  if (invProofs) {
    const f16_80C = form16?.structuredData.section80CDeclared ?? 0;
    const proof_80C = invProofs.structuredData.section80CProofTotal ?? 0;
    const eligibleProof80C = Math.min(proof_80C, 150_000);
    const varianceWithReturn = Math.abs(currentInputs.section80C - eligibleProof80C);
    const varianceWithF16 = Math.abs(f16_80C - proof_80C);

    const refA = form16
      ? findFactRef(form16, 'section80CDeclared', 'Form 16 Chapter VI-A Section 80C')
      : { page: null, snippet: 'Form 16 not uploaded' };
    const refB = findFactRef(invProofs, 'section80CProofTotal', 'Section 80C Investment Receipts');

    items.push({
      id: 'rec-80c-f16-proofs',
      category: 'Section 80C Deductions',
      title: 'Section 80C Investments: Form 16 Declaration vs Investment Proofs',
      severity:
        varianceWithReturn === 0
          ? 'matched'
          : proof_80C < f16_80C
            ? 'missing_proof'
            : 'conflict',
      resolutionStatus: varianceWithReturn === 0 ? 'resolved' : 'needs_clarification',
      sourceALabel: form16 ? 'Form 16 Declared 80C' : 'Active Return 80C',
      sourceADocName: form16 ? form16.fileName : 'Return State',
      sourceAPage: refA.page,
      sourceASnippet:
        varianceWithReturn === 0
          ? `Confirmed in Return: ₹${currentInputs.section80C.toLocaleString('en-IN')} (Form 16 had ₹${f16_80C.toLocaleString('en-IN')})`
          : refA.snippet,
      sourceAValue: varianceWithReturn === 0 ? currentInputs.section80C : f16_80C,
      sourceBLabel: 'Uploaded Investment Proofs',
      sourceBDocName: invProofs.fileName,
      sourceBPage: refB.page,
      sourceBSnippet: refB.snippet,
      sourceBValue: proof_80C,
      varianceAmount: varianceWithReturn === 0 ? 0 : varianceWithF16 || varianceWithReturn,
      reconciliationRule:
        'RULE-80C-01: Verified investment proofs paid during FY 2025-26 are claimable u/s 80C up to ₹1,50,000 under Old Regime even if omitted before employer Form 16 cutoff.',
      explanation:
        varianceWithReturn === 0
          ? `Section 80C investments of ₹${eligibleProof80C.toLocaleString('en-IN')} backed by ${invProofs.fileName} are recorded in the return state.`
          : `Form 16 declared ₹${f16_80C.toLocaleString('en-IN')} u/s 80C, while ${invProofs.fileName} provides verified proofs of ₹${proof_80C.toLocaleString('en-IN')} (eligible cap ₹${eligibleProof80C.toLocaleString('en-IN')} under Old Regime).`,
      clarificationPrompt:
        varianceWithReturn > 0
          ? `Your investment proof (${invProofs.fileName}) shows ₹${proof_80C.toLocaleString('en-IN')} in Section 80C investments (Form 16 had ₹${f16_80C.toLocaleString('en-IN')}). Should I include ₹${eligibleProof80C.toLocaleString('en-IN')} for Old vs New regime comparison?`
          : undefined,
      recommendedAction:
        varianceWithReturn > 0 && eligibleProof80C > 0
          ? {
              label: `Include Verified 80C Proofs (₹${eligibleProof80C.toLocaleString('en-IN')})`,
              fieldToUpdate: 'section80C',
              proposedValue: eligibleProof80C,
              reason: `Claim verified Section 80C proofs from ${invProofs.fileName} (Page ${refB.page ?? 1}), capped at ₹1,50,000.`,
            }
          : undefined,
    });

    const proof_80D = invProofs.structuredData.section80DProofTotal ?? 0;
    if (proof_80D > 0) {
      const f16_80D = form16?.structuredData.section80DDeclared ?? 0;
      const var80D = Math.abs(currentInputs.section80D - proof_80D);
      const ref80DB = findFactRef(invProofs, 'section80DProofTotal', 'Section 80D Health Policy');

      items.push({
        id: 'rec-80d-proofs',
        category: 'Section 80D Health Insurance',
        title: 'Section 80D Medical Insurance: Form 16 vs Policy Proof',
        severity: var80D === 0 ? 'matched' : 'conflict',
        resolutionStatus: var80D === 0 ? 'resolved' : 'needs_clarification',
        sourceALabel: 'Form 16 / Active Return',
        sourceADocName: form16 ? form16.fileName : 'Return State',
        sourceAPage: 1,
        sourceASnippet: `Declared 80D: ₹${currentInputs.section80D.toLocaleString('en-IN')} (Form 16: ₹${f16_80D.toLocaleString('en-IN')})`,
        sourceAValue: currentInputs.section80D,
        sourceBLabel: 'Uploaded Policy Proof',
        sourceBDocName: invProofs.fileName,
        sourceBPage: ref80DB.page,
        sourceBSnippet: ref80DB.snippet,
        sourceBValue: proof_80D,
        varianceAmount: var80D,
        reconciliationRule:
          'RULE-80D-01: Non-cash medical insurance premiums u/s 80D are deductible up to ₹25,000 (self/family <60) + ₹25k/₹50k (parents) in Old Regime.',
        explanation:
          var80D === 0
            ? `Section 80D medical insurance of ₹${proof_80D.toLocaleString('en-IN')} is reconciled.`
            : `Uploaded proof shows ₹${proof_80D.toLocaleString('en-IN')} u/s 80D vs ₹${currentInputs.section80D.toLocaleString('en-IN')} in the return.`,
        recommendedAction:
          var80D > 0
            ? {
                label: `Update 80D to ₹${proof_80D.toLocaleString('en-IN')}`,
                fieldToUpdate: 'section80D',
                proposedValue: proof_80D,
                reason: `Reconcile Section 80D with ${invProofs.fileName}.`,
              }
            : undefined,
      });
    }
  }

  // 5. Missing Documents Checklist
  for (const missingCat of missingCategories) {
    const isCore = CORE_EXPECTED_CATEGORIES.includes(missingCat);
    items.push({
      id: `rec-missing-${missingCat}`,
      category: 'Document Checklist',
      title: `${isCore ? 'Missing Core Document' : 'Optional Cross-Check Document'}: ${DOCUMENT_CATEGORY_LABELS[missingCat]}`,
      severity: 'missing_document',
      resolutionStatus: 'missing',
      sourceALabel: 'Filing Checklist',
      sourceADocName: DOCUMENT_CATEGORY_LABELS[missingCat],
      sourceAPage: null,
      sourceASnippet: isCore
        ? 'Recommended for primary income/deduction evidence'
        : 'Recommended for TRACES/SFT cross-verification (can also confirm via chat)',
      sourceAValue: null,
      sourceBLabel: 'Document Vault',
      sourceBDocName: 'Not Uploaded',
      sourceBPage: null,
      sourceBSnippet: 'Attach in Tax Filing Assistant or Documents view',
      sourceBValue: null,
      varianceAmount: 0,
      reconciliationRule: 'RULE-DOC-01: Surface missing supporting documents transparently.',
      explanation: `${DOCUMENT_CATEGORY_LABELS[missingCat]} has not been uploaded yet. If you do not have any ${DOCUMENT_CATEGORY_LABELS[missingCat]} items or already confirmed via chat, you may proceed.`,
    });
  }

  const matchedCount = items.filter(
    (i) => i.severity === 'matched' || i.severity === 'duplicate_detected'
  ).length;
  const conflictCount = items.filter(
    (i) =>
      i.severity === 'conflict' ||
      i.severity === 'missing_proof' ||
      i.severity === 'unconfirmed_source'
  ).length;
  const duplicateCount = items.filter((i) => i.severity === 'duplicate_detected').length;
  const missingCount = items.filter((i) => i.severity === 'missing_document').length;

  return {
    generatedAt: new Date().toISOString(),
    totalChecks: items.length,
    matchedCount,
    conflictCount,
    duplicateCount,
    missingCount,
    missingCategories,
    items,
  };
}
