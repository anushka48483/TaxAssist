# TaxShield MCP — Complete Technical Documentation, Research Reference & Live Demonstration Guide

> **Project Name:** TaxShield MCP — Autonomous Agentic AI Income Tax Filing Assistant  
> **Domain:** Indian Income Tax Preparation (`ITR-1 Sahaj`, Assessment Year `2026-27` / Financial Year `2025-26`)  
> **Safety Boundary:** Local ITR-1 JSON draft preparation and verification only. The application never connects to or submits returns to the official Income Tax Department e-Filing portal.

---

## 1. Executive Summary & Problem Statement

Filing personal income taxes in India requires extracting heterogeneous fields from PDFs and scanned statements (Form 16, bank passbooks, FD certificates, investment proofs, Form 26AS/AIS), reconciling discrepancies without double-counting, applying statutory rules accurately across competing tax regimes (Old Regime vs. New Regime under Section 115BAC(1A)), and protecting sensitive Personally Identifiable Information (PII) such as PAN, Aadhaar, TAN, and bank account numbers.

Purely prompt-based LLM chatbots fail in high-stakes tax workflows due to:
1. **Arithmetic & Statutory Hallucination:** LLMs miscompute slab rates, Section 87A rebates, marginal relief, or Section 288A/288B rounding.
2. **Silent Data Corruption:** Naive AI agents overwrite verified figures or conflate **Savings Bank Interest** (eligible for Section 80TTA up to ₹10,000 in Old Regime) with **Fixed Deposit Interest** (excluded from Section 80TTA).
3. **Uncontrolled Tool Execution & PII Exposure:** Unchecked agents can mutate state without user consent or leak raw PAN/account numbers to cloud models and logs.

**TaxShield MCP** solves these problems through a **neuro-symbolic, zero-trust agentic architecture**:
- **Symbolic / Deterministic Authority:** All tax math, rounding, eligibility checks, and ITR-1 JSON generation run deterministically in TypeScript driven by a Zod-validated statutory YAML specification (`rules/AY2026-27.yaml`), never inside LLM text generation.
- **Model Context Protocol (MCP) Tooling:** Exposes **22 structured MCP tools** over an in-memory `@modelcontextprotocol/sdk` server/client transport (`server/mcpServer.ts`).
- **Zero-Trust SecurityGateway (`server/securityGateway.ts`):** Enforces Zod input validation, path traversal prevention, Document Access Control Lists (ACL), PII masking before LLM exposure and audit logging, loop/duplicate-call guards, and **idempotent Human-in-the-Loop (HITL) approvals** where AI cannot self-approve mutations.
- **Tamper-Evident Audit Trail (`server/store.ts`):** Persists every decision in SQLite (`node:sqlite`) with a **SHA-256 hash chain** linking each entry to `previous_hash`.
- **Consumer-Grade 3-Step UX (`src/App.tsx`, `src/components/ConsumerFilingWorkspace.tsx`):** Hides internal system complexity behind a clean light-theme fintech workflow (`1. Upload Documents → 2. Review Numbers & Tax → 3. Approve & Submit`) with an on-demand RAG Tax Support copilot (`?` triggers), slab breakdown modal, plain-English approval dialog, and slide-over Activity & Security drawer.

---

## 2. Complete Technology Stack & Dependencies

### 2.1 Core Runtime & Language
| Layer | Technology / Package | Version | Role in System |
| :--- | :--- | :--- | :--- |
| **Runtime** | Node.js | `v22+` | Native `node:sqlite`, `node:test`, `node:crypto`, `node:zlib` |
| **Language** | TypeScript | `^7.0.2` (executed via `tsx ^4.21.0`) | End-to-end static typing across frontend, server, and shared schemas |
| **Frontend Framework** | React + React DOM | `^19.0.1` | Modular SPA component architecture |
| **Build Tool** | Vite + `@vitejs/plugin-react` | `^8.3.0` / `^6.1.1` | Fast bundling (`vite build`) and middleware mode inside Express |
| **Styling** | Tailwind CSS + `@tailwindcss/vite` | `^4.3.3` | Utility-first light-theme fintech UI (`#FFFFFF`, `#F8FAFC`, `#172B4D`, `#2563EB`, `#0D9488`) |
| **Icons & Motion** | `lucide-react`, `motion` | `^0.546.0`, `^12.23.24` | Crisp vector iconography and subtle UI transitions |
| **Markdown Rendering** | `react-markdown`, `remark-gfm` | `^10.1.0`, `^4.0.1` | Structured tables and citations inside Tax Support copilot |

### 2.2 Backend, AI, Document Intelligence & Security
| Layer | Technology / Package | Version | Role in System |
| :--- | :--- | :--- | :--- |
| **API Server** | Express (`express`, `http`) | `^4.21.2` | REST endpoints, static SPA serving, and Server-Sent Events (`/api/events`) |
| **File Upload** | `multer` | `^2.5.0` | In-memory multipart handling (`15 MB` limit, up to 10 batch files) |
| **Agent Protocol** | `@modelcontextprotocol/sdk` | `^1.32.2` | Official MCP `Server`, `Client`, and `InMemoryTransport` hosting 22 tools |
| **Cloud LLM SDK** | `@google/genai` | `^2.32.0` | Structured extraction & tool-calling cascade (`gemini-3.1-flash-lite` → `gemini-3.8-flash` → `gemini-flash-latest`) |
| **Local LLM Adapter** | Ollama HTTP API (`/api/chat`, `/api/tags`) | Local (`qwen3:8b`) | Privacy-preserving local LLM execution with automatic failover |
| **PDF Text Extraction** | `unpdf` | `^2.0.1` | Multi-page digital PDF parsing with 1-indexed page preservation |
| **Image OCR** | `tesseract.js` | `^7.0.0` | Client/server local OCR (`eng`) for scanned documents with confidence scoring |
| **Rule Specification** | `yaml` | `^2.9.1` | Parses statutory rule file `rules/AY2026-27.yaml` at runtime |
| **Schema Validation** | `zod` | `^4.6.7` | Validates both YAML tax rules and all MCP tool arguments |
| **Persistence** | `node:sqlite` (`DatabaseSync`) | Built-in Node 22 | Relational storage across 7 normalized tables (`data/taxshield.sqlite`) |
| **Archive & PDF Gen** | `node:zlib`, custom PDF 1.4 writer | Built-in | Generates standards-compliant 5-PDF sample pack inside PKZIP archive (`server/samplePdfPack.ts`) |

---

## 3. System Architecture & Data Flow

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ 1. PRESENTATION LAYER (React 19 + Tailwind CSS v4 + EventSource SSE)       │
│    • LandingPageView.tsx         • ConsumerFilingWorkspace.tsx (3 Steps)   │
│    • ChatSupportPanel.tsx (? RAG)• TaxBreakdownModal.tsx                   │
│    • ApprovalConfirmationModal   • ActivitySecurityDrawer.tsx              │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ REST JSON / Multipart / SSE (/api/events)
                                ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 2. EXPRESS API GATEWAY & LIVE PIPELINE (server.ts, Port 3000)              │
│    • File ingestion -> FACT_TO_ITR1_MAP real-time SSE field events         │
│    • Built-in Sample PDF ZIP generator (/api/demo/sample-documents.zip)    │
└───────┬───────────────────────┬──────────────────────────┬─────────────────┘
        │                       │                          │
        ▼                       ▼                          ▼
┌───────────────────┐  ┌─────────────────────┐  ┌────────────────────────────┐
│ 3. DOCUMENT INTEL │  │ 4. AGENT ORCHESTRATOR│  │ 5. ZERO-TRUST SECURITY     │
│ documentExtractor │  │ agentOrchestrator.ts │  │    GATEWAY                 │
│ • unpdf (PDF)     │  │ State Machine:       │  │ securityGateway.ts         │
│ • tesseract.js    │  │ IDLE → PLANNING →    │  │ • Path traversal block     │
│ • Gemini Vision / │  │ EXECUTING_TOOLS →    │  │ • AI self-approval block   │
│   Deterministic   │  │ WAITING_CLARIFICATION│  │ • Duplicate-loop guard     │
│ • Confidence <85% │  │ → WAITING_APPROVAL   │  │ • Zod schema enforcement   │
│   review gate     │  │ → COMPLETED / HALTED │  │ • Document ACL checks      │
└───────────────────┘  │ Auto-resumes post-   │  │ • Regex PII redaction      │
                       │ human decision!      │  │ • SHA-256 idempotency key  │
                       └──────────┬───────────┘  └─────────────┬──────────────┘
                                  │                            │
                                  └─────────────┬──────────────┘
                                                │ InMemoryTransport
                                                ▼
                       ┌────────────────────────────────────────┐
                       │ 6. MCP SERVER (22 Controlled Tools)    │
                       │    server/mcpServer.ts                 │
                       └───────┬───────────────────────┬────────┘
                               │                       │
             ┌─────────────────▼────┐         ┌────────▼──────────────────┐
             │ 7. SYMBOLIC TAX &    │         │ 8. PERSISTENCE & AUDIT    │
             │    RAG ENGINES       │         │    (server/store.ts)      │
             │ • taxEngine.ts       │         │ • 7 SQLite Tables         │
             │ • rules/AY2026-27    │         │ • User-edit protection    │
             │ • reconciliation.ts  │         │ • SHA-256 Hash-Chained    │
             │ • ragKnowledgeBase   │         │   Redacted Audit Log      │
             └──────────────────────┘         └───────────────────────────┘
```

---

## 4. Detailed Module-by-Module Engineering Breakdown

### 4.1 Statutory YAML Rule Engine & Deterministic Computation (`rules/AY2026-27.yaml`, `server/taxEngine.ts`)
Rather than hardcoding slabs or relying on LLM arithmetic, `taxEngine.ts` parses and Zod-validates `rules/AY2026-27.yaml` into `TaxRulesYamlSchema`. Every parameter carries an explicit official Income Tax Department URL and `verified_on` metadata (15 cited sources).

#### 10-Step Deterministic Calculation Order (`computeSingleRegime`)
1. **`compute_gross_salary_and_other_income`**: Sums `grossSalary` minus Old-Regime HRA exemption (`u/s 10(13A)`) + `savingsInterest` + `fdInterest` + `otherIncome`. Savings and FD interest are strictly tracked as separate fields (`income_rules`).
2. **`apply_standard_deduction`**: Applies `min(salaryAfterExemptions, ₹75,000)` in New Regime (`115BAC(1A)`) and `min(salaryAfterExemptions, ₹50,000)` in Old Regime, plus Old-Regime Professional Tax `u/s 16(iii)` capped at `₹2,500`.
3. **`apply_chapter_VIA_deductions`**:
   - **Section 80C + 80CCD(1):** Old Regime only, combined aggregate cap of `₹1,50,000` (`u/s 80CCE`), with `80CCD(1)` additionally capped at `10%` of salary base.
   - **Section 80CCD(1B):** Old Regime only, additional NPS cap of `₹50,000`.
   - **Section 80CCD(2) (Employer NPS):** Allowed in **both** regimes — capped at `14%` of basic salary in New Regime; `14%` (govt employer) or `10%` (private employer) in Old Regime.
   - **Section 80D (Medical Insurance):** Old Regime only — `₹25,000` self/family (`<60`) + `₹25,000` parents (`<60`) or `₹50,000` senior parents (`60+`).
   - **Section 80TTA:** Old Regime only, capped at `₹10,000` **exclusively on `savingsInterest` — never on `fdInterest`**.
4. **`total_income_before_rounding`**: `max(0, grossTotalIncome - totalChapterVIADeductions)`.
5. **`round_total_income` (Section 288A)**: Uses `roundSection288(amount, 10)` implementing `drop_paise_then_half_up` (`Math.floor(amount)` then round `remainder >= 5` up to nearest ₹10).
6. **`compute_slab_tax`**:
   - **New Regime (`115BAC(1A)`):** `0–4L: 0%`, `4–8L: 5%`, `8–12L: 10%`, `12–16L: 15%`, `16–20L: 20%`, `20–24L: 25%`, `>24L: 30%`.
   - **Old Regime (`<60 yrs`):** `0–2.5L: 0%`, `2.5–5L: 5%`, `5–10L: 20%`, `>10L: 30%`.
7. **`apply_87A_rebate_and_marginal_relief`**:
   - **New Regime:** Rebate up to `₹60,000` if `taxableIncome ≤ ₹12,00,000`; above `₹12,00,000`, **marginal relief** applies via `rebate = max(0, slabTax - (taxableIncome - 12,00,000))`.
   - **Old Regime:** Rebate up to `₹12,500` if `taxableIncome ≤ ₹5,00,000` (no marginal relief).
8. **`add_cess`**: `4%` Health & Education Cess (`Math.round(taxAfterRebate * 0.04)`).
9. **`subtract_tds_and_advance_tax`**: `rawNetDiff = totalTaxLiability - (tdsCredited + advanceTaxPaid)`.
10. **`round_net_payable_or_refund` (Section 288B)**: Rounds final `netTaxPayable` or `refundDue` to nearest `₹10` via `roundSection288`.

#### Scope Guardrails (`validateReturnData` & `detectUnsupportedFilingScenario`)
Automatically halts ITR-1 draft preparation on:
- Income `> ₹50,00,000` (ITR-1 statutory ceiling / surcharge zone)
- Age `≥ 60` (`Senior / Super-Senior Citizen` calculated against FY end `2026-04-01`)
- Multiple employer TANs across Form 16 uploads (`> 1`)
- Capital gains (`STCG`/`LTCG`), Virtual Digital Assets / Crypto (`u/s 115BBH`), business/freelance/F&O income (`44AD`/`44ADA`), house property/rental income, foreign assets/NRI status, or Section `80TTB`.
- Formats verified: Indian PAN (`/^[A-Z]{5}[0-9]{4}[A-Z]$/`) and RBI IFSC (`/^[A-Z]{4}0[A-Z0-9]{6}$/`).

---

### 4.2 Document Intelligence & Confidence-Gated OCR Pipeline (`server/documentExtractor.ts`)
Supports PDF, PNG/JPG/WEBP images, TXT, and JSON across 9 Indian tax categories (`form_16`, `salary_slips`, `bank_statements`, `interest_certificates`, `investment_proofs`, `form_26as`, `ais`, `tis`, `other_tax_doc`).
1. **Multi-Page Digital PDF Parsing (`unpdf`):** Extracts per-page text with `--- [PAGE N] ---` markers.
2. **Scanned Image OCR (`tesseract.js`):** Runs local Tesseract English OCR worker and caps confidence (`<= 0.84` when OCR confidence is low).
3. **Structured AI + Deterministic Complement:** When `GEMINI_API_KEY` is configured, passes extracted text (or base64 image/PDF for scanned PDFs) to `generateGeminiWithFallback` with `EXTRACTION_RESPONSE_SCHEMA` (strict JSON output validated by `StructuredDataZodSchema`), then complements any missed explicit line items with `deterministicFallbackExtract`.
4. **Confidence Gate (`< 0.85`):** Facts below `85%` confidence are marked `validationStatus: 'needs_review'` and flagged (`needsUserReview = true`), preventing unverified OCR values from auto-populating return numbers without explicit human confirmation.
5. **Auto-Filling Personal & Profile Data (`FACT_TO_ITR1_MAP` in `server.ts` & `store.ts`):** Extracts `employeeName`, `employeePan`, `dateOfBirth`, `aadhaarLast4`, `email`, `phone`, `address`, `employerName`, `employerTan`, `bankName`, `bankAccountNumber`, `bankIfsc`, and `verificationPlace` directly into the ITR-1 `PersonalInfo`, `Refund`, `TDSonSalaries`, and `Verification` sections while protecting manually edited user fields (`editedByUser` flag prevents document re-uploads from silently overwriting human edits).

---

### 4.3 Cross-Document Reconciliation Engine (`server/reconciliationEngine.ts`)
- **Form 16 vs. Salary Slips / Active Draft:** Flags salary discrepancies with page number & verbatim snippet evidence.
- **Form 16 TDS vs. Form 26AS:** Verifies TDS credits and warns if claimed TDS exceeds Form 26AS (`TDS_EXCEEDS_26AS`).
- **Strict Interest Separation:** Independently reconciles `savingsBankInterest` (from Bank Statements / AIS) vs. `fdInterest` (from FD Certificates / AIS).
- **Cross-Document Deduplication (`aggregateDeduplicatedField`):** Prevents double-counting when the same interest or TDS appears in both a primary bank statement/Form 16 and AIS/TIS.
- **Investment Proof vs. Form 16 Payroll Gap:** Surfaces un-declared `80C`, `80CCD(1B)`, and `80D` proofs uploaded separately by the taxpayer.

---

### 4.4 Model Context Protocol (MCP) Server & 22 Controlled Tools (`server/mcpServer.ts`)
Uses `@modelcontextprotocol/sdk` (`Server`, `Client`, `InMemoryTransport`) to isolate AI reasoning from direct database/state access:

| Domain | MCP Tool Names (Total: 22) | Security Mode |
| :--- | :--- | :--- |
| **Document Tools (4)** | `upload_document`, `inspect_documents`, `extract_document_facts`, `get_document_details` | Read/Ingest; `extract_document_facts` & `get_document_details` enforce Document ACL |
| **Financial Tools (5)** | `get_financial_summary`, `reconcile_documents`, `add_income_information`, `add_deduction_information`, `update_return_information` | Read tools execute directly; **all 3 write tools require HITL approval** |
| **Tax Tools (4)** | `retrieve_tax_rules`, `calculate_tax`, `compare_tax_regimes`, `validate_return` | Policy-gated compute & RAG lookup |
| **Return Tools (4)** | `inspect_return`, `generate_return_draft`, `export_return_json`, `get_return_status` | **`generate_return_draft` requires HITL approval** |
| **Security Tools (5)** | `check_permissions`, `request_user_approval`, `approve_operation`, `reject_operation`, `get_audit_history` | **`approve_operation` & `reject_operation` are HUMAN-ONLY** (blocked if invoked by `ai_agent`) |

---

### 4.5 Zero-Trust SecurityGateway (`server/securityGateway.ts`)
Every MCP tool invocation passes through an 8-stage enforcement pipeline:
1. **Path Traversal Guard:** Rejects `../`, `..\\`, `/etc/`, `/proc/`, `file://` (`ERR_PATH_TRAVERSAL_BLOCKED`).
2. **AI Self-Approval Block:** Rejects `ai_agent` attempts to call `approve_operation` or `reject_operation` (`ERR_AGENT_CANNOT_SELF_APPROVE`).
3. **Bounded Duplicate Loop Guard:** Prevents the agent from executing identical canonicalized tool+argument calls more than twice in a single turn (`ERR_DUPLICATE_TOOL_LOOP_PREVENTED`).
4. **Zod Argument Schema Validation (`TOOL_ZOD_SCHEMAS`):** Rejects malformed or negative financial inputs (`ERR_SCHEMA_VALIDATION_FAILED`).
5. **Dynamic Tool Policy Check:** Respects `allowCalculateTaxTool`, `enforceDocumentAcl`, `enforcePiiMaskingToLlm`, `requireHumanApprovalForWrites`.
6. **Document ACL Enforcement (`ERR_DOCUMENT_ACL_DENIED`):** If the taxpayer locks a document (`agentAccessAllowed = false`), AI reads are blocked and `inspect_documents` strips its `structuredData`.
7. **PII Redaction (`maskSensitivePii`):** Redacts Indian PAN (`AAAAA****A`), Employer TAN (`AAAA9****A`), 10–16 digit bank accounts (`XXXXXXXX1234`), phone numbers (`+91-XXXXX-11223`), and emails (`ro***@domain.com`) before returning tool payloads to the LLM or saving audit previews.
8. **Idempotent HITL Approval Staging:** Computes a deterministic SHA-256 `idempotencyKey` from canonicalized arguments (ignoring prose differences in `reason`/`releaseNote`), skips no-op mutations (`NO_OP_ALREADY_APPLIED`), deduplicates identical pending approvals, computes exact before/after field diffs and tax impact deltas, and enforces exact-once `pending → approved → executed` state transitions with 24-hour expiration.

---

### 4.6 Autonomous Agent Orchestrator & Tri-Tier LLM Adapter (`server/agentOrchestrator.ts`, `server/llmAdapter.ts`, `server/geminiClient.ts`)
- **Explicit Agent State Machine:** `IDLE` → `PLANNING` → `EXECUTING_TOOLS` → `WAITING_FOR_USER_CLARIFICATION` / `WAITING_FOR_HUMAN_APPROVAL` → `COMPLETED` / `HALTED_UNSUPPORTED_SCENARIO` / `ERROR`.
- **Automatic Post-Approval Continuation (`resumeOrchestratorAfterApprovalDecision`):** When the human approves or rejects a staged mutation, the orchestrator automatically resumes the workflow (e.g., recomputing taxes and staging `generate_return_draft` or finalizing the draft) without stalling.
- **Tri-Tier Provider Priority (`llmAdapter.ts`):**
  1. **Local Privacy LLM:** Ollama (`qwen3:8b` at `OLLAMA_BASE_URL`) if reachable.
  2. **Cloud LLM Fallback Cascade (`geminiClient.ts`):** `gemini-3.1-flash-lite` → `gemini-3.8-flash` (with `ThinkingLevel.LOW`) → `gemini-flash-latest` on 503/429/timeout.
  3. **Deterministic Non-LLM Fallback Planner:** Explicitly flagged (`isFallbackMode: true`), executing the exact same MCP tools, RAG retrieval, and SecurityGateway checks offline without external LLM dependency.

---

### 4.7 RAG Statutory Knowledge Base (`server/ragKnowledgeBase.ts`)
Builds an in-memory searchable corpus **directly from the live Zod-validated `rules/AY2026-27.yaml`** (zero drift between prose explanations and tax calculations). Covers 8 statutory documents: `115BAC(1A)` slabs, `87A` rebate & marginal relief, `16(ia)` standard deduction, `80C/80CCD(1)/1B/2`, `80D`, `56(2)/80TTA` interest separation, `288A/288B` rounding, and `ITR-1` scope exclusions. Powers both the AI `retrieve_tax_rules` tool and contextual `?` ("Ask why") buttons in the UI.

---

### 4.8 SQLite Persistence & Hash-Chained Audit Log (`server/store.ts`)
Backed by 7 relational tables in `data/taxshield.sqlite`:
1. `sessions` (multi-session filing state, `is_demo_session`, `agent_state`, serialized `UserProfile`)
2. `documents` (category, extraction method, confidence, structured JSON, ACL flag)
3. `ledger_entries` (provenance-tagged items: `document_extracted`, `user_provided`, `system_calculated`)
4. `drafts` (versioned snapshots containing inputs, full tax comparison, validation results, and compliant ITR-1 JSON)
5. `approvals` (HITL requests with `idempotency_key`, raw & masked arguments, field diffs, tax impact)
6. `audit_logs` (tamper-evident log chaining `previous_hash` → SHA-256 `integrity_hash` over `previousHash|timestamp|sessionId|actor|toolName|operation|decision|executionStatus|approvalRequestId|maskedPayloadPreview`)
7. `chat_messages` + `field_states` + `live_events` (persisted SSE sequence IDs and field confirmation/user-edit flags)

---

### 4.9 Backend REST & SSE Endpoints (`server.ts`)
| Method & Route | Purpose |
| :--- | :--- |
| `GET /api/workspace` | Returns complete `WorkspaceSnapshot` (session, profile, docs, draft, approvals, audit chain verification, live events) |
| `GET /api/events` & `/api/events/history` | Real-time SSE stream (`sinceSeq` / `Last-Event-ID` replay) pushing live extraction & form-filling events |
| `POST /api/fields/:fieldKey/action` | Inline `confirm`, `edit`, or `reject` per field with overwrite protection (`editedByUser`) |
| `GET /api/mcp/tools` | Lists all 22 MCP tool schemas and YAML rule source verification metadata |
| `GET /api/demo/sample-documents.zip` | Dynamically builds & downloads 5 formatted AY 2026-27 PDFs inside a PKZIP archive |
| `POST /api/demo/start`, `/reset`, `/upload-synthetic-pack` | Starts/resets an isolated 4-document synthetic demo session |
| `PUT /api/profile` | Saves edited taxpayer personal, contact, employer, and refund bank details |
| `POST /api/sessions`, `/api/sessions/:id/activate`, `/clear-unsupported` | Multi-session switching and unsupported flag clearing |
| `POST /api/documents/upload`, `/upload-batch` | Multipart upload with batch filename deduplication & live SSE streaming |
| `PATCH /api/documents/:id/acl`, `DELETE`, `POST /reextract` | Per-document AI access toggle, removal, or re-extraction |
| `POST /api/tax/calculate` | Stateless deterministic Old vs. New regime preview |
| `POST /api/gateway/stage-update`, `/stage-generate` | Stages return updates or ITR-1 finalization via SecurityGateway |
| `POST /api/approvals/:id/decision` | Human `approve` / `reject` / `cancel` + automatic orchestrator resume |
| `PUT /api/gateway/config`, `POST /api/gateway/mask-preview` | Updates SecurityGateway policies and tests live PII redaction |
| `GET /api/rag/search` | Queries `ragKnowledgeBase.ts` for statutory rule citations |
| `POST /api/assistant/chat` | Executes conversational turn + optional document attachments through orchestrator |

---

### 4.10 Sample 5-PDF Test Pack (`server/samplePdfPack.ts`)
Includes a custom zero-dependency PDF 1.4 generator and CRC-32 PKZIP packager (`GET /api/demo/sample-documents.zip`) producing 5 realistic dummy PDFs for live testing:
1. `01_Form16_AY2026_27.pdf` — Aarav Mehta, PAN `ABCDE1234F`, Nexus Cloud Technologies Pvt Ltd (`BLRN04821D`), Gross Salary `₹14,50,000`, TDS `₹75,000`, full personal/contact/bank metadata.
2. `02_HDFC_Savings_Bank_Statement_FY2025_26.pdf` — Quarterly savings interest totaling `₹8,450`.
3. `03_HDFC_Fixed_Deposit_Interest_Certificate_FY2025_26.pdf` — FD interest `₹32,400` (excluded from 80TTA).
4. `04_Investment_and_Health_Insurance_Proofs_FY2025_26.pdf` — Section 80C `₹1,50,000`, 80CCD(1B) NPS `₹50,000`, 80D `₹24,500`.
5. `05_Form26AS_Annual_Tax_Statement_AY2026_27.pdf` — Confirms `₹75,000` TDS credit reconciliation.

---

### 4.11 Consumer-Centric Frontend Architecture (`src/`)
- **`LandingPageView.tsx`:** Clean fintech introduction with `Upload My Documents`, `Try Sample Tax Pack`, and live preview table.
- **`ConsumerFilingWorkspace.tsx`:** Minimal 3-step guided workspace:
  - **Step 1 (`Upload Documents`):** Drag-and-drop multi-file uploader, **Download Sample PDFs (.zip)**, **Try Sample Tax Pack**, and uploaded document cards with `Re-read` / delete.
  - **Step 2 (`Review Numbers & Tax`):** Actionable validation banner (confirm extracted values, resolve mismatches, fill missing profile fields inline), **Income & Taxes Paid** inline editors, **Deductions** checkboxes (Standard Deduction, 80C, 80D + senior parents, 80CCD(1B), 80CCD(2) + govt employer, HRA), minimal **New vs. Old Regime** comparison cards with `Recommended` highlight, and full 14-field **Personal, Contact & Refund Bank Details** inspector & editor showing source documents.
  - **Step 3 (`Approve & Submit`):** Summary KPIs, personal/bank/employer verification block, expandable ITR-1 JSON preview, declaration checkbox, and **Download ITR-1 JSON** + **Download Receipt & Activity Log**.
- **`ChatSupportPanel.tsx`:** Collapsible right-side Tax Support copilot triggered automatically by contextual `?` buttons next to fields, warnings, and regime cards, displaying plain-English answers with expandable `Rule reference` cards.
- **`TaxBreakdownModal.tsx`:** On-demand modal showing full line-by-line regime comparison and slab-by-slab tax math.
- **`ApprovalConfirmationModal.tsx`:** Plain-English confirmation gate for sensitive return mutations and final draft locking with an optional `Inspect technical details` toggle.
- **`ActivitySecurityDrawer.tsx`:** Slide-over drawer housing the SHA-256 hash-chained audit trail, SecurityGateway policy toggles, live PII redaction tester, 22 MCP tool permissions table, and agent tool traces.

---

## 5. Verification & Automated Test Results

Running `npm test` executes **21 automated tests** (`tests/taxEngine.test.ts` + `tests/integration.test.ts`), all passing (`21/21 pass`):
- **15 Unit Tests (`tests/taxEngine.test.ts`):** YAML schema validation, Section 288A/288B rounding (`drop_paise_then_half_up`), zero-tax thresholds, Old vs. New Regime Section 87A rebates, New Regime marginal relief above ₹12L, Section 80C + 80CCD(1) `₹1.5L` combined cap, `80CCD(1B)` + `80CCD(2)` caps, `80D` self/senior-parents caps, strict `80TTA` savings-only exclusion of FD interest, TDS refund vs. payable rounding, and all unsupported scenario halts (`>₹50L`, crypto, capital gains, multiple employers, house property, senior citizen age `≥60`).
- **6 End-to-End Integration Tests (`tests/integration.test.ts`):** All 22 MCP tool registrations, synthetic 4-document ingestion & separate Savings/FD reconciliation, idempotent approval staging & re-approval blocking, orchestrator full lifecycle (`CLARIFICATION → APPROVAL → AUTO-RESUME → COMPLETED`), rejection path, cross-document AIS deduplication, low-confidence `<85%` OCR review gate, PII masking & SHA-256 hash-chain verification, live SSE event sequencing/deduplication, and upload-first blank session protection against overwriting human edits.

---

## 6. Known Scope Boundaries & Limitations (For Research Paper Discussion)

1. **Local Draft Generation Only:** Produces validated ITR-1 JSON strictly for offline review; does not submit via CBDT e-Filing APIs or Aadhaar e-Verification.
2. **ITR-1 Resident Salaried Scope (`<60` Years):** Senior citizens (`60+`), NRIs, multiple employers, capital gains, business income (`44AD`/`44ADA`), VDA/crypto, house property, and income `> ₹50,00,000` intentionally trigger safety halts.
3. **YAML Snapshot Hashes:** `rules/AY2026-27.yaml` cites 15 official Income Tax Department URLs reviewed on `2026-10-20`, while local HTML `retrieval_hash` / `snapshot_path` fields remain `null` and are transparently surfaced in rule verification metadata.

---

## 7. Step-by-Step Live Demonstration Script (For Evaluators & Jury)

### Recommended 6-Minute Live Demo Flow
1. **Minute 0:00–1:00 — Problem & Architecture Intro (Landing Page)**
   - Open the app on `http://localhost:3000`.
   - Explain the core thesis: *"Tax AI shouldn't guess math or leak PAN/bank numbers. We separate LLM document understanding from a YAML-driven deterministic tax engine, guarded by MCP and a Zero-Trust SecurityGateway."*
   - Click **Start Filing** (or **Upload My Documents**) to show a clean, blank Step 1 workspace (no pre-filled fake state).

2. **Minute 1:00–2:15 — Document Intelligence & Real-Time Extraction (Step 1)**
   - Click **Download Sample PDFs (.zip)** (and unzip it beforehand) OR upload the 5 realistic PDFs (`01_Form16_AY2026_27.pdf` through `05_Form26AS...pdf`) together.
   - Point out the live status indicator (`Reading Form 16... → Updating Gross Salary...`) streaming via **SSE (`/api/events`)**.
   - Click **Continue to Review Numbers & Tax**.

3. **Minute 2:15–3:30 — Reconciliation, Interest Separation & Auto-Filled Profile (Step 2)**
   - Show the **"items need your attention"** banner: explain how Savings Interest (`₹8,450`) and FD Interest (`₹32,400`) are extracted separately and **never merged**, and show `Confirm` / `Exclude` buttons so nothing changes silently.
   - Scroll to **Personal, Contact & Refund Bank Details**: point out that all 14 fields (Name, masked PAN, DOB, Aadhaar last 4, Email, Phone, Address, Employer Name/TAN, Bank Name/Account/IFSC) were auto-filled from the PDFs with their source filenames, and click **Edit Details** briefly to prove the user can change anything.
   - Toggle **Section 80C (`₹1,50,000`)**, **80D (`₹24,500`)**, and **NPS 80CCD(1B) (`₹50,000`)** and show New vs. Old Regime recalculating live.
   - Click **View breakdown** to display exact slab math inside `TaxBreakdownModal`.

4. **Minute 3:30–4:30 — RAG Tax Support Copilot (`?` Triggers)**
   - Click the **`?`** icon next to **Fixed Deposit Interest** or **New vs Old Regime**.
   - Highlight how the collapsible right-hand **Tax Support** panel answers in plain English using the user's real numbers + expands **Rule reference** straight from `rules/AY2026-27.yaml`.

5. **Minute 4:30–5:30 — Zero-Trust SecurityGateway, HITL Approval & Audit Trail (Step 3 + Drawer)**
   - Go to **Step 3 (Approve & Submit)**, check the declaration, and click **Approve & Finalize Return**.
   - Explain the **Approval Confirmation Modal** (human-only authorization gate) and toggle **Inspect technical details** if asked about MCP payloads.
   - Confirm finalization, then click **Download ITR-1 JSON** and **Download Receipt & Activity Log**.
   - Open **Activity & Security** from the top-right header to prove:
     - Every action is logged with **SHA-256 Hash-Chain Valid** status.
     - Sensitive PAN, TAN, and Account numbers are **masked (`ABCDE****F`, `XXXXXXXX7344`)**.
     - Show the **22 MCP Tools** permissions tab and test **Live PII Redaction**.

6. **Minute 5:30–6:00 — Edge Cases & Engineering Proof (Terminal / Q&A)**
   - Mention or run `npm test` (`21/21 passing` covering 87A marginal relief, 80TTA exclusion of FD interest, idempotency keys, AI self-approval blocks, and unsupported scope halts like Crypto/Capital Gains).

---

## 8. Suggested Research Paper & PPT Slide Deck Structure

### Research Paper Outline (IEEE / Springer Format)
1. **Title:** *TaxShield MCP: A Zero-Trust, Neuro-Symbolic Agentic Framework for Auditable Personal Income Tax Preparation via Model Context Protocol*
2. **Abstract:** Contrast unconstrained LLM assistants vs. neuro-symbolic architecture (MCP + Zero-Trust SecurityGateway + YAML Deterministic Engine + Hash-Chained Audit).
3. **Introduction & Motivation:** Tax domain precision requirements, PII privacy risks, and failure modes of pure LLM calculators.
4. **Related Work:** Traditional rule-based e-filing portals, naive RAG financial chatbots, and emerging MCP agentic security patterns.
5. **System Architecture:** 8-layer architecture diagram, 22-tool MCP decomposition, and explicit 8-state orchestrator FSM.
6. **Methodology & Algorithms:**
   - Multi-stage extraction pipeline (`unpdf` + `tesseract.js` + schema-constrained LLM + `<0.85` confidence gate).
   - Cross-document reconciliation & AIS deduplication (`reconciliationEngine.ts`).
   - Zod-validated YAML deterministic 10-step tax algorithm (`taxEngine.ts`, Sections `115BAC(1A)`, `87A` marginal relief, `288A/288B`).
   - 8-step Zero-Trust SecurityGateway with SHA-256 idempotency and hash-chained SQLite audit logs.
7. **Evaluation & Results:** Summarize all 21 unit + integration test scenarios, PII redaction accuracy, idempotency verification, and latency/fallback resilience across Ollama / Gemini / Deterministic modes.
8. **Limitations & Future Work:** Offline CBDT URL snapshot hashing, expansion to ITR-2/ITR-3 schedules, and formal digital signature integration.

### 10-Slide PPT Deck Plan
- **Slide 1:** Title, Authors & Tagline (*Zero-Trust Neuro-Symbolic Tax Assistant*)
- **Slide 2:** Problem Statement (Why standard LLM chatbots fail in Indian Income Tax)
- **Slide 3:** Objectives & Core Design Principles (Simplicity, Determinism, Privacy, Auditability)
- **Slide 4:** High-Level System Architecture Diagram (Frontend → Express/SSE → Orchestrator → SecurityGateway → 22 MCP Tools → SQLite)
- **Slide 5:** Document Intelligence & Cross-Document Reconciliation (PDF/OCR + Confidence Gate + Savings vs. FD separation)
- **Slide 6:** YAML-Driven Deterministic Tax Engine (`AY2026-27.yaml`, 10-step calculation, 87A Marginal Relief, 288A/B)
- **Slide 7:** Zero-Trust SecurityGateway & MCP Governance (PII Redaction, Document ACL, Anti-Self-Approval, SHA-256 Idempotency & Audit Chain)
- **Slide 8:** User-Centric 3-Step Experience & On-Demand RAG Copilot (Screenshots of Steps 1–3, `?` explanations, Breakdown Modal)
- **Slide 9:** Validation, Testing & Scope Guardrails (`21/21` Automated Tests + Unsupported Scenario Halts)
- **Slide 10:** Conclusion, Live Demo Summary & Future Scope
