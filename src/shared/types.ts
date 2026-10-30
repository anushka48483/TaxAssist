export type DocumentCategory =
  | 'form_16'
  | 'salary_slips'
  | 'bank_statements'
  | 'interest_certificates'
  | 'investment_proofs'
  | 'form_26as'
  | 'ais'
  | 'tis'
  | 'other_tax_doc';

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  form_16: 'Form 16',
  salary_slips: 'Salary Slips',
  bank_statements: 'Bank Statements',
  interest_certificates: 'FD / Interest Certificates',
  investment_proofs: 'Investment Proofs',
  form_26as: 'Form 26AS',
  ais: 'AIS (Annual Information Statement)',
  tis: 'TIS (Taxpayer Information Summary)',
  other_tax_doc: 'Other Tax Document',
};

export type ProcessingStatus =
  | 'uploaded'
  | 'validating'
  | 'parsing'
  | 'ocr_running'
  | 'extracted'
  | 'error';

export type ExtractionMethod =
  | 'pdf_text_ai'
  | 'tesseract_ocr_ai'
  | 'vision_ocr_ai'
  | 'deterministic_parser';

export type FactValidationStatus = 'verified' | 'needs_review' | 'validation_error';

export interface ExtractedFact {
  id: string;
  field: string;
  label: string;
  numericValue: number | null;
  stringValue?: string;
  formattedValue: string;
  documentName: string;
  pageNumber: number;
  sourceSnippet: string;
  confidence: number;
  validationStatus: FactValidationStatus;
}

export interface StructuredDocumentData {
  isSyntheticDemo?: boolean;
  employerName?: string;
  employerTan?: string;
  employeePan?: string;
  assessmentYear?: string;
  grossSalary?: number;
  basicSalary?: number;
  hraReceived?: number;
  otherAllowances?: number;
  hraExemption?: number;
  standardDeduction?: number;
  professionalTax?: number;
  tdsOnSalary?: number;
  tdsOnInterest?: number;
  totalTdsCredited26AS?: number;
  advanceTaxPaid?: number;
  savingsBankInterest?: number;
  fdInterest?: number;
  otherIncome?: number;
  investmentDetails?: string;
  section80CDeclared?: number;
  section80CProofTotal?: number;
  section80CCD1?: number;
  section80CCD1B?: number;
  section80CCD2?: number;
  section80DDeclared?: number;
  section80DProofTotal?: number;
  section80DParentsProofTotal?: number;
  aisReportedSalary?: number;
  aisReportedSavingsInterest?: number;
  aisReportedFdInterest?: number;
  aisReportedInterest?: number;
  monthsCovered?: number;
  notes?: string;
}

export interface UploadedDocument {
  id: string;
  sessionId: string;
  category: DocumentCategory;
  fileName: string;
  mimeType: string;
  fileSize: number;
  isSynthetic: boolean;
  uploadedAt: string;
  processingStatus: ProcessingStatus;
  extractionMethod: ExtractionMethod;
  pageCount: number;
  rawTextPreview: string;
  extractedFacts: ExtractedFact[];
  structuredData: StructuredDocumentData;
  missingExpectedFields?: string[];
  needsUserReview?: boolean;
  validationErrors: string[];
  agentAccessAllowed: boolean;
  errorMessage?: string;
}

export type ProvenanceSourceType =
  | 'document_extracted'
  | 'user_provided'
  | 'system_calculated';

export interface FinancialLedgerEntry {
  id: string;
  sessionId: string;
  sourceType: ProvenanceSourceType;
  category: 'income' | 'deduction' | 'tax_credit' | 'computed_metric';
  field: string;
  label: string;
  amount: number;
  status: 'confirmed' | 'pending_confirmation' | 'discrepancy_flagged' | 'needs_review';
  sourceDocumentName?: string;
  pageNumber?: number;
  confidence?: number;
  notes?: string;
  updatedAt: string;
}

export type TaxRegime = 'new' | 'old';

export interface UserProfile {
  fullName: string;
  pan: string;
  aadhaarLast4: string;
  dateOfBirth: string;
  residentialStatus: 'Resident (ROR)';
  email: string;
  phone: string;
  employerName: string;
  employerTan: string;
  bankName: string;
  bankIfsc: string;
  bankAccountNumber: string;
  preferredRegime: TaxRegime;
}

export interface ReturnFinancialInputs {
  grossSalary: number;
  basicSalary: number;
  hraExemption: number;
  professionalTax: number;
  savingsInterest: number;
  fdInterest: number;
  otherIncome: number;
  section80C: number;
  section80CCD1?: number;
  section80CCD1B: number;
  section80CCD2?: number;
  isGovernmentEmployer?: boolean;
  section80D: number;
  section80DParents?: number;
  hasSeniorParents?: boolean;
  tdsClaimed: number;
  advanceTax?: number;
}

export interface UnsupportedScenarioFlag {
  code: string;
  title: string;
  reason: string;
  recommendedItrForm: string;
  detectedFrom: string;
}

export interface SlabBreakdownRow {
  slabLabel: string;
  ratePercent: number;
  taxableInSlab: number;
  taxAmount: number;
}

export interface RegimeTaxComputation {
  regime: TaxRegime;
  ruleVersion: string;
  grossSalary: number;
  exemptAllowances: number;
  standardDeduction: number;
  professionalTaxDeduction: number;
  netSalaryIncome: number;
  savingsInterest: number;
  fdInterest: number;
  otherIncome: number;
  incomeFromOtherSources: number;
  grossTotalIncome: number;
  eligible80C: number;
  eligible80CCD1: number;
  eligible80CCD1B: number;
  eligible80CCD2: number;
  eligible80D: number;
  eligible80TTA: number;
  totalChapterVIADeductions: number;
  totalIncomeBeforeRounding: number;
  taxableIncome: number;
  slabBreakdown: SlabBreakdownRow[];
  taxBeforeRebate: number;
  rebate87A: number;
  marginalReliefApplied: boolean;
  taxAfterRebate: number;
  healthAndEducationCess: number;
  totalTaxLiability: number;
  tdsCredited: number;
  advanceTaxPaid: number;
  netTaxPayable: number;
  refundDue: number;
}

export interface RuleVerificationSourceEntry {
  parameter: string;
  authority: string;
  url: string;
  section: string;
  verifiedOn: string;
  snapshotVerified: boolean;
}

export interface RuleVerificationMetadata {
  rulesVersion: string;
  assessmentYear: string;
  financialYear: string;
  governingAct: string;
  verifiedOn: string;
  calculationOrder: string[];
  totalSourcesCited: number;
  unhashedSnapshotCount: number;
  verificationWarning: string | null;
  sources: RuleVerificationSourceEntry[];
}

export interface TaxComparisonSummary {
  assessmentYear: string;
  financialYear: string;
  ruleEngineVersion: string;
  newRegime: RegimeTaxComputation;
  oldRegime: RegimeTaxComputation;
  recommendedRegime: TaxRegime;
  netSavingsInRecommended: number;
  ruleVerification?: RuleVerificationMetadata;
  computedAt: string;
}

export type ReconciliationSeverity =
  | 'matched'
  | 'conflict'
  | 'missing_proof'
  | 'unconfirmed_source'
  | 'duplicate_detected'
  | 'missing_document';

export interface ReconciliationItem {
  id: string;
  category: string;
  title: string;
  severity: ReconciliationSeverity;
  resolutionStatus: 'resolved' | 'needs_clarification' | 'missing';
  sourceALabel: string;
  sourceADocName: string;
  sourceAPage: number | null;
  sourceASnippet: string;
  sourceAValue: number | null;
  sourceBLabel: string;
  sourceBDocName: string;
  sourceBPage: number | null;
  sourceBSnippet: string;
  sourceBValue: number | null;
  varianceAmount: number;
  reconciliationRule: string;
  explanation: string;
  clarificationPrompt?: string;
  recommendedAction?: {
    label: string;
    fieldToUpdate: keyof ReturnFinancialInputs;
    proposedValue: number;
    reason: string;
  };
}

export interface ReconciliationReport {
  generatedAt: string;
  totalChecks: number;
  matchedCount: number;
  conflictCount: number;
  duplicateCount?: number;
  missingCount: number;
  missingCategories: DocumentCategory[];
  items: ReconciliationItem[];
}

export interface ValidationIssue {
  code: string;
  field: string;
  severity: 'error' | 'warning' | 'pass';
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  checkedAt: string;
  errorCount: number;
  warningCount: number;
  passCount: number;
  unsupportedScenarios: UnsupportedScenarioFlag[];
  issues: ValidationIssue[];
}

export interface ReturnDraft {
  id: string;
  sessionId: string;
  version: number;
  status: 'draft_in_progress' | 'reconciled' | 'validated_ready' | 'blocked_unsupported';
  selectedRegime: TaxRegime;
  inputs: ReturnFinancialInputs;
  taxSummary: TaxComparisonSummary;
  validation: ValidationResult;
  itrJson: Record<string, unknown>;
  changeNote: string;
  approvedBy: string;
  createdAt: string;
}

export type AgentExecutionState =
  | 'IDLE'
  | 'PLANNING'
  | 'EXECUTING_TOOLS'
  | 'WAITING_FOR_USER_CLARIFICATION'
  | 'WAITING_FOR_HUMAN_APPROVAL'
  | 'HALTED_UNSUPPORTED_SCENARIO'
  | 'COMPLETED'
  | 'ERROR';

export interface FilingSession {
  id: string;
  title: string;
  assessmentYear: string;
  financialYear: string;
  itrFormType: 'ITR-1 (Sahaj)';
  isDemoSession?: boolean;
  status:
    | 'intake'
    | 'reconciling'
    | 'awaiting_clarification'
    | 'pending_approval'
    | 'ready_to_download'
    | 'unsupported_scenario';
  agentState: AgentExecutionState;
  unsupportedScenarios: UnsupportedScenarioFlag[];
  activeDraftVersion: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Full 22 Controlled MCP Tools across Document, Financial, Tax, Return, and Security domains
 */
export type McpToolName =
  // Document tools
  | 'upload_document'
  | 'inspect_documents'
  | 'extract_document_facts'
  | 'get_document_details'
  // Financial tools
  | 'get_financial_summary'
  | 'reconcile_documents'
  | 'add_income_information'
  | 'add_deduction_information'
  | 'update_return_information'
  // Tax tools
  | 'retrieve_tax_rules'
  | 'calculate_tax'
  | 'compare_tax_regimes'
  | 'validate_return'
  // Return tools
  | 'inspect_return'
  | 'generate_return_draft'
  | 'export_return_json'
  | 'get_return_status'
  // Security tools
  | 'check_permissions'
  | 'request_user_approval'
  | 'approve_operation'
  | 'reject_operation'
  | 'get_audit_history';

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'executed'
  | 'failed';

export interface ProposedFieldDiff {
  field: string;
  label: string;
  previousValue: string | number;
  proposedValue: string | number;
  sourceProvenance?: ProvenanceSourceType;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  idempotencyKey: string;
  toolName: McpToolName;
  operationType:
    | 'return_update'
    | 'income_addition'
    | 'deduction_addition'
    | 'conflict_resolution'
    | 'draft_finalization';
  requestedBy: 'ai_agent' | 'user_staged';
  status: ApprovalStatus;
  riskLevel: 'high' | 'medium';
  summary: string;
  justification: string;
  relevantAmount?: number;
  sourceDocumentName?: string;
  taxImpactSummary?: string;
  rawArguments: Record<string, unknown>;
  maskedArguments: Record<string, unknown>;
  diffs: ProposedFieldDiff[];
  createdAt: string;
  expiresAt?: string;
  decidedAt?: string;
  decisionNote?: string;
  executionResultSummary?: string;
}

export type GatewayDecision =
  | 'ALLOWED_EXECUTED'
  | 'HELD_FOR_HUMAN_APPROVAL'
  | 'APPROVED_AND_EXECUTED'
  | 'EXECUTION_FAILED'
  | 'REJECTED_BY_HUMAN'
  | 'CANCELLED_BY_USER'
  | 'BLOCKED_ACL'
  | 'BLOCKED_PATH_TRAVERSAL'
  | 'BLOCKED_SCHEMA_INVALID'
  | 'BLOCKED_DUPLICATE_LOOP'
  | 'BLOCKED_UNAUTHORIZED';

export type AuditExecutionStatus =
  | 'executed'
  | 'held_for_approval'
  | 'blocked'
  | 'rejected'
  | 'cancelled'
  | 'failed';

/**
 * Redacted, SHA-256 hash-chained SecurityAuditEntry exposed to the UI.
 * Raw unmasked PII is NEVER serialized into frontend payloads.
 */
export interface SecurityAuditEntry {
  id: string;
  sessionId: string;
  timestamp: string;
  actor: 'ai_agent' | 'taxpayer_human' | 'security_gateway';
  toolName: McpToolName | 'document_acl_change';
  operation: string;
  decision: GatewayDecision;
  executionStatus: AuditExecutionStatus;
  approvalRequestId?: string;
  piiFieldsMasked: number;
  maskedPayloadPreview: string;
  previousHash: string;
  integrityHash: string;
  details: string;
}

export interface AgentPlanStep {
  stepNumber: number;
  toolName: McpToolName | 'ask_clarification';
  objective: string;
  status: 'planned' | 'completed' | 'held_for_approval' | 'skipped' | 'failed';
}

export interface AgentExecutionPlan {
  intentSummary: string;
  llmEngineUsed: string;
  steps: AgentPlanStep[];
}

export interface AgentToolTrace {
  id: string;
  toolName: McpToolName;
  gatewayDecision: GatewayDecision;
  piiMaskedCount: number;
  durationMs: number;
  summary: string;
  timestamp?: string;
  maskedArgsPreview?: string;
  maskedResponsePreview?: string;
  approvalRequestId?: string;
  errorCode?: string;
}

export interface McpToolDefinition {
  name: McpToolName;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
}

export interface RagRuleCitation {
  id: string;
  section: string;
  title: string;
  assessmentYear: string;
  regimeApplicability: string;
  statutoryLimit: string;
  documentRequirement: string;
  summary: string;
  officialSource: string;
  officialUrl?: string;
  snapshotVerified?: boolean;
  relevanceScore?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  attachedDocuments?: string[];
  agentStateAfterTurn?: AgentExecutionState;
  isAutoResumedTurn?: boolean;
  isDeterministicFallback?: boolean;
  executionPlan?: AgentExecutionPlan;
  toolTraces?: AgentToolTrace[];
  citations?: RagRuleCitation[];
  pendingApprovalIds?: string[];
  clarificationQuestions?: string[];
}

export interface SecurityGatewayConfig {
  requireHumanApprovalForWrites: boolean;
  enforcePiiMaskingToLlm: boolean;
  enforceDocumentAcl: boolean;
  allowCalculateTaxTool: boolean;
}

export interface LlmRuntimeStatus {
  activeProvider: 'ollama_qwen3' | 'gemini_cloud' | 'deterministic_demo_fallback';
  configuredModel: string;
  ollamaReachable: boolean;
  ollamaUrl: string;
  isFallbackMode?: boolean;
}

export interface WorkspaceSnapshot {
  profile: UserProfile;
  sessions: FilingSession[];
  activeSessionId: string;
  activeSession: FilingSession;
  documents: UploadedDocument[];
  ledger: FinancialLedgerEntry[];
  drafts: ReturnDraft[];
  activeDraft: ReturnDraft;
  reconciliation: ReconciliationReport;
  approvals: ApprovalRequest[];
  auditLogs: SecurityAuditEntry[];
  auditChainValid: boolean;
  chatHistory: ChatMessage[];
  gatewayConfig: SecurityGatewayConfig;
  llmStatus: LlmRuntimeStatus;
  ruleVerification: RuleVerificationMetadata;
}
