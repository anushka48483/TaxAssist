import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import {
  AgentExecutionState,
  ApprovalRequest,
  AuditExecutionStatus,
  ChatMessage,
  DocumentCategory,
  FieldFillingState,
  FieldVerificationStatus,
  FilingSession,
  FinancialLedgerEntry,
  GatewayDecision,
  LiveFilingEvent,
  LiveFilingEventType,
  McpToolName,
  ProvenanceSourceType,
  ReturnDraft,
  ReturnFinancialInputs,
  SecurityAuditEntry,
  SecurityGatewayConfig,
  TaxRegime,
  UnsupportedScenarioFlag,
  UploadedDocument,
  UserProfile,
  WorkspaceSnapshot,
} from '../src/shared/types.js';
import {
  buildStructuredItr1Json,
  calculateTaxComparison,
  getRuleVerificationMetadata,
  validateReturnData,
} from './taxEngine.js';
import { reconcileDocumentsAndReturn } from './reconciliationEngine.js';

export const EMPTY_USER_PROFILE: UserProfile = {
  fullName: '',
  pan: '',
  aadhaarLast4: '',
  dateOfBirth: '',
  residentialStatus: 'Resident (ROR)',
  email: '',
  phone: '',
  address: '',
  verificationPlace: '',
  verificationConfirmed: false,
  employerName: '',
  employerTan: '',
  bankName: '',
  bankIfsc: '',
  bankAccountNumber: '',
  preferredRegime: 'new',
};

const DEMO_PROFILE: UserProfile = {
  fullName: 'Rohan Deshmukh (Synthetic Demo)',
  pan: 'SYNTP1234K',
  aadhaarLast4: '9042',
  dateOfBirth: '1994-06-18',
  residentialStatus: 'Resident (ROR)',
  email: 'rohan.synthetic@example.in',
  phone: '+91-98801-11223',
  address: '402, Indiranagar 2nd Stage, Bengaluru, Karnataka 560038',
  verificationPlace: 'Bengaluru',
  verificationConfirmed: false,
  employerName: 'Astraveda Digital Systems Pvt Ltd',
  employerTan: 'BLRA99120F',
  bankName: 'State Bank of India',
  bankIfsc: 'SBIN0004120',
  bankAccountNumber: '409988112233',
  preferredRegime: 'new',
};

export const EMPTY_INPUTS: ReturnFinancialInputs = {
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
};

function normalizeAgentState(raw: string): AgentExecutionState {
  switch (raw) {
    case 'AWAITING_CLARIFICATION':
      return 'WAITING_FOR_USER_CLARIFICATION';
    case 'AWAITING_HUMAN_APPROVAL':
      return 'WAITING_FOR_HUMAN_APPROVAL';
    case 'UNSUPPORTED_SCENARIO':
      return 'HALTED_UNSUPPORTED_SCENARIO';
    case 'ERROR_RECOVERABLE':
      return 'ERROR';
    case 'IDLE':
    case 'PLANNING':
    case 'EXECUTING_TOOLS':
    case 'WAITING_FOR_USER_CLARIFICATION':
    case 'WAITING_FOR_HUMAN_APPROVAL':
    case 'HALTED_UNSUPPORTED_SCENARIO':
    case 'COMPLETED':
    case 'ERROR':
      return raw;
    default:
      return 'IDLE';
  }
}

function redactAuditText(raw: string): string {
  return raw
    .replace(/\b([A-Z]{5})([0-9]{4})([A-Z])\b/g, '$1****$3')
    .replace(/\b([A-Z]{4}[0-9])([0-9]{4})([A-Z])\b/g, '$1****$3')
    .replace(/\b([0-9]{6,12})([0-9]{4})\b/g, (m, _p1, last4) =>
      m.length >= 10 ? `XXXXXXXX${last4}` : m
    )
    .replace(/\+91-[0-9]{5}-([0-9]{5})/g, '+91-XXXXX-$1');
}

export class SqliteTaxWorkspaceStore {
  private db: DatabaseSync;
  private activeSessionId = '';
  private eventSeq = 0;
  private liveEventListeners = new Set<(ev: LiveFilingEvent) => void>();
  private gatewayConfig: SecurityGatewayConfig = {
    requireHumanApprovalForWrites: true,
    enforcePiiMaskingToLlm: true,
    enforceDocumentAcl: true,
    allowCalculateTaxTool: true,
  };

  constructor(customDbPath?: string) {
    const resolvedPath =
      customDbPath ||
      process.env.SQLITE_DB_PATH ||
      path.resolve(process.cwd(), 'data/taxshield.sqlite');
    if (resolvedPath !== ':memory:') {
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    }
    this.db = new DatabaseSync(resolvedPath);
    this.initSchema();
    const row = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM live_events')
      .get() as { max_seq: number } | undefined;
    this.eventSeq = Number(row?.max_seq ?? 0);
    this.ensureInitialSession();
  }

  private tryAddColumn(tableName: string, columnDef: string): void {
    try {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDef};`);
    } catch {
      // Column already exists
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        assessment_year TEXT NOT NULL,
        financial_year TEXT NOT NULL,
        itr_form_type TEXT NOT NULL,
        is_demo_session INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        agent_state TEXT NOT NULL,
        unsupported_json TEXT NOT NULL,
        active_draft_version INTEGER NOT NULL,
        profile_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        category TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        is_synthetic INTEGER NOT NULL,
        uploaded_at TEXT NOT NULL,
        processing_status TEXT NOT NULL,
        extraction_method TEXT NOT NULL,
        page_count INTEGER NOT NULL,
        raw_text_preview TEXT NOT NULL,
        extracted_facts_json TEXT NOT NULL,
        structured_data_json TEXT NOT NULL,
        missing_expected_json TEXT NOT NULL DEFAULT '[]',
        needs_user_review INTEGER NOT NULL DEFAULT 0,
        validation_errors_json TEXT NOT NULL,
        agent_access_allowed INTEGER NOT NULL,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS ledger_entries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        category TEXT NOT NULL,
        field TEXT NOT NULL,
        label TEXT NOT NULL,
        amount REAL NOT NULL,
        status TEXT NOT NULL,
        source_doc_name TEXT,
        page_number INTEGER,
        confidence REAL,
        notes TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        selected_regime TEXT NOT NULL,
        inputs_json TEXT NOT NULL,
        tax_summary_json TEXT NOT NULL,
        validation_json TEXT NOT NULL,
        itr_json TEXT NOT NULL,
        change_note TEXT NOT NULL,
        approved_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL DEFAULT '',
        tool_name TEXT NOT NULL,
        operation_type TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        status TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        summary TEXT NOT NULL,
        justification TEXT NOT NULL,
        relevant_amount REAL,
        source_doc_name TEXT,
        tax_impact_summary TEXT,
        raw_args_json TEXT NOT NULL,
        masked_args_json TEXT NOT NULL,
        diffs_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        decided_at TEXT,
        decision_note TEXT,
        execution_result_summary TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        actor TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        operation TEXT NOT NULL DEFAULT '',
        decision TEXT NOT NULL,
        execution_status TEXT NOT NULL DEFAULT 'executed',
        approval_request_id TEXT,
        pii_fields_masked INTEGER NOT NULL,
        masked_payload_preview TEXT NOT NULL,
        previous_hash TEXT NOT NULL DEFAULT 'GENESIS_0000000000000000',
        integrity_hash TEXT NOT NULL,
        details TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        extra_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS field_states (
        session_id TEXT NOT NULL,
        field_key TEXT NOT NULL,
        state_json TEXT NOT NULL,
        PRIMARY KEY (session_id, field_key)
      );

      CREATE TABLE IF NOT EXISTS live_events (
        event_id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);

    // Backwards-compatible migrations for existing SQLite files
    this.tryAddColumn('sessions', 'is_demo_session INTEGER NOT NULL DEFAULT 0');
    this.tryAddColumn('documents', "missing_expected_json TEXT NOT NULL DEFAULT '[]'");
    this.tryAddColumn('documents', 'needs_user_review INTEGER NOT NULL DEFAULT 0');
    this.tryAddColumn('approvals', "idempotency_key TEXT NOT NULL DEFAULT ''");
    this.tryAddColumn('approvals', 'relevant_amount REAL');
    this.tryAddColumn('approvals', 'source_doc_name TEXT');
    this.tryAddColumn('approvals', 'tax_impact_summary TEXT');
    this.tryAddColumn('approvals', 'expires_at TEXT');
    this.tryAddColumn('audit_logs', "operation TEXT NOT NULL DEFAULT ''");
    this.tryAddColumn('audit_logs', "execution_status TEXT NOT NULL DEFAULT 'executed'");
    this.tryAddColumn('audit_logs', 'approval_request_id TEXT');
    this.tryAddColumn(
      'audit_logs',
      "previous_hash TEXT NOT NULL DEFAULT 'GENESIS_0000000000000000'"
    );
  }

  private ensureInitialSession(): void {
    const existing = this.db
      .prepare('SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1')
      .get() as { id: string } | undefined;

    if (existing) {
      this.activeSessionId = existing.id;
      return;
    }

    this.createNewSession({
      title: 'AY 2026-27 Salaried Return (Autonomous Session)',
      isDemoSession: false,
    });
  }

  public getActiveSessionId(): string {
    return this.activeSessionId;
  }

  public getSessions(): FilingSession[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions ORDER BY created_at DESC')
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      assessmentYear: String(r.assessment_year),
      financialYear: String(r.financial_year),
      itrFormType: 'ITR-1 (Sahaj)',
      isDemoSession: Boolean(r.is_demo_session),
      status: r.status as FilingSession['status'],
      agentState: normalizeAgentState(String(r.agent_state)),
      unsupportedScenarios: JSON.parse(String(r.unsupported_json || '[]')),
      activeDraftVersion: Number(r.active_draft_version),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
  }

  public getActiveSession(sessionId = this.activeSessionId): FilingSession {
    const sessions = this.getSessions();
    return sessions.find((s) => s.id === sessionId) || sessions[0];
  }

  public setAgentState(
    state: AgentExecutionState,
    statusOverride?: FilingSession['status'],
    sessionId = this.activeSessionId
  ): void {
    const current = this.getActiveSession(sessionId);
    const nextStatus = statusOverride ?? current.status;
    this.db
      .prepare('UPDATE sessions SET agent_state = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(state, nextStatus, new Date().toISOString(), sessionId);
  }

  public addUnsupportedScenarioFlag(
    flag: UnsupportedScenarioFlag,
    sessionId = this.activeSessionId
  ): void {
    const session = this.getActiveSession(sessionId);
    const existing = session.unsupportedScenarios.filter((f) => f.code !== flag.code);
    existing.push(flag);
    this.db
      .prepare(
        'UPDATE sessions SET unsupported_json = ?, status = ?, agent_state = ?, updated_at = ? WHERE id = ?'
      )
      .run(
        JSON.stringify(existing),
        'unsupported_scenario',
        'HALTED_UNSUPPORTED_SCENARIO',
        new Date().toISOString(),
        sessionId
      );
    this.refreshActiveDraftValidation(sessionId);
  }

  public clearUnsupportedScenarioFlags(sessionId = this.activeSessionId): void {
    this.db
      .prepare(
        'UPDATE sessions SET unsupported_json = ?, status = ?, agent_state = ?, updated_at = ? WHERE id = ?'
      )
      .run('[]', 'reconciling', 'IDLE', new Date().toISOString(), sessionId);
    this.refreshActiveDraftValidation(sessionId);
  }

  public getProfile(sessionId = this.activeSessionId): UserProfile {
    const row = this.db
      .prepare('SELECT profile_json FROM sessions WHERE id = ?')
      .get(sessionId) as { profile_json: string } | undefined;
    if (!row) return { ...EMPTY_USER_PROFILE };
    return JSON.parse(row.profile_json) as UserProfile;
  }

  public updateProfile(
    partial: Partial<UserProfile>,
    sessionId = this.activeSessionId
  ): UserProfile {
    const merged: UserProfile = { ...this.getProfile(sessionId), ...partial };
    this.db
      .prepare('UPDATE sessions SET profile_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(merged), new Date().toISOString(), sessionId);
    this.refreshActiveDraftValidation(sessionId);
    return merged;
  }

  public createNewSession(params: {
    title?: string;
    isDemoSession?: boolean;
    fixedId?: string;
  }): FilingSession {
    const id =
      params.fixedId ||
      `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const isDemo = Boolean(params.isDemoSession);
    const title =
      params.title?.trim() ||
      (isDemo
        ? 'Interactive Synthetic Demo — AY 2026-27'
        : `AY 2026-27 Filing (${this.getSessions().length + 1})`);
    const profile = isDemo ? { ...DEMO_PROFILE } : { ...EMPTY_USER_PROFILE };

    this.db
      .prepare(
        `INSERT INTO sessions (
          id, title, assessment_year, financial_year, itr_form_type, is_demo_session,
          status, agent_state, unsupported_json, active_draft_version,
          profile_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        title,
        'AY 2026-27',
        'FY 2025-26',
        'ITR-1 (Sahaj)',
        isDemo ? 1 : 0,
        'intake',
        'IDLE',
        '[]',
        1,
        JSON.stringify(profile),
        now,
        now
      );

    this.activeSessionId = id;

    const draft = this.buildDraftObject(
      id,
      1,
      profile.preferredRegime,
      { ...EMPTY_INPUTS },
      [],
      [],
      isDemo
        ? 'Isolated Synthetic Demo initialized. Preloaded documents ready for reconciliation and approval.'
        : 'Session initialized. Upload tax documents or launch the Interactive Demo.',
      'System Init'
    );
    this.insertDraftRow(draft);

    this.appendChatMessage(
      {
        id: `msg-welcome-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        role: 'assistant',
        timestamp: now,
        agentStateAfterTurn: 'IDLE',
        content: isDemo
          ? 'Welcome to **TaxShield MCP** for AY 2026-27. Your isolated synthetic demo session is ready with loaded financial documents. Ask **"Prepare my income tax return."** to inspect documents, reconcile variances, calculate Old vs New regime tax, and prepare your ITR-1 draft.'
          : 'Welcome to **TaxShield MCP** (AY 2026-27). Simply upload your tax documents (Form 16, bank statements, FD certificates, 26AS/AIS, or investment proofs) — I will automatically extract your personal, bank, employer, and income details, show you what is still missing, let you review or edit anything wrong, and follow your plain-English instructions.',
      },
      id
    );

    this.recordAudit({
      sessionId: id,
      actor: 'security_gateway',
      toolName: 'inspect_return',
      operation: 'initialize_session',
      decision: 'ALLOWED_EXECUTED',
      executionStatus: 'executed',
      piiFieldsMasked: isDemo ? 3 : 0,
      maskedPayloadPreview: isDemo
        ? '{"pan":"SYNTP****K","tan":"BLRA9****F","account":"XXXXXXXX2233"}'
        : '{"profile":"blank_user_intake"}',
      details: isDemo
        ? 'Initialized isolated synthetic demo session with PII redaction and SHA-256 hash chain.'
        : 'Created blank SQLite-backed filing session ready for taxpayer input.',
    });

    return this.getActiveSession(id);
  }

  /**
   * Cleanly resets or creates an isolated synthetic demo session without affecting non-demo sessions.
   */
  public resetIsolatedDemoSession(): FilingSession {
    const demoSessions = this.getSessions().filter((s) => s.isDemoSession);
    for (const ds of demoSessions) {
      this.db.prepare('DELETE FROM documents WHERE session_id = ?').run(ds.id);
      this.db.prepare('DELETE FROM ledger_entries WHERE session_id = ?').run(ds.id);
      this.db.prepare('DELETE FROM drafts WHERE session_id = ?').run(ds.id);
      this.db.prepare('DELETE FROM approvals WHERE session_id = ?').run(ds.id);
      this.db.prepare('DELETE FROM audit_logs WHERE session_id = ?').run(ds.id);
      this.db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(ds.id);
      this.db.prepare('DELETE FROM field_states WHERE session_id = ?').run(ds.id);
      this.db.prepare('DELETE FROM live_events WHERE session_id = ?').run(ds.id);
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(ds.id);
    }

    return this.createNewSession({
      title: 'Interactive Synthetic Demo — AY 2026-27',
      isDemoSession: true,
    });
  }

  public switchSession(sessionId: string): FilingSession {
    const found = this.getSessions().find((s) => s.id === sessionId);
    if (!found) throw new Error(`Session ${sessionId} not found.`);
    this.activeSessionId = sessionId;
    return found;
  }

  // --- Documents ---
  public getDocuments(sessionId = this.activeSessionId): UploadedDocument[] {
    const rows = this.db
      .prepare('SELECT * FROM documents WHERE session_id = ? ORDER BY uploaded_at DESC')
      .all(sessionId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      sessionId: String(r.session_id),
      category: r.category as DocumentCategory,
      fileName: String(r.file_name),
      mimeType: String(r.mime_type),
      fileSize: Number(r.file_size),
      isSynthetic: Boolean(r.is_synthetic),
      uploadedAt: String(r.uploaded_at),
      processingStatus: r.processing_status as UploadedDocument['processingStatus'],
      extractionMethod: r.extraction_method as UploadedDocument['extractionMethod'],
      pageCount: Number(r.page_count),
      rawTextPreview: String(r.raw_text_preview),
      extractedFacts: JSON.parse(String(r.extracted_facts_json || '[]')),
      structuredData: JSON.parse(String(r.structured_data_json || '{}')),
      missingExpectedFields: JSON.parse(String(r.missing_expected_json || '[]')),
      needsUserReview: Boolean(r.needs_user_review),
      validationErrors: JSON.parse(String(r.validation_errors_json || '[]')),
      agentAccessAllowed: Boolean(r.agent_access_allowed),
      errorMessage: r.error_message ? String(r.error_message) : undefined,
    }));
  }

  public upsertDocument(doc: UploadedDocument): UploadedDocument {
    const needsReview =
      Boolean(doc.needsUserReview) ||
      doc.extractedFacts.some((f) => f.validationStatus === 'needs_review');

    this.db
      .prepare(
        `INSERT INTO documents (
          id, session_id, category, file_name, mime_type, file_size, is_synthetic,
          uploaded_at, processing_status, extraction_method, page_count, raw_text_preview,
          extracted_facts_json, structured_data_json, missing_expected_json, needs_user_review,
          validation_errors_json, agent_access_allowed, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          category = excluded.category,
          processing_status = excluded.processing_status,
          extraction_method = excluded.extraction_method,
          page_count = excluded.page_count,
          raw_text_preview = excluded.raw_text_preview,
          extracted_facts_json = excluded.extracted_facts_json,
          structured_data_json = excluded.structured_data_json,
          missing_expected_json = excluded.missing_expected_json,
          needs_user_review = excluded.needs_user_review,
          validation_errors_json = excluded.validation_errors_json,
          agent_access_allowed = excluded.agent_access_allowed,
          error_message = excluded.error_message`
      )
      .run(
        doc.id,
        doc.sessionId,
        doc.category,
        doc.fileName,
        doc.mimeType,
        doc.fileSize,
        doc.isSynthetic ? 1 : 0,
        doc.uploadedAt,
        doc.processingStatus,
        doc.extractionMethod,
        doc.pageCount,
        doc.rawTextPreview,
        JSON.stringify(doc.extractedFacts),
        JSON.stringify(doc.structuredData),
        JSON.stringify(doc.missingExpectedFields ?? []),
        needsReview ? 1 : 0,
        JSON.stringify(doc.validationErrors),
        doc.agentAccessAllowed ? 1 : 0,
        doc.errorMessage ?? null
      );

    if (doc.processingStatus === 'extracted') {
      this.syncDocumentProvenanceEntries(doc, needsReview);
      this.syncDocumentFieldStates(doc, needsReview);

      // Backfill only BLANK profile fields from high-confidence extracted docs (never overwrite user-entered or user_edited details)
      if (!needsReview) {
        const curProfile = this.getProfile(doc.sessionId);
        const curStates = this.getFieldStates(doc.sessionId);
        const sd = doc.structuredData;
        const profileUpdates: Partial<UserProfile> = {};
        const canFill = (key: keyof UserProfile, extractedVal?: string) =>
          Boolean(extractedVal?.trim()) &&
          !curProfile[key] &&
          !curStates[String(key)]?.editedByUser;

        if (canFill('fullName', sd.employeeName)) profileUpdates.fullName = sd.employeeName!.trim();
        if (canFill('pan', sd.employeePan)) profileUpdates.pan = sd.employeePan!.trim().toUpperCase();
        if (canFill('dateOfBirth', sd.dateOfBirth)) profileUpdates.dateOfBirth = sd.dateOfBirth!.trim();
        if (canFill('aadhaarLast4', sd.aadhaarLast4)) profileUpdates.aadhaarLast4 = sd.aadhaarLast4!.trim().slice(-4);
        if (canFill('email', sd.email)) profileUpdates.email = sd.email!.trim();
        if (canFill('phone', sd.phone)) profileUpdates.phone = sd.phone!.trim();
        if (canFill('address', sd.address)) profileUpdates.address = sd.address!.trim();
        if (canFill('employerName', sd.employerName)) profileUpdates.employerName = sd.employerName!.trim();
        if (canFill('employerTan', sd.employerTan)) profileUpdates.employerTan = sd.employerTan!.trim().toUpperCase();
        if (canFill('bankName', sd.bankName)) profileUpdates.bankName = sd.bankName!.trim();
        if (canFill('bankAccountNumber', sd.bankAccountNumber)) profileUpdates.bankAccountNumber = sd.bankAccountNumber!.trim();
        if (canFill('bankIfsc', sd.bankIfsc)) profileUpdates.bankIfsc = sd.bankIfsc!.trim().toUpperCase();
        if (canFill('verificationPlace', sd.verificationPlace)) profileUpdates.verificationPlace = sd.verificationPlace!.trim();

        if (Object.keys(profileUpdates).length > 0) {
          this.updateProfile(profileUpdates, doc.sessionId);
        }
      }

      // Populate initial Form 16 baseline ONLY if draft is untouched (version === 1 && grossSalary === 0)
      // AND extraction is high-confidence (never auto-commit low-confidence OCR guesses or overwrite verified data!)
      if (doc.category === 'form_16' && !needsReview) {
        const draft = this.getActiveDraft(doc.sessionId);
        const currentFieldStates = this.getFieldStates(doc.sessionId);
        const safeField = <K extends keyof ReturnFinancialInputs>(
          key: K,
          docVal: number
        ): number => {
          if (currentFieldStates[String(key)]?.editedByUser) {
            return Number(draft.inputs[key] ?? 0);
          }
          return docVal;
        };
        if (
          draft.version === 1 &&
          draft.inputs.grossSalary === 0 &&
          (doc.structuredData.grossSalary ?? 0) > 0
        ) {
          this.commitNewDraft(
            {
              inputs: {
                grossSalary: safeField('grossSalary', doc.structuredData.grossSalary ?? 0),
                basicSalary: safeField('basicSalary', doc.structuredData.basicSalary ?? 0),
                hraExemption: safeField('hraExemption', doc.structuredData.hraExemption ?? 0),
                professionalTax: safeField('professionalTax', doc.structuredData.professionalTax ?? 0),
                section80C: safeField('section80C', doc.structuredData.section80CDeclared ?? 0),
                section80CCD1B: safeField('section80CCD1B', doc.structuredData.section80CCD1B ?? 0),
                section80CCD2: safeField('section80CCD2', doc.structuredData.section80CCD2 ?? 0),
                section80D: safeField('section80D', doc.structuredData.section80DDeclared ?? 0),
                tdsClaimed: safeField('tdsClaimed', doc.structuredData.tdsOnSalary ?? 0),
              },
              changeNote: `Populated baseline Schedule S & TDS from high-confidence Form 16 (${doc.fileName}). Other documents await reconciliation and user approval.`,
              approvedBy: 'Document Extraction Pipeline (Form 16 Baseline)',
            },
            doc.sessionId
          );
        }
      }
    }

    this.refreshActiveDraftValidation(doc.sessionId);
    return { ...doc, needsUserReview: needsReview };
  }

  public onLiveEvent(listener: (ev: LiveFilingEvent) => void): () => void {
    this.liveEventListeners.add(listener);
    return () => {
      this.liveEventListeners.delete(listener);
    };
  }

  public emitLiveEvent(
    params: Omit<LiveFilingEvent, 'eventId' | 'seq' | 'timestamp' | 'sessionId'> & {
      eventId?: string;
      sessionId?: string;
      timestamp?: string;
    }
  ): LiveFilingEvent {
    const sessionId = params.sessionId || this.activeSessionId;
    const eventId =
      params.eventId || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const existing = this.db
      .prepare('SELECT payload_json FROM live_events WHERE event_id = ?')
      .get(eventId) as { payload_json: string } | undefined;
    if (existing) {
      return JSON.parse(existing.payload_json) as LiveFilingEvent;
    }

    this.eventSeq += 1;
    const ev: LiveFilingEvent = {
      ...params,
      eventId,
      seq: this.eventSeq,
      sessionId,
      timestamp: params.timestamp || new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO live_events (event_id, seq, session_id, type, timestamp, payload_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(ev.eventId, ev.seq, ev.sessionId, ev.type, ev.timestamp, JSON.stringify(ev));

    for (const listener of this.liveEventListeners) {
      try {
        listener(ev);
      } catch {
        // Ignore downstream closed stream errors
      }
    }

    return ev;
  }

  public getLiveEvents(sessionId = this.activeSessionId, sinceSeq = 0): LiveFilingEvent[] {
    const rows = this.db
      .prepare(
        'SELECT payload_json FROM live_events WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT 250'
      )
      .all(sessionId, sinceSeq) as Array<{ payload_json: string }>;
    return rows.map((r) => JSON.parse(r.payload_json) as LiveFilingEvent);
  }

  public getFieldStates(sessionId = this.activeSessionId): Record<string, FieldFillingState> {
    const rows = this.db
      .prepare('SELECT field_key, state_json FROM field_states WHERE session_id = ?')
      .all(sessionId) as Array<{ field_key: string; state_json: string }>;
    const map: Record<string, FieldFillingState> = {};
    for (const r of rows) {
      map[r.field_key] = JSON.parse(r.state_json) as FieldFillingState;
    }
    return map;
  }

  public upsertFieldState(
    sessionId: string,
    state: FieldFillingState,
    options?: { respectUserEdit?: boolean }
  ): FieldFillingState {
    const current = this.getFieldStates(sessionId)[state.fieldKey];
    if (
      options?.respectUserEdit &&
      current &&
      (current.editedByUser || current.status === 'user_edited')
    ) {
      return current;
    }

    this.db
      .prepare(
        `INSERT INTO field_states (session_id, field_key, state_json)
         VALUES (?, ?, ?)
         ON CONFLICT(session_id, field_key) DO UPDATE SET state_json = excluded.state_json`
      )
      .run(sessionId, state.fieldKey, JSON.stringify(state));

    return state;
  }

  private syncDocumentFieldStates(doc: UploadedDocument, needsReview: boolean): void {
    const sd = doc.structuredData;
    const factConfidence = (fieldNames: string[]): { confidence: number; page: number } => {
      const match = doc.extractedFacts.find((f) => fieldNames.includes(f.field));
      return {
        confidence: match?.confidence ?? 0.9,
        page: match?.pageNumber ?? 1,
      };
    };

    const setFromDoc = (
      fieldKey: string,
      sectionCode: string,
      label: string,
      value: number | string | undefined,
      factAliases: string[],
      autoVerified: boolean
    ) => {
      if (value === undefined || value === null || value === '' || value === 0) return;
      const meta = factConfidence(factAliases);
      const status: FieldVerificationStatus = needsReview
        ? 'needs_review'
        : autoVerified
          ? 'verified'
          : 'pending_confirmation';

      this.upsertFieldState(
        doc.sessionId,
        {
          fieldKey,
          sectionCode,
          label,
          status,
          stagedValue: value,
          sourceDocument: doc.fileName,
          pageNumber: meta.page,
          confidence: meta.confidence,
          updatedAt: new Date().toISOString(),
        },
        { respectUserEdit: true }
      );
    };

    if (doc.category === 'form_16') {
      setFromDoc('employerName', 'C', 'Employer Name', sd.employerName, ['employerName'], true);
      setFromDoc('employerTan', 'C', 'Employer TAN', sd.employerTan, ['employerTan'], true);
      setFromDoc('grossSalary', 'C', 'Gross Salary', sd.grossSalary, ['grossSalary'], true);
      setFromDoc('basicSalary', 'C', 'Basic Salary', sd.basicSalary, ['basicSalary'], true);
      setFromDoc('hraExemption', 'C', 'Exempt Allowances / HRA', sd.hraExemption, ['hraExemption'], true);
      setFromDoc('professionalTax', 'C', 'Professional Tax', sd.professionalTax, ['professionalTax'], true);
      setFromDoc('tdsClaimed', 'H', 'TDS on Salary', sd.tdsOnSalary, ['tdsOnSalary'], true);
      if ((sd.section80CDeclared ?? 0) > 0) {
        setFromDoc('section80C', 'E', 'Section 80C Investments', sd.section80CDeclared, ['section80CDeclared'], true);
      }
      if ((sd.section80DDeclared ?? 0) > 0) {
        setFromDoc('section80D', 'E', 'Section 80D Health Insurance', sd.section80DDeclared, ['section80DDeclared'], true);
      }
    }

    if (doc.category === 'bank_statements' || doc.category === 'ais' || doc.category === 'tis') {
      setFromDoc(
        'savingsInterest',
        'D',
        'Savings Bank Interest',
        sd.savingsBankInterest ?? sd.aisReportedSavingsInterest,
        ['savingsBankInterest', 'aisReportedSavingsInterest'],
        false
      );
    }

    if (doc.category === 'interest_certificates' || doc.category === 'bank_statements' || doc.category === 'ais') {
      setFromDoc(
        'fdInterest',
        'D',
        'Fixed Deposit Interest',
        sd.fdInterest ?? sd.aisReportedFdInterest,
        ['fdInterest', 'aisReportedFdInterest'],
        false
      );
      if ((sd.tdsOnInterest ?? 0) > 0) {
        setFromDoc('tdsOnInterest', 'H', 'TDS on Interest', sd.tdsOnInterest, ['tdsOnInterest'], false);
      }
    }

    if (doc.category === 'investment_proofs') {
      setFromDoc(
        'section80C',
        'E',
        'Section 80C Investments',
        sd.section80CProofTotal,
        ['section80CProofTotal', 'section80CDeclared'],
        false
      );
      setFromDoc(
        'section80CCD1B',
        'E',
        'Section 80CCD(1B) NPS',
        sd.section80CCD1B,
        ['section80CCD1B'],
        false
      );
      setFromDoc(
        'section80D',
        'E',
        'Section 80D Health Insurance',
        sd.section80DProofTotal,
        ['section80DProofTotal'],
        false
      );
    }

    if (doc.category === 'form_26as') {
      setFromDoc(
        'tdsClaimed',
        'H',
        'Total TDS Credited (Form 26AS)',
        sd.totalTdsCredited26AS,
        ['totalTdsCredited26AS'],
        false
      );
    }

    // Track extracted personal, employer, and refund bank details provenance in fieldStates
    setFromDoc('fullName', 'A', 'Full Name (as per PAN)', sd.employeeName, ['employeeName'], true);
    setFromDoc(
      'pan',
      'A',
      'PAN',
      sd.employeePan ? `${sd.employeePan.slice(0, 5)}****${sd.employeePan.slice(9)}` : undefined,
      ['employeePan'],
      true
    );
    setFromDoc('dateOfBirth', 'A', 'Date of Birth', sd.dateOfBirth, ['dateOfBirth'], true);
    setFromDoc(
      'aadhaarLast4',
      'A',
      'Aadhaar (Last 4 Digits)',
      sd.aadhaarLast4 ? `XXXXXXXX${sd.aadhaarLast4.slice(-4)}` : undefined,
      ['aadhaarLast4'],
      true
    );
    setFromDoc('email', 'A', 'Email Address', sd.email, ['email'], true);
    setFromDoc('phone', 'A', 'Mobile Number', sd.phone, ['phone'], true);
    setFromDoc('address', 'A', 'Residential Address', sd.address, ['address'], true);
    setFromDoc('employerName', 'C', 'Employer Name', sd.employerName, ['employerName'], true);
    setFromDoc('employerTan', 'C', 'Employer TAN', sd.employerTan, ['employerTan'], true);
    setFromDoc('bankName', 'J', 'Bank Name', sd.bankName, ['bankName'], true);
    setFromDoc(
      'bankAccountNumber',
      'J',
      'Account Number',
      sd.bankAccountNumber ? `XXXXXXXX${sd.bankAccountNumber.slice(-4)}` : undefined,
      ['bankAccountNumber'],
      true
    );
    setFromDoc('bankIfsc', 'J', 'IFSC Code', sd.bankIfsc, ['bankIfsc'], true);
    setFromDoc('verificationPlace', 'K', 'Verification Place', sd.verificationPlace, ['verificationPlace'], true);
  }

  private syncDocumentProvenanceEntries(doc: UploadedDocument, needsReview: boolean): void {
    this.db
      .prepare(
        'DELETE FROM ledger_entries WHERE session_id = ? AND source_doc_name = ? AND source_type = ?'
      )
      .run(doc.sessionId, doc.fileName, 'document_extracted');

    for (const fact of doc.extractedFacts) {
      if (typeof fact.numericValue === 'number' && fact.numericValue > 0) {
        const cat: FinancialLedgerEntry['category'] = fact.field.toLowerCase().includes('tds')
          ? 'tax_credit'
          : fact.field.toLowerCase().includes('80') || fact.field.toLowerCase().includes('hra')
            ? 'deduction'
            : 'income';
        this.addLedgerEntry({
          sessionId: doc.sessionId,
          sourceType: 'document_extracted',
          category: cat,
          field: fact.field,
          label: fact.label,
          amount: fact.numericValue,
          status:
            needsReview || fact.validationStatus === 'needs_review'
              ? 'needs_review'
              : doc.category === 'form_16'
                ? 'confirmed'
                : 'pending_confirmation',
          sourceDocumentName: doc.fileName,
          pageNumber: fact.pageNumber,
          confidence: fact.confidence,
          notes: fact.sourceSnippet,
        });
      }
    }
  }

  public addLedgerEntry(params: {
    sessionId?: string;
    sourceType: ProvenanceSourceType;
    category: FinancialLedgerEntry['category'];
    field: string;
    label: string;
    amount: number;
    status: FinancialLedgerEntry['status'];
    sourceDocumentName?: string;
    pageNumber?: number;
    confidence?: number;
    notes?: string;
  }): FinancialLedgerEntry {
    const sessionId = params.sessionId || this.activeSessionId;
    const entry: FinancialLedgerEntry = {
      id: `led-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId,
      sourceType: params.sourceType,
      category: params.category,
      field: params.field,
      label: params.label,
      amount: params.amount,
      status: params.status,
      sourceDocumentName: params.sourceDocumentName,
      pageNumber: params.pageNumber,
      confidence: params.confidence,
      notes: params.notes,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO ledger_entries (
          id, session_id, source_type, category, field, label, amount,
          status, source_doc_name, page_number, confidence, notes, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.sessionId,
        entry.sourceType,
        entry.category,
        entry.field,
        entry.label,
        entry.amount,
        entry.status,
        entry.sourceDocumentName ?? null,
        entry.pageNumber ?? null,
        entry.confidence ?? null,
        entry.notes ?? null,
        entry.updatedAt
      );

    return entry;
  }

  public getLedgerEntries(sessionId = this.activeSessionId): FinancialLedgerEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM ledger_entries WHERE session_id = ? ORDER BY updated_at DESC')
      .all(sessionId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      sessionId: String(r.session_id),
      sourceType: r.source_type as ProvenanceSourceType,
      category: r.category as FinancialLedgerEntry['category'],
      field: String(r.field),
      label: String(r.label),
      amount: Number(r.amount),
      status: r.status as FinancialLedgerEntry['status'],
      sourceDocumentName: r.source_doc_name ? String(r.source_doc_name) : undefined,
      pageNumber: typeof r.page_number === 'number' ? r.page_number : undefined,
      confidence: typeof r.confidence === 'number' ? r.confidence : undefined,
      notes: r.notes ? String(r.notes) : undefined,
      updatedAt: String(r.updated_at),
    }));
  }

  public toggleDocumentAcl(docId: string, allowed: boolean): UploadedDocument {
    this.db
      .prepare('UPDATE documents SET agent_access_allowed = ? WHERE id = ?')
      .run(allowed ? 1 : 0, docId);
    const docs = this.getDocuments();
    const doc = docs.find((d) => d.id === docId);
    if (!doc) throw new Error(`Document ${docId} not found.`);

    this.recordAudit({
      actor: 'taxpayer_human',
      toolName: 'document_acl_change',
      operation: allowed ? 'grant_document_acl' : 'revoke_document_acl',
      decision: allowed ? 'ALLOWED_EXECUTED' : 'BLOCKED_ACL',
      executionStatus: allowed ? 'executed' : 'blocked',
      piiFieldsMasked: 0,
      maskedPayloadPreview: JSON.stringify({
        docId,
        fileName: doc.fileName,
        agentAccessAllowed: allowed,
      }),
      details: `Document ACL updated for ${doc.fileName}: AI Agent access ${allowed ? 'GRANTED' : 'REVOKED'}.`,
    });
    return doc;
  }

  public deleteDocument(docId: string): void {
    const docs = this.getDocuments();
    const target = docs.find((d) => d.id === docId);
    this.db.prepare('DELETE FROM documents WHERE id = ?').run(docId);
    if (target) {
      this.db
        .prepare('DELETE FROM ledger_entries WHERE session_id = ? AND source_doc_name = ?')
        .run(target.sessionId, target.fileName);
    }
    this.refreshActiveDraftValidation();
  }

  // --- Drafts ---
  private buildDraftObject(
    sessionId: string,
    version: number,
    selectedRegime: TaxRegime,
    inputs: ReturnFinancialInputs,
    docs: UploadedDocument[],
    unsupportedScenarios: UnsupportedScenarioFlag[],
    changeNote: string,
    approvedBy: string
  ): ReturnDraft {
    const normalizedInputs: ReturnFinancialInputs = {
      ...EMPTY_INPUTS,
      ...inputs,
    };
    const profile = this.getProfile(sessionId);
    const taxSummary = calculateTaxComparison(normalizedInputs);
    const validation = validateReturnData(
      profile,
      normalizedInputs,
      selectedRegime,
      docs,
      unsupportedScenarios
    );
    const itrJson = buildStructuredItr1Json(
      profile,
      normalizedInputs,
      selectedRegime,
      taxSummary,
      version
    );

    const status: ReturnDraft['status'] =
      validation.unsupportedScenarios.length > 0
        ? 'blocked_unsupported'
        : validation.errorCount === 0 &&
            validation.warningCount === 0 &&
            normalizedInputs.grossSalary > 0
          ? 'validated_ready'
          : version > 1
            ? 'reconciled'
            : 'draft_in_progress';

    return {
      id: `draft-${sessionId}-v${version}`,
      sessionId,
      version,
      status,
      selectedRegime,
      inputs: normalizedInputs,
      taxSummary,
      validation,
      itrJson,
      changeNote,
      approvedBy,
      createdAt: new Date().toISOString(),
    };
  }

  private insertDraftRow(draft: ReturnDraft): void {
    this.db
      .prepare(
        `INSERT INTO drafts (
          id, session_id, version, status, selected_regime, inputs_json,
          tax_summary_json, validation_json, itr_json, change_note, approved_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          selected_regime = excluded.selected_regime,
          inputs_json = excluded.inputs_json,
          tax_summary_json = excluded.tax_summary_json,
          validation_json = excluded.validation_json,
          itr_json = excluded.itr_json`
      )
      .run(
        draft.id,
        draft.sessionId,
        draft.version,
        draft.status,
        draft.selectedRegime,
        JSON.stringify(draft.inputs),
        JSON.stringify(draft.taxSummary),
        JSON.stringify(draft.validation),
        JSON.stringify(draft.itrJson),
        draft.changeNote,
        draft.approvedBy,
        draft.createdAt
      );
  }

  public getDrafts(sessionId = this.activeSessionId): ReturnDraft[] {
    const rows = this.db
      .prepare('SELECT * FROM drafts WHERE session_id = ? ORDER BY version ASC')
      .all(sessionId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      sessionId: String(r.session_id),
      version: Number(r.version),
      status: r.status as ReturnDraft['status'],
      selectedRegime: r.selected_regime as TaxRegime,
      inputs: { ...EMPTY_INPUTS, ...JSON.parse(String(r.inputs_json)) },
      taxSummary: JSON.parse(String(r.tax_summary_json)),
      validation: JSON.parse(String(r.validation_json)),
      itrJson: JSON.parse(String(r.itr_json)),
      changeNote: String(r.change_note),
      approvedBy: String(r.approved_by),
      createdAt: String(r.created_at),
    }));
  }

  public getActiveDraft(sessionId = this.activeSessionId): ReturnDraft {
    const drafts = this.getDrafts(sessionId);
    return drafts[drafts.length - 1];
  }

  public refreshActiveDraftValidation(sessionId = this.activeSessionId): void {
    const drafts = this.getDrafts(sessionId);
    if (drafts.length === 0) return;
    const latest = drafts[drafts.length - 1];
    const docs = this.getDocuments(sessionId);
    const session = this.getActiveSession(sessionId);
    const updated = this.buildDraftObject(
      sessionId,
      latest.version,
      latest.selectedRegime,
      latest.inputs,
      docs,
      session.unsupportedScenarios,
      latest.changeNote,
      latest.approvedBy
    );
    this.insertDraftRow(updated);
  }

  public commitNewDraft(
    params: {
      inputs?: Partial<ReturnFinancialInputs>;
      selectedRegime?: TaxRegime;
      changeNote: string;
      approvedBy: string;
    },
    sessionId = this.activeSessionId
  ): ReturnDraft {
    const current = this.getActiveDraft(sessionId);
    const nextVersion = current.version + 1;
    const mergedInputs: ReturnFinancialInputs = {
      ...EMPTY_INPUTS,
      ...current.inputs,
      ...(params.inputs ?? {}),
    };
    const nextRegime = params.selectedRegime ?? current.selectedRegime;
    const docs = this.getDocuments(sessionId);
    const session = this.getActiveSession(sessionId);

    const newDraft = this.buildDraftObject(
      sessionId,
      nextVersion,
      nextRegime,
      mergedInputs,
      docs,
      session.unsupportedScenarios,
      params.changeNote,
      params.approvedBy
    );

    this.insertDraftRow(newDraft);

    const activeCalc =
      nextRegime === 'new' ? newDraft.taxSummary.newRegime : newDraft.taxSummary.oldRegime;
    this.db
      .prepare('DELETE FROM ledger_entries WHERE session_id = ? AND source_type = ?')
      .run(sessionId, 'system_calculated');

    this.addLedgerEntry({
      sessionId,
      sourceType: 'system_calculated',
      category: 'computed_metric',
      field: 'taxableIncome',
      label: `Taxable Income (${nextRegime.toUpperCase()} Regime)`,
      amount: activeCalc.taxableIncome,
      status: 'confirmed',
      notes: `Deterministic YAML Engine ${newDraft.taxSummary.ruleEngineVersion}`,
    });
    this.addLedgerEntry({
      sessionId,
      sourceType: 'system_calculated',
      category: 'computed_metric',
      field: 'totalTaxLiability',
      label: `Total Tax Liability (${nextRegime.toUpperCase()} Regime)`,
      amount: activeCalc.totalTaxLiability,
      status: 'confirmed',
      notes: `Rebate 87A ₹${activeCalc.rebate87A.toLocaleString('en-IN')} + 4% Cess ₹${activeCalc.healthAndEducationCess.toLocaleString('en-IN')}`,
    });

    const currentStates = this.getFieldStates(sessionId);
    const inputLabels: Partial<Record<keyof ReturnFinancialInputs, { section: string; label: string }>> = {
      grossSalary: { section: 'C', label: 'Gross Salary' },
      basicSalary: { section: 'C', label: 'Basic Salary' },
      hraExemption: { section: 'C', label: 'Exempt Allowances / HRA' },
      professionalTax: { section: 'C', label: 'Professional Tax' },
      savingsInterest: { section: 'D', label: 'Savings Bank Interest' },
      fdInterest: { section: 'D', label: 'Fixed Deposit Interest' },
      otherIncome: { section: 'D', label: 'Other Income' },
      section80C: { section: 'E', label: 'Section 80C' },
      section80CCD1: { section: 'E', label: 'Section 80CCD(1)' },
      section80CCD1B: { section: 'E', label: 'Section 80CCD(1B) NPS' },
      section80CCD2: { section: 'E', label: 'Section 80CCD(2)' },
      section80D: { section: 'E', label: 'Section 80D (Self & Family)' },
      section80DParents: { section: 'E', label: 'Section 80D (Parents)' },
      tdsClaimed: { section: 'H', label: 'Total TDS Credit' },
      advanceTax: { section: 'H', label: 'Advance / Self-Assessment Tax' },
    };

    if (params.inputs) {
      for (const [key, val] of Object.entries(params.inputs)) {
        const meta = inputLabels[key as keyof ReturnFinancialInputs];
        if (!meta || typeof val !== 'number') continue;
        const existingState = currentStates[key];
        this.upsertFieldState(
          sessionId,
          {
            fieldKey: key,
            sectionCode: meta.section,
            label: meta.label,
            status: existingState?.editedByUser ? 'user_edited' : 'verified',
            stagedValue: val,
            sourceDocument: existingState?.sourceDocument || params.approvedBy,
            pageNumber: existingState?.pageNumber,
            confidence: existingState?.confidence ?? 1,
            editedByUser: existingState?.editedByUser,
            updatedAt: new Date().toISOString(),
          },
          { respectUserEdit: false }
        );
      }
    }

    const nextSessionStatus: FilingSession['status'] =
      newDraft.validation.unsupportedScenarios.length > 0
        ? 'unsupported_scenario'
        : newDraft.status === 'validated_ready'
          ? 'ready_to_download'
          : 'reconciling';

    this.db
      .prepare(
        'UPDATE sessions SET active_draft_version = ?, status = ?, updated_at = ? WHERE id = ?'
      )
      .run(nextVersion, nextSessionStatus, new Date().toISOString(), sessionId);

    return newDraft;
  }

  public confirmOrEditField(params: {
    fieldKey: string;
    action: 'confirm' | 'edit' | 'reject';
    numericValue?: number;
    stringValue?: string;
    reason?: string;
    sessionId?: string;
  }): { fieldState: FieldFillingState; draft: ReturnDraft } {
    const sessionId = params.sessionId || this.activeSessionId;
    const states = this.getFieldStates(sessionId);
    const existing = states[params.fieldKey];
    const currentDraft = this.getActiveDraft(sessionId);
    const profile = this.getProfile(sessionId);
    const now = new Date().toISOString();

    const FINANCIAL_KEYS = new Set<string>([
      'grossSalary',
      'basicSalary',
      'hraExemption',
      'professionalTax',
      'savingsInterest',
      'fdInterest',
      'otherIncome',
      'section80C',
      'section80CCD1',
      'section80CCD1B',
      'section80CCD2',
      'section80D',
      'section80DParents',
      'tdsClaimed',
      'advanceTax',
    ]);

    const PROFILE_KEYS = new Set<string>([
      'fullName',
      'pan',
      'aadhaarLast4',
      'dateOfBirth',
      'email',
      'phone',
      'address',
      'employerName',
      'employerTan',
      'bankName',
      'bankIfsc',
      'bankAccountNumber',
      'verificationPlace',
      'verificationConfirmed',
      'preferredRegime',
    ]);

    const label = existing?.label || params.fieldKey;
    const sectionCode = existing?.sectionCode || (PROFILE_KEYS.has(params.fieldKey) ? 'A' : 'F');

    if (params.action === 'reject') {
      const nextState: FieldFillingState = {
        fieldKey: params.fieldKey,
        sectionCode,
        label,
        status: 'rejected',
        stagedValue: existing?.stagedValue ?? null,
        sourceDocument: existing?.sourceDocument,
        pageNumber: existing?.pageNumber,
        confidence: existing?.confidence,
        updatedAt: now,
        editedByUser: true,
      };
      this.upsertFieldState(sessionId, nextState);
      this.recordAudit({
        sessionId,
        actor: 'taxpayer_human',
        toolName: 'reject_operation',
        operation: `reject_field_${params.fieldKey}`,
        decision: 'REJECTED_BY_HUMAN',
        executionStatus: 'rejected',
        piiFieldsMasked: 0,
        maskedPayloadPreview: JSON.stringify({ fieldKey: params.fieldKey, reason: params.reason }),
        details: `Taxpayer rejected extracted value for ${label} (${params.fieldKey}).`,
      });
      this.emitLiveEvent({
        sessionId,
        type: 'form_field_updated',
        stage: 'field_review',
        title: `Excluded ${label}`,
        message: `Kept current return value and excluded extracted candidate for ${label}.`,
        fieldKey: params.fieldKey,
        fieldLabel: label,
        sectionCode,
        verificationStatus: 'rejected',
        status: 'completed',
      });
      return { fieldState: nextState, draft: currentDraft };
    }

    if (FINANCIAL_KEYS.has(params.fieldKey)) {
      const targetNumber =
        params.action === 'edit'
          ? Number(params.numericValue ?? 0)
          : Number(
              params.numericValue ??
                existing?.stagedValue ??
                currentDraft.inputs[params.fieldKey as keyof ReturnFinancialInputs] ??
                0
            );

      if (!Number.isFinite(targetNumber) || targetNumber < 0) {
        throw new Error(`Invalid non-negative value for ${label}.`);
      }

      this.emitLiveEvent({
        sessionId,
        type: 'form_field_update_started',
        stage: 'form_filling',
        title: `Updating ${label}`,
        message: `Saving ${label} = ₹${Math.round(targetNumber).toLocaleString('en-IN')} into Section ${sectionCode}.`,
        fieldKey: params.fieldKey,
        fieldLabel: label,
        sectionCode,
        numericValue: targetNumber,
        safeValue: `₹${Math.round(targetNumber).toLocaleString('en-IN')}`,
        status: 'active',
      });

      const isEdit = params.action === 'edit';
      const nextState: FieldFillingState = {
        fieldKey: params.fieldKey,
        sectionCode,
        label,
        status: isEdit ? 'user_edited' : 'verified',
        stagedValue: targetNumber,
        sourceDocument: isEdit ? 'Manual Taxpayer Entry' : existing?.sourceDocument || 'Verified by Taxpayer',
        pageNumber: isEdit ? undefined : existing?.pageNumber,
        confidence: 1,
        updatedAt: now,
        editedByUser: isEdit ? true : existing?.editedByUser,
      };
      this.upsertFieldState(sessionId, nextState);

      this.db
        .prepare('UPDATE ledger_entries SET status = ? WHERE session_id = ? AND field = ?')
        .run('confirmed', sessionId, params.fieldKey);

      if (isEdit) {
        this.addLedgerEntry({
          sessionId,
          sourceType: 'user_provided',
          category: params.fieldKey.toLowerCase().includes('tds') || params.fieldKey === 'advanceTax'
            ? 'tax_credit'
            : params.fieldKey.startsWith('section80') || params.fieldKey === 'hraExemption'
              ? 'deduction'
              : 'income',
          field: params.fieldKey,
          label,
          amount: targetNumber,
          status: 'confirmed',
          notes: params.reason || 'Manually edited in Live ITR-1 Workspace.',
        });
      }

      const nextDraft = this.commitNewDraft(
        {
          inputs: { [params.fieldKey]: targetNumber } as Partial<ReturnFinancialInputs>,
          changeNote:
            params.reason ||
            `${isEdit ? 'Manually updated' : 'Confirmed'} ${label} (₹${Math.round(targetNumber).toLocaleString('en-IN')})`,
          approvedBy: isEdit ? 'Taxpayer Manual Edit' : 'Taxpayer Direct Confirmation',
        },
        sessionId
      );

      this.recordAudit({
        sessionId,
        actor: 'taxpayer_human',
        toolName: 'update_return_information',
        operation: `${params.action}_field_${params.fieldKey}`,
        decision: 'ALLOWED_EXECUTED',
        executionStatus: 'executed',
        piiFieldsMasked: 0,
        maskedPayloadPreview: JSON.stringify({
          fieldKey: params.fieldKey,
          amount: targetNumber,
          action: params.action,
        }),
        details: `Taxpayer ${params.action === 'edit' ? 'edited' : 'confirmed'} ${label} = ₹${Math.round(targetNumber).toLocaleString('en-IN')}.`,
      });

      this.emitLiveEvent({
        sessionId,
        type: 'form_field_updated',
        stage: 'form_filling',
        title: `${label} ${isEdit ? 'Edited' : 'Confirmed'}`,
        message: `${label} updated to ₹${Math.round(targetNumber).toLocaleString('en-IN')}.`,
        fieldKey: params.fieldKey,
        fieldLabel: label,
        sectionCode,
        numericValue: targetNumber,
        safeValue: `₹${Math.round(targetNumber).toLocaleString('en-IN')}`,
        documentName: nextState.sourceDocument,
        verificationStatus: nextState.status,
        status: 'completed',
      });

      const activeCalc =
        nextDraft.selectedRegime === 'new'
          ? nextDraft.taxSummary.newRegime
          : nextDraft.taxSummary.oldRegime;

      this.emitLiveEvent({
        sessionId,
        type: 'tax_computation_completed',
        stage: 'tax_calculation',
        title: 'Tax Liability Recalculated',
        message: `${nextDraft.selectedRegime.toUpperCase()} Regime tax liability updated to ₹${activeCalc.totalTaxLiability.toLocaleString('en-IN')}.`,
        sectionCode: 'G',
        safeValue: `₹${activeCalc.totalTaxLiability.toLocaleString('en-IN')}`,
        numericValue: activeCalc.totalTaxLiability,
        verificationStatus: 'calculated',
        status: 'completed',
      });

      return { fieldState: nextState, draft: nextDraft };
    }

    if (PROFILE_KEYS.has(params.fieldKey)) {
      const val =
        params.fieldKey === 'verificationConfirmed'
          ? params.stringValue === 'true' || params.numericValue === 1
          : String(params.stringValue ?? existing?.stagedValue ?? (profile as unknown as Record<string, unknown>)[params.fieldKey] ?? '');

      if (params.fieldKey === 'preferredRegime' && (val === 'new' || val === 'old')) {
        const nextDraft = this.commitNewDraft(
          {
            selectedRegime: val,
            changeNote: `Switched preferred tax regime to ${val.toUpperCase()} Regime`,
            approvedBy: 'Taxpayer Selection',
          },
          sessionId
        );
        this.updateProfile({ preferredRegime: val }, sessionId);
        const state: FieldFillingState = {
          fieldKey: 'preferredRegime',
          sectionCode: 'B',
          label: 'Tax Regime Selection',
          status: 'user_edited',
          stagedValue: val,
          sourceDocument: 'Taxpayer Selection',
          updatedAt: now,
          editedByUser: true,
        };
        this.upsertFieldState(sessionId, state);
        return { fieldState: state, draft: nextDraft };
      }

      this.updateProfile({ [params.fieldKey]: val } as Partial<UserProfile>, sessionId);
      const nextDraft = this.getActiveDraft(sessionId);
      const state: FieldFillingState = {
        fieldKey: params.fieldKey,
        sectionCode,
        label,
        status: params.action === 'edit' ? 'user_edited' : 'verified',
        stagedValue: typeof val === 'boolean' ? (val ? 'Confirmed' : 'Pending') : String(val),
        sourceDocument: params.action === 'edit' ? 'Manual Taxpayer Entry' : existing?.sourceDocument || 'Taxpayer Profile',
        updatedAt: now,
        editedByUser: params.action === 'edit',
      };
      this.upsertFieldState(sessionId, state);
      this.emitLiveEvent({
        sessionId,
        type: 'form_field_updated',
        stage: 'form_filling',
        title: `Updated ${label}`,
        message: `Updated ${label} in Section ${sectionCode}.`,
        fieldKey: params.fieldKey,
        fieldLabel: label,
        sectionCode,
        verificationStatus: state.status,
        status: 'completed',
      });
      return { fieldState: state, draft: nextDraft };
    }

    if (
      params.fieldKey === 'hasSeniorParents' ||
      params.fieldKey === 'isGovernmentEmployer'
    ) {
      const boolVal =
        params.stringValue === 'true' || params.numericValue === 1;
      const friendlyLabel =
        params.fieldKey === 'hasSeniorParents'
          ? 'Senior Parents Health Coverage (60+)'
          : 'Government Employer (NPS 80CCD(2) 14% cap)';
      const nextDraft = this.commitNewDraft(
        {
          inputs: { [params.fieldKey]: boolVal } as Partial<ReturnFinancialInputs>,
          changeNote:
            params.reason ||
            `Updated ${friendlyLabel} to ${boolVal ? 'Yes' : 'No'}`,
          approvedBy: 'Taxpayer Toggle',
        },
        sessionId
      );
      const nextState: FieldFillingState = {
        fieldKey: params.fieldKey,
        sectionCode: params.fieldKey === 'hasSeniorParents' ? 'E' : 'A',
        label: friendlyLabel,
        status: 'user_edited',
        stagedValue: boolVal ? 'Yes' : 'No',
        sourceDocument: 'Taxpayer Selection',
        updatedAt: now,
        editedByUser: true,
      };
      this.upsertFieldState(sessionId, nextState);
      this.recordAudit({
        sessionId,
        actor: 'taxpayer_human',
        toolName: 'update_return_information',
        operation: `toggle_${params.fieldKey}`,
        decision: 'ALLOWED_EXECUTED',
        executionStatus: 'executed',
        piiFieldsMasked: 0,
        maskedPayloadPreview: JSON.stringify({
          fieldKey: params.fieldKey,
          enabled: boolVal,
        }),
        details: `Updated ${friendlyLabel} to ${boolVal ? 'enabled' : 'disabled'}.`,
      });
      return { fieldState: nextState, draft: nextDraft };
    }

    throw new Error(`Unsupported field key: ${params.fieldKey}`);
  }

  // --- Approvals ---
  private mapApprovalRow(r: Record<string, unknown>): ApprovalRequest {
    return {
      id: String(r.id),
      sessionId: String(r.session_id),
      idempotencyKey: String(r.idempotency_key || ''),
      toolName: r.tool_name as McpToolName,
      operationType: r.operation_type as ApprovalRequest['operationType'],
      requestedBy: r.requested_by as ApprovalRequest['requestedBy'],
      status: r.status as ApprovalRequest['status'],
      riskLevel: r.risk_level as ApprovalRequest['riskLevel'],
      summary: String(r.summary),
      justification: String(r.justification),
      relevantAmount:
        typeof r.relevant_amount === 'number' ? Number(r.relevant_amount) : undefined,
      sourceDocumentName: r.source_doc_name ? String(r.source_doc_name) : undefined,
      taxImpactSummary: r.tax_impact_summary ? String(r.tax_impact_summary) : undefined,
      rawArguments: JSON.parse(String(r.raw_args_json)),
      maskedArguments: JSON.parse(String(r.masked_args_json)),
      diffs: JSON.parse(String(r.diffs_json)),
      createdAt: String(r.created_at),
      expiresAt: r.expires_at ? String(r.expires_at) : undefined,
      decidedAt: r.decided_at ? String(r.decided_at) : undefined,
      decisionNote: r.decision_note ? String(r.decision_note) : undefined,
      executionResultSummary: r.execution_result_summary
        ? String(r.execution_result_summary)
        : undefined,
    };
  }

  public getApprovals(sessionId = this.activeSessionId): ApprovalRequest[] {
    const rows = this.db
      .prepare('SELECT * FROM approvals WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId) as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapApprovalRow(r));
  }

  public addApprovalRequest(req: ApprovalRequest): ApprovalRequest {
    this.db
      .prepare(
        `INSERT INTO approvals (
          id, session_id, idempotency_key, tool_name, operation_type, requested_by, status,
          risk_level, summary, justification, relevant_amount, source_doc_name,
          tax_impact_summary, raw_args_json, masked_args_json, diffs_json, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.id,
        req.sessionId,
        req.idempotencyKey,
        req.toolName,
        req.operationType,
        req.requestedBy,
        req.status,
        req.riskLevel,
        req.summary,
        req.justification,
        req.relevantAmount ?? null,
        req.sourceDocumentName ?? null,
        req.taxImpactSummary ?? null,
        JSON.stringify(req.rawArguments),
        JSON.stringify(req.maskedArguments),
        JSON.stringify(req.diffs),
        req.createdAt,
        req.expiresAt ?? null
      );

    this.setAgentState('WAITING_FOR_HUMAN_APPROVAL', 'pending_approval', req.sessionId);
    return req;
  }

  public getApprovalById(approvalId: string): ApprovalRequest | undefined {
    const row = this.db
      .prepare('SELECT * FROM approvals WHERE id = ?')
      .get(approvalId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.mapApprovalRow(row);
  }

  public updateApprovalStatus(params: {
    approvalId: string;
    status: ApprovalRequest['status'];
    decisionNote: string;
    executionResultSummary: string;
  }): ApprovalRequest {
    const existing = this.getApprovalById(params.approvalId);
    if (!existing) throw new Error(`Approval ${params.approvalId} not found.`);

    const decidedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE approvals
         SET status = ?, decided_at = ?, decision_note = ?, execution_result_summary = ?
         WHERE id = ?`
      )
      .run(
        params.status,
        decidedAt,
        params.decisionNote,
        params.executionResultSummary,
        params.approvalId
      );

    const remainingPending = this.getApprovals(existing.sessionId).some(
      (a) => a.status === 'pending'
    );
    if (!remainingPending) {
      const session = this.getActiveSession(existing.sessionId);
      const latestDraft = this.getActiveDraft(existing.sessionId);
      if (session.unsupportedScenarios.length > 0) {
        this.setAgentState(
          'HALTED_UNSUPPORTED_SCENARIO',
          'unsupported_scenario',
          existing.sessionId
        );
      } else if (params.status === 'failed') {
        this.setAgentState('ERROR', 'reconciling', existing.sessionId);
      } else if (latestDraft.status === 'validated_ready') {
        this.setAgentState('COMPLETED', 'ready_to_download', existing.sessionId);
      } else {
        this.setAgentState('IDLE', 'reconciling', existing.sessionId);
      }
    }

    return this.getApprovalById(params.approvalId)!;
  }

  // --- Chat Messages ---
  public getChatHistory(sessionId = this.activeSessionId): ChatMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC')
      .all(sessionId) as Array<Record<string, unknown>>;

    return rows.map((r) => {
      const extra = JSON.parse(String(r.extra_json || '{}'));
      if (extra.agentStateAfterTurn) {
        extra.agentStateAfterTurn = normalizeAgentState(String(extra.agentStateAfterTurn));
      }
      return {
        id: String(r.id),
        role: r.role as ChatMessage['role'],
        content: String(r.content),
        timestamp: String(r.timestamp),
        ...extra,
      };
    });
  }

  public appendChatMessage(
    msg: ChatMessage,
    sessionId = this.activeSessionId
  ): ChatMessage {
    const { id, role, content, timestamp, ...extra } = msg;
    this.db
      .prepare(
        `INSERT INTO chat_messages (id, session_id, role, content, timestamp, extra_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, sessionId, role, content, timestamp, JSON.stringify(extra));
    return msg;
  }

  // --- Hash-Chained Redacted Audit Logs ---
  private computeAuditHash(params: {
    previousHash: string;
    timestamp: string;
    sessionId: string;
    actor: string;
    toolName: string;
    operation: string;
    decision: string;
    executionStatus: string;
    approvalRequestId?: string;
    maskedPayloadPreview: string;
  }): string {
    const canonical = [
      params.previousHash,
      params.timestamp,
      params.sessionId,
      params.actor,
      params.toolName,
      params.operation,
      params.decision,
      params.executionStatus,
      params.approvalRequestId || '',
      params.maskedPayloadPreview,
    ].join('|');
    return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 24);
  }

  public recordAudit(params: {
    sessionId?: string;
    actor: SecurityAuditEntry['actor'];
    toolName: McpToolName | 'document_acl_change';
    operation?: string;
    decision: GatewayDecision;
    executionStatus?: AuditExecutionStatus;
    approvalRequestId?: string;
    piiFieldsMasked: number;
    maskedPayloadPreview: string;
    unmaskedPayloadPreview?: string;
    details: string;
  }): SecurityAuditEntry {
    const sessionId = params.sessionId || this.activeSessionId;
    const prevRow = this.db
      .prepare(
        'SELECT integrity_hash FROM audit_logs WHERE session_id = ? ORDER BY rowid DESC LIMIT 1'
      )
      .get(sessionId) as { integrity_hash: string } | undefined;
    const previousHash = prevRow?.integrity_hash || 'GENESIS_0000000000000000';

    const timestamp = new Date().toISOString();
    const operation = params.operation || String(params.toolName);
    const executionStatus: AuditExecutionStatus =
      params.executionStatus ||
      (params.decision === 'HELD_FOR_HUMAN_APPROVAL'
        ? 'held_for_approval'
        : params.decision === 'REJECTED_BY_HUMAN'
          ? 'rejected'
          : params.decision === 'CANCELLED_BY_USER'
            ? 'cancelled'
            : params.decision === 'EXECUTION_FAILED'
              ? 'failed'
              : params.decision.startsWith('BLOCKED_')
                ? 'blocked'
                : 'executed');

    const safeMaskedPreview = redactAuditText(params.maskedPayloadPreview).slice(0, 320);
    const safeDetails = redactAuditText(params.details);

    const integrityHash = this.computeAuditHash({
      previousHash,
      timestamp,
      sessionId,
      actor: params.actor,
      toolName: params.toolName,
      operation,
      decision: params.decision,
      executionStatus,
      approvalRequestId: params.approvalRequestId,
      maskedPayloadPreview: safeMaskedPreview,
    });

    const entry: SecurityAuditEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId,
      timestamp,
      actor: params.actor,
      toolName: params.toolName,
      operation,
      decision: params.decision,
      executionStatus,
      approvalRequestId: params.approvalRequestId,
      piiFieldsMasked: params.piiFieldsMasked,
      maskedPayloadPreview: safeMaskedPreview,
      previousHash,
      integrityHash,
      details: safeDetails,
    };

    try {
      this.db
        .prepare(
          `INSERT INTO audit_logs (
            id, session_id, timestamp, actor, tool_name, operation, decision,
            execution_status, approval_request_id, pii_fields_masked,
            masked_payload_preview, previous_hash, integrity_hash, details
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          entry.id,
          entry.sessionId,
          entry.timestamp,
          entry.actor,
          entry.toolName,
          entry.operation,
          entry.decision,
          entry.executionStatus,
          entry.approvalRequestId ?? null,
          entry.piiFieldsMasked,
          entry.maskedPayloadPreview,
          entry.previousHash,
          entry.integrityHash,
          entry.details
        );
    } catch {
      // Fallback if legacy table still requires unmasked_payload_preview NOT NULL
      this.db
        .prepare(
          `INSERT INTO audit_logs (
            id, session_id, timestamp, actor, tool_name, operation, decision,
            execution_status, approval_request_id, pii_fields_masked,
            masked_payload_preview, unmasked_payload_preview, previous_hash, integrity_hash, details
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          entry.id,
          entry.sessionId,
          entry.timestamp,
          entry.actor,
          entry.toolName,
          entry.operation,
          entry.decision,
          entry.executionStatus,
          entry.approvalRequestId ?? null,
          entry.piiFieldsMasked,
          entry.maskedPayloadPreview,
          '[REDACTED_AT_STORAGE]',
          entry.previousHash,
          entry.integrityHash,
          entry.details
        );
    }

    return entry;
  }

  public getAuditLogs(sessionId = this.activeSessionId): SecurityAuditEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_logs WHERE session_id = ? ORDER BY rowid DESC LIMIT 120')
      .all(sessionId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      sessionId: String(r.session_id),
      timestamp: String(r.timestamp),
      actor: r.actor as SecurityAuditEntry['actor'],
      toolName: r.tool_name as SecurityAuditEntry['toolName'],
      operation: String(r.operation || r.tool_name),
      decision: r.decision as GatewayDecision,
      executionStatus: (r.execution_status || 'executed') as AuditExecutionStatus,
      approvalRequestId: r.approval_request_id ? String(r.approval_request_id) : undefined,
      piiFieldsMasked: Number(r.pii_fields_masked),
      maskedPayloadPreview: redactAuditText(String(r.masked_payload_preview)),
      previousHash: String(r.previous_hash || 'GENESIS_0000000000000000'),
      integrityHash: String(r.integrity_hash),
      details: redactAuditText(String(r.details)),
    }));
  }

  public verifyAuditHashChain(sessionId = this.activeSessionId): boolean {
    const rows = this.db
      .prepare('SELECT * FROM audit_logs WHERE session_id = ? ORDER BY rowid ASC')
      .all(sessionId) as Array<Record<string, unknown>>;

    let expectedPrev = 'GENESIS_0000000000000000';
    for (const r of rows) {
      const prevHash = String(r.previous_hash || '');
      // Legacy rows created before per-session chain migration skip strict genesis check
      if (!r.operation) {
        expectedPrev = String(r.integrity_hash);
        continue;
      }
      if (prevHash !== expectedPrev) return false;
      const computed = this.computeAuditHash({
        previousHash: prevHash,
        timestamp: String(r.timestamp),
        sessionId: String(r.session_id),
        actor: String(r.actor),
        toolName: String(r.tool_name),
        operation: String(r.operation),
        decision: String(r.decision),
        executionStatus: String(r.execution_status || 'executed'),
        approvalRequestId: r.approval_request_id ? String(r.approval_request_id) : undefined,
        maskedPayloadPreview: String(r.masked_payload_preview),
      });
      if (computed !== String(r.integrity_hash)) return false;
      expectedPrev = computed;
    }
    return true;
  }

  public getGatewayConfig(): SecurityGatewayConfig {
    return { ...this.gatewayConfig };
  }

  public updateGatewayConfig(partial: Partial<SecurityGatewayConfig>): SecurityGatewayConfig {
    this.gatewayConfig = { ...this.gatewayConfig, ...partial };
    this.recordAudit({
      actor: 'taxpayer_human',
      toolName: 'check_permissions',
      operation: 'update_gateway_policy',
      decision: 'ALLOWED_EXECUTED',
      executionStatus: 'executed',
      piiFieldsMasked: 0,
      maskedPayloadPreview: JSON.stringify(this.gatewayConfig),
      details: 'Updated SecurityGateway policy configuration.',
    });
    return this.getGatewayConfig();
  }

  public findCategoryByName(hint: string): DocumentCategory {
    const lower = hint.toLowerCase();
    if (lower.includes('26as')) return 'form_26as';
    if (lower.includes('tis')) return 'tis';
    if (lower.includes('ais')) return 'ais';
    if (lower.includes('16')) return 'form_16';
    if (lower.includes('slip') || lower.includes('payroll')) return 'salary_slips';
    if (
      lower.includes('fd_cert') ||
      lower.includes('interest_cert') ||
      lower.includes('certificate') ||
      lower.includes('fixed_deposit')
    )
      return 'interest_certificates';
    if (lower.includes('bank') || lower.includes('savings') || lower.includes('statement'))
      return 'bank_statements';
    if (
      lower.includes('proof') ||
      lower.includes('80c') ||
      lower.includes('elss') ||
      lower.includes('ppf')
    )
      return 'investment_proofs';
    return 'other_tax_doc';
  }

  public getSnapshot(
    llmStatus: WorkspaceSnapshot['llmStatus'] = {
      activeProvider: 'gemini_cloud',
      configuredModel: 'gemini-3.1-flash-lite',
      ollamaReachable: false,
      ollamaUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    }
  ): WorkspaceSnapshot {
    const documents = this.getDocuments();
    const activeDraft = this.getActiveDraft();
    const reconciliation = reconcileDocumentsAndReturn(documents, activeDraft.inputs);
    const activeSession = this.getActiveSession();

    // Mask profile PAN/Bank/Phone when serializing snapshot? Keep taxpayer's own profile editable,
    // while ensuring 100% of auditLogs are strictly PII-redacted without unmaskedPayloadPreview!
    return {
      profile: this.getProfile(),
      sessions: this.getSessions(),
      activeSessionId: this.activeSessionId,
      activeSession,
      documents,
      ledger: this.getLedgerEntries(),
      drafts: this.getDrafts(),
      activeDraft,
      reconciliation,
      approvals: this.getApprovals(),
      auditLogs: this.getAuditLogs(),
      auditChainValid: this.verifyAuditHashChain(),
      chatHistory: this.getChatHistory(),
      gatewayConfig: this.getGatewayConfig(),
      llmStatus,
      ruleVerification: getRuleVerificationMetadata(),
      liveEvents: this.getLiveEvents(),
      fieldStates: this.getFieldStates(),
    };
  }
}

export const workspaceStore = new SqliteTaxWorkspaceStore();
