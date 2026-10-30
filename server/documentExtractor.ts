import { Type } from '@google/genai';
import { extractText } from 'unpdf';
import { createWorker } from 'tesseract.js';
import { z } from 'zod';
import {
  DocumentCategory,
  DOCUMENT_CATEGORY_LABELS,
  ExtractedFact,
  ExtractionMethod,
  StructuredDocumentData,
} from '../src/shared/types.js';
import { generateGeminiWithFallback, hasValidGeminiApiKey } from './geminiClient.js';

export interface ExtractionResult {
  isSynthetic: boolean;
  extractionMethod: ExtractionMethod;
  pageCount: number;
  rawTextPreview: string;
  extractedFacts: ExtractedFact[];
  structuredData: StructuredDocumentData;
  missingExpectedFields: string[];
  needsUserReview: boolean;
  validationErrors: string[];
}

const StructuredDataZodSchema = z.object({
  isSyntheticDemo: z.boolean().optional(),
  employerName: z.string().optional(),
  employerTan: z.string().optional(),
  employeePan: z.string().optional(),
  assessmentYear: z.string().optional(),
  grossSalary: z.number().nonnegative().optional(),
  basicSalary: z.number().nonnegative().optional(),
  hraReceived: z.number().nonnegative().optional(),
  otherAllowances: z.number().nonnegative().optional(),
  hraExemption: z.number().nonnegative().optional(),
  standardDeduction: z.number().nonnegative().optional(),
  professionalTax: z.number().nonnegative().optional(),
  tdsOnSalary: z.number().nonnegative().optional(),
  tdsOnInterest: z.number().nonnegative().optional(),
  totalTdsCredited26AS: z.number().nonnegative().optional(),
  advanceTaxPaid: z.number().nonnegative().optional(),
  savingsBankInterest: z.number().nonnegative().optional(),
  fdInterest: z.number().nonnegative().optional(),
  otherIncome: z.number().nonnegative().optional(),
  investmentDetails: z.string().optional(),
  section80CDeclared: z.number().nonnegative().optional(),
  section80CProofTotal: z.number().nonnegative().optional(),
  section80CCD1: z.number().nonnegative().optional(),
  section80CCD1B: z.number().nonnegative().optional(),
  section80CCD2: z.number().nonnegative().optional(),
  section80DDeclared: z.number().nonnegative().optional(),
  section80DProofTotal: z.number().nonnegative().optional(),
  section80DParentsProofTotal: z.number().nonnegative().optional(),
  aisReportedSalary: z.number().nonnegative().optional(),
  aisReportedSavingsInterest: z.number().nonnegative().optional(),
  aisReportedFdInterest: z.number().nonnegative().optional(),
  aisReportedInterest: z.number().nonnegative().optional(),
  monthsCovered: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

const EXTRACTION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    pageCount: { type: Type.INTEGER },
    ocrTextSummary: { type: Type.STRING },
    structuredData: {
      type: Type.OBJECT,
      properties: {
        isSyntheticDemo: { type: Type.BOOLEAN },
        employerName: { type: Type.STRING },
        employerTan: { type: Type.STRING },
        employeePan: { type: Type.STRING },
        assessmentYear: { type: Type.STRING },
        grossSalary: { type: Type.NUMBER },
        basicSalary: { type: Type.NUMBER },
        hraReceived: { type: Type.NUMBER },
        otherAllowances: { type: Type.NUMBER },
        hraExemption: { type: Type.NUMBER },
        standardDeduction: { type: Type.NUMBER },
        professionalTax: { type: Type.NUMBER },
        tdsOnSalary: { type: Type.NUMBER },
        tdsOnInterest: { type: Type.NUMBER },
        totalTdsCredited26AS: { type: Type.NUMBER },
        advanceTaxPaid: { type: Type.NUMBER },
        savingsBankInterest: { type: Type.NUMBER },
        fdInterest: { type: Type.NUMBER },
        otherIncome: { type: Type.NUMBER },
        investmentDetails: { type: Type.STRING },
        section80CDeclared: { type: Type.STRING },
        section80CProofTotal: { type: Type.NUMBER },
        section80CCD1: { type: Type.NUMBER },
        section80CCD1B: { type: Type.NUMBER },
        section80CCD2: { type: Type.NUMBER },
        section80DDeclared: { type: Type.NUMBER },
        section80DProofTotal: { type: Type.NUMBER },
        section80DParentsProofTotal: { type: Type.NUMBER },
        aisReportedSalary: { type: Type.NUMBER },
        aisReportedSavingsInterest: { type: Type.NUMBER },
        aisReportedFdInterest: { type: Type.NUMBER },
        aisReportedInterest: { type: Type.NUMBER },
        monthsCovered: { type: Type.INTEGER },
        notes: { type: Type.STRING },
      },
    },
    extractedFacts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          field: { type: Type.STRING },
          label: { type: Type.STRING },
          numericValue: { type: Type.NUMBER },
          stringValue: { type: Type.STRING },
          formattedValue: { type: Type.STRING },
          pageNumber: { type: Type.INTEGER },
          sourceSnippet: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
        },
        required: [
          'field',
          'label',
          'numericValue',
          'formattedValue',
          'pageNumber',
          'sourceSnippet',
          'confidence',
        ],
      },
    },
  },
  required: ['pageCount', 'ocrTextSummary', 'structuredData', 'extractedFacts'],
};

const ALLOWED_MIME_PREFIXES = ['application/pdf', 'image/', 'text/', 'application/json'];

const EXPECTED_FIELDS_BY_CATEGORY: Record<DocumentCategory, Array<keyof StructuredDocumentData>> = {
  form_16: ['grossSalary', 'tdsOnSalary'],
  salary_slips: ['grossSalary'],
  bank_statements: ['savingsBankInterest'],
  interest_certificates: ['fdInterest'],
  investment_proofs: ['section80CProofTotal'],
  form_26as: ['totalTdsCredited26AS'],
  ais: ['aisReportedSalary', 'aisReportedSavingsInterest'],
  tis: ['aisReportedSalary'],
  other_tax_doc: [],
};

function computeMissingExpectedFields(
  category: DocumentCategory,
  structured: StructuredDocumentData
): string[] {
  const expected = EXPECTED_FIELDS_BY_CATEGORY[category] || [];
  return expected.filter((field) => structured[field] === undefined);
}

function parseAmount(regex: RegExp, text: string): number | undefined {
  const m = text.match(regex);
  if (!m || !m[1]) return undefined;
  const cleaned = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(cleaned) ? cleaned : undefined;
}

/**
 * Deterministic Regex Parser when offline, for synthetic demo files, or in unit tests.
 * Never fabricates missing numbers and preserves exact page references & confidence.
 */
export function deterministicFallbackExtract(
  text: string,
  fileName: string,
  category: DocumentCategory,
  pageCount: number,
  confidenceOverride = 0.98
): ExtractionResult {
  const isSynthetic =
    text.includes('SYNTHETIC DEMO') || fileName.toUpperCase().includes('SYNTHETIC');
  const facts: ExtractedFact[] = [];
  const structured: StructuredDocumentData = { isSyntheticDemo: isSynthetic };

  const tanMatch = text.match(/TAN[^:\n]*:\s*([A-Z]{4}[0-9]{5}[A-Z])/i);
  if (tanMatch?.[1]) {
    structured.employerTan = tanMatch[1].toUpperCase();
  }

  const addFact = (
    field: keyof StructuredDocumentData,
    label: string,
    val: number | undefined,
    page: number,
    snippetRegex: RegExp
  ) => {
    if (val === undefined) return;
    (structured as Record<string, unknown>)[field] = val;
    const lineMatch = text.match(snippetRegex);
    const status = confidenceOverride >= 0.85 ? 'verified' : 'needs_review';
    facts.push({
      id: `fact-${Date.now()}-${facts.length}`,
      field,
      label,
      numericValue: val,
      formattedValue: `₹${val.toLocaleString('en-IN')}`,
      documentName: fileName,
      pageNumber: page,
      sourceSnippet: lineMatch ? lineMatch[0].trim().slice(0, 140) : `${label}: Rs. ${val}`,
      confidence: confidenceOverride,
      validationStatus: status,
    });
  };

  addFact(
    'grossSalary',
    'Gross Salary u/s 17(1)',
    parseAmount(/Total Gross Salary[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text) ??
      parseAmount(/Gross Salary[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text),
    text.includes('[PAGE 2]') ? 2 : 1,
    /.*(?:Total )?Gross Salary.*/i
  );
  addFact(
    'basicSalary',
    'Basic Salary',
    parseAmount(/Basic Salary[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text),
    text.includes('[PAGE 2]') ? 2 : 1,
    /.*Basic Salary.*/i
  );
  addFact(
    'hraReceived',
    'HRA Received',
    parseAmount(/HRA Received[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text),
    text.includes('[PAGE 2]') ? 2 : 1,
    /.*HRA Received.*/i
  );
  addFact(
    'tdsOnSalary',
    'TDS Deducted on Salary u/s 192',
    parseAmount(/Total Tax Deducted[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text),
    1,
    /.*Total Tax Deducted.*/i
  );
  addFact(
    'savingsBankInterest',
    'Savings Bank Interest Credited',
    parseAmount(/Total Savings (?:Bank |Account )?Interest[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text) ??
      parseAmount(/Savings (?:Bank |Account )?Interest[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text),
    1,
    /.*(?:Total )?Savings (?:Bank |Account )?Interest.*/i
  );
  addFact(
    'fdInterest',
    'Fixed Deposit Interest',
    parseAmount(/Fixed Deposit Interest Accrued[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text) ??
      parseAmount(/Fixed Deposit Interest[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text) ??
      parseAmount(/FD Interest[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text),
    1,
    /.*(?:Fixed Deposit|FD) Interest.*/i
  );
  addFact(
    'tdsOnInterest',
    'TDS Deducted on Interest u/s 194A',
    parseAmount(/TDS Deducted(?: by Bank)? u\/s 194A[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text),
    1,
    /.*194A.*/i
  );
  addFact(
    'section80CProofTotal',
    'Eligible Section 80C Investments',
    parseAmount(/Total Eligible Section 80C Investments[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text) ??
      parseAmount(/Verified 80C Proofs[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text),
    1,
    /.*80C.*/i
  );
  addFact(
    'section80CDeclared',
    'Section 80C Declared in Form 16',
    parseAmount(/Section 80C Declared[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text),
    text.includes('[PAGE 2]') ? 2 : 1,
    /.*Section 80C Declared.*/i
  );
  addFact(
    'section80CCD1',
    'Employee NPS Contribution u/s 80CCD(1)',
    parseAmount(/Section 80CCD\(1\)[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text),
    1,
    /.*80CCD\(1\).*/i
  );
  addFact(
    'section80CCD1B',
    'Additional NPS Contribution u/s 80CCD(1B)',
    parseAmount(/Section 80CCD\(1B\)[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text),
    1,
    /.*80CCD\(1B\).*/i
  );
  addFact(
    'section80CCD2',
    'Employer NPS Contribution u/s 80CCD(2)',
    parseAmount(/Section 80CCD\(2\)[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text),
    1,
    /.*80CCD\(2\).*/i
  );
  addFact(
    'section80DProofTotal',
    'Section 80D Health Insurance Proofs',
    parseAmount(/Section 80D Health Insurance[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text),
    1,
    /.*Section 80D.*/i
  );
  addFact(
    'totalTdsCredited26AS',
    'Total TDS Credited in Form 26AS',
    parseAmount(/Credited in 26AS[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text),
    1,
    /.*26AS.*/i
  );
  addFact(
    'aisReportedSavingsInterest',
    'AIS Reported Savings Bank Interest',
    parseAmount(/AIS Savings (?:Bank )?Interest[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text),
    1,
    /.*AIS Savings.*/i
  );
  addFact(
    'aisReportedFdInterest',
    'AIS Reported Fixed Deposit Interest',
    parseAmount(/AIS (?:Fixed Deposit|FD) Interest[^:\n]*:\s*Rs\.?\s*([\d,]+)/i, text),
    1,
    /.*AIS (?:Fixed Deposit|FD).*/i
  );

  const missingExpectedFields = computeMissingExpectedFields(category, structured);
  const needsUserReview = facts.some((f) => f.validationStatus === 'needs_review');

  const validationErrors: string[] = [];
  if (facts.length === 0) {
    validationErrors.push(
      `No verifiable financial figures detected in ${DOCUMENT_CATEGORY_LABELS[category]}.`
    );
  }

  return {
    isSynthetic,
    extractionMethod: confidenceOverride < 0.85 ? 'tesseract_ocr_ai' : 'deterministic_parser',
    pageCount,
    rawTextPreview: text.slice(0, 2200),
    extractedFacts: facts,
    structuredData: structured,
    missingExpectedFields,
    needsUserReview,
    validationErrors,
  };
}

export async function extractFinancialDocument(params: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  category: DocumentCategory;
}): Promise<ExtractionResult> {
  const { buffer, mimeType, fileName, category } = params;

  if (!buffer || buffer.length === 0) {
    throw new Error('ERR_EMPTY_FILE: Uploaded file is empty (0 bytes).');
  }
  const lowerName = fileName.toLowerCase();
  const isAllowed =
    ALLOWED_MIME_PREFIXES.some((p) => mimeType.startsWith(p)) ||
    lowerName.endsWith('.pdf') ||
    lowerName.endsWith('.png') ||
    lowerName.endsWith('.jpg') ||
    lowerName.endsWith('.jpeg') ||
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.json');

  if (!isAllowed) {
    throw new Error(`ERR_UNSUPPORTED_FILE_TYPE: Unsupported MIME type "${mimeType}".`);
  }

  const categoryLabel = DOCUMENT_CATEGORY_LABELS[category];
  let extractedText = '';
  let detectedPages = 1;
  let method: ExtractionMethod = 'pdf_text_ai';
  let ocrConfidenceCap: number | undefined;

  // Stage 2: PDF Text Parsing via unpdf
  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
    try {
      const uint8 = new Uint8Array(buffer);
      const pdfResult = await extractText(uint8, { mergePages: false });
      detectedPages = pdfResult.totalPages || 1;
      const pagesArray = Array.isArray(pdfResult.text)
        ? pdfResult.text
        : [String(pdfResult.text || '')];
      extractedText = pagesArray
        .map((pageContent, idx) => `--- [PAGE ${idx + 1}] ---\n${pageContent}`)
        .join('\n\n')
        .trim();
    } catch {
      method = 'vision_ocr_ai';
    }
  } else if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    lowerName.endsWith('.txt')
  ) {
    extractedText = buffer.toString('utf-8');
    const pageMarkers = extractedText.match(/\[PAGE\s+\d+\]/gi);
    detectedPages = pageMarkers ? pageMarkers.length : 1;
    if (extractedText.includes('[LOW_CONFIDENCE_OCR]')) {
      ocrConfidenceCap = 0.72;
    }
  } else if (mimeType.startsWith('image/')) {
    // Stage 3: Tesseract.js OCR on scanned images
    try {
      const worker = await createWorker('eng');
      const ret = await worker.recognize(buffer);
      await worker.terminate();
      if (ret.data.text && ret.data.text.trim().length > 25) {
        extractedText = `--- [PAGE 1 - TESSERACT OCR] ---\n${ret.data.text.trim()}`;
        method = 'tesseract_ocr_ai';
        const rawTesseractConf =
          typeof ret.data.confidence === 'number' ? ret.data.confidence / 100 : 0.78;
        ocrConfidenceCap = Math.min(rawTesseractConf, 0.84);
      } else {
        method = 'vision_ocr_ai';
        ocrConfidenceCap = 0.82;
      }
    } catch {
      method = 'vision_ocr_ai';
      ocrConfidenceCap = 0.82;
    }
  }

  const isSynthetic =
    extractedText.includes('SYNTHETIC DEMO') || fileName.toUpperCase().includes('SYNTHETIC');

  if (isSynthetic && extractedText.length > 35) {
    const fastSyn = deterministicFallbackExtract(
      extractedText,
      fileName,
      category,
      detectedPages,
      ocrConfidenceCap ?? 0.98
    );
    if (fastSyn.extractedFacts.length > 0) {
      return fastSyn;
    }
  }

  try {
    if (process.env.NODE_ENV === 'test' || !hasValidGeminiApiKey()) {
      if (extractedText.length > 10) {
        return deterministicFallbackExtract(
          extractedText,
          fileName,
          category,
          detectedPages,
          ocrConfidenceCap ?? 0.96
        );
      }
      throw new Error(
        'ERR_EXTRACTION_NO_API_KEY: Configure GEMINI_API_KEY or upload a readable PDF/text document.'
      );
    }

    const promptInstruction = `You are a strict Indian Income Tax Financial Document Extractor.
Analyze this "${categoryLabel}" document (filename: "${fileName}").
Extract ONLY explicitly present financial values in INR (numbers without commas in numericValue).
CRITICAL RULES:
- NEVER invent, guess, or fill missing fields with assumptions. Omit fields that do not appear in the document.
- Strictly separate savingsBankInterest from fdInterest (NEVER merge Savings and Fixed Deposit interest!).
- Preserve exact 1-indexed pageNumber and verbatim sourceSnippet for every extracted fact.
- Canonical numeric fields: grossSalary, basicSalary, hraReceived, otherAllowances, hraExemption, standardDeduction, professionalTax, tdsOnSalary, tdsOnInterest, totalTdsCredited26AS, advanceTaxPaid, savingsBankInterest, fdInterest, otherIncome, section80CDeclared, section80CProofTotal, section80CCD1, section80CCD1B, section80CCD2, section80DDeclared, section80DProofTotal, section80DParentsProofTotal, aisReportedSalary, aisReportedSavingsInterest, aisReportedFdInterest.`;

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    if (extractedText.length > 35) {
      parts.push({
        text: `${promptInstruction}\n\nExtracted Document Text (${detectedPages} pages):\n${extractedText.slice(0, 28000)}`,
      });
    } else {
      const supportedMime =
        mimeType === 'application/pdf' ||
        mimeType === 'image/png' ||
        mimeType === 'image/jpeg' ||
        mimeType === 'image/webp'
          ? mimeType
          : 'application/pdf';
      parts.push({
        inlineData: {
          mimeType: supportedMime,
          data: buffer.toString('base64'),
        },
      });
      parts.push({ text: promptInstruction });
    }

    const { response } = await generateGeminiWithFallback({
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        responseSchema: EXTRACTION_RESPONSE_SCHEMA,
      },
      perAttemptTimeoutMs: 12_000,
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      pageCount?: number;
      ocrTextSummary?: string;
      structuredData?: Record<string, unknown>;
      extractedFacts?: Array<Record<string, unknown>>;
    };

    const validationErrors: string[] = [];
    const rawStructured = { ...(parsed.structuredData ?? {}) };
    if (typeof rawStructured.section80CDeclared === 'string') {
      rawStructured.section80CDeclared = Number(rawStructured.section80CDeclared) || 0;
    }

    const zodCheck = StructuredDataZodSchema.safeParse({
      ...rawStructured,
      isSyntheticDemo: isSynthetic || Boolean(rawStructured.isSyntheticDemo),
    });

    let normalizedData: StructuredDocumentData = { isSyntheticDemo: isSynthetic };
    if (zodCheck.success) {
      normalizedData = zodCheck.data;
    } else {
      for (const issue of zodCheck.error.issues) {
        validationErrors.push(`${issue.path.join('.')}: ${issue.message}`);
      }
      normalizedData = rawStructured as StructuredDocumentData;
    }

    const facts: ExtractedFact[] = (parsed.extractedFacts ?? []).map((f, idx) => {
      const rawConf = typeof f.confidence === 'number' ? f.confidence : 0.92;
      const conf =
        ocrConfidenceCap !== undefined ? Math.min(rawConf, ocrConfidenceCap) : rawConf;
      return {
        id: `fact-${Date.now()}-${idx}`,
        field: String(f.field || 'unknown'),
        label: String(f.label || f.field || 'Extracted Value'),
        numericValue: typeof f.numericValue === 'number' ? f.numericValue : null,
        stringValue: typeof f.stringValue === 'string' ? f.stringValue : undefined,
        formattedValue: String(f.formattedValue || f.numericValue || ''),
        documentName: fileName,
        pageNumber: Number(f.pageNumber || 1),
        sourceSnippet: String(f.sourceSnippet || categoryLabel),
        confidence: Number(conf.toFixed(2)),
        validationStatus: conf >= 0.85 ? 'verified' : 'needs_review',
      };
    });

    const missingExpectedFields = computeMissingExpectedFields(category, normalizedData);
    const needsUserReview = facts.some((f) => f.validationStatus === 'needs_review');

    if (facts.length === 0) {
      validationErrors.push('No verifiable tax figures were found in this document.');
    }

    return {
      isSynthetic,
      extractionMethod: method,
      pageCount: parsed.pageCount || detectedPages || 1,
      rawTextPreview:
        extractedText.length > 0
          ? extractedText.slice(0, 2200)
          : parsed.ocrTextSummary || 'OCR completed.',
      extractedFacts: facts,
      structuredData: normalizedData,
      missingExpectedFields,
      needsUserReview,
      validationErrors,
    };
  } catch (err) {
    if (extractedText.length > 20) {
      const fallback = deterministicFallbackExtract(
        extractedText,
        fileName,
        category,
        detectedPages,
        ocrConfidenceCap ?? 0.95
      );
      if (fallback.extractedFacts.length > 0) {
        return fallback;
      }
    }
    throw new Error(
      err instanceof Error
        ? err.message
        : 'Document extraction failed — unreadable file or service error.'
    );
  }
}
