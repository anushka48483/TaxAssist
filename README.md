# axShield MCP (TaxShield MCP) — Autonomous Agentic AI Income Tax Filing Assistant

**axShield MCP** is an end-to-end, security-first Indian Income Tax (ITR-1 Sahaj, AY 2026-27 / FY 2025-26) preparation assistant powered by the **Model Context Protocol (MCP)**, a **Zero-Trust SecurityGateway**, a **Zod-validated YAML Deterministic Tax Engine**, and **Human-in-the-Loop (HITL) Approvals**.

> **Important Safety & Non-Submission Boundary**: `axShield MCP` generates local, validated ITR-1 (Sahaj) JSON drafts strictly for taxpayer review and personal verification. It **never** connects to or submits returns directly to the official Income Tax Department e-Filing portal.

---

## 1. System Architecture

```text
Taxpayer Browser (Landing Page + 8-Section Fintech Workspace)
        │
        ▼  REST / Multipart API (Express + Vite on Port 3000)
┌─────────────────────────────────────────────────────────────────────────┐
│ Agent Orchestrator (server/agentOrchestrator.ts)                        │
│ Explicit State Machine:                                                 │
│ IDLE → PLANNING → EXECUTING_TOOLS → WAITING_FOR_USER_CLARIFICATION      │
│      → WAITING_FOR_HUMAN_APPROVAL → COMPLETED / HALTED / ERROR          │
│ (Automatically resumes post-approval without getting stuck!)            │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌──────────────────┐  ┌──────────────────────┐  ┌─────────────────────────┐
│ LLM Adapter      │  │ SecurityGateway      │  │ Deterministic Tax Engine│
│ - Ollama qwen3:8b│  │ - Zod Schema Guard   │  │ - rules/AY2026-27.yaml  │
│ - Gemini Cloud   │  │ - Document ACL Check │  │ - Old vs New (115BAC)   │
│ - Labelled Demo  │  │ - PII Redaction      │  │ - 87A Marginal Relief   │
│   Fallback Mode  │  │ - Idempotent HITL    │  │ - u/s 288A/288B Rounding│
└──────────────────┘  └──────────┬───────────┘  └─────────────────────────┘
                                 │ In-Memory MCP Transport
                                 ▼
               ┌──────────────────────────────────┐
               │ 22 Controlled MCP Tools          │
               │ (server/mcpServer.ts)            │
               └─────────────────┬────────────────┘
                                 ▼
               ┌──────────────────────────────────┐
               │ SQLite Persistence + SHA-256     │
               │ Hash-Chained Redacted Audit Log  │
               └──────────────────────────────────┘
```

---

## 2. Core Capabilities

1. **Autonomous Agent Orchestration**:
   - Dynamically inspects uploaded documents, extracts evidence, reconciles discrepancies, asks focused clarification questions when ambiguities exist, stages sensitive mutations for approval, and **automatically continues** after human approval until the validated ITR-1 JSON draft is ready.
2. **22 Controlled MCP Tools (`server/mcpServer.ts`)**:
   - **Document Tools**: `upload_document`, `inspect_documents`, `extract_document_facts`, `get_document_details`
   - **Financial Tools**: `get_financial_summary`, `reconcile_documents`, `add_income_information`, `add_deduction_information`, `update_return_information`
   - **Tax Tools**: `retrieve_tax_rules`, `calculate_tax`, `compare_tax_regimes`, `validate_return`
   - **Return Tools**: `inspect_return`, `generate_return_draft`, `export_return_json`, `get_return_status`
   - **Security Tools**: `check_permissions`, `request_user_approval`, `approve_operation`, `reject_operation`, `get_audit_history`
3. **SecurityGateway & Idempotent Human Approvals (`server/securityGateway.ts`)**:
   - Deterministic SHA-256 `idempotencyKey` prevents duplicate approval cards for identical pending mutations.
   - Blocks AI self-approval (`ERR_AGENT_CANNOT_SELF_APPROVE`), path traversal (`ERR_PATH_TRAVERSAL_BLOCKED`), ACL-restricted document reads (`ERR_DOCUMENT_ACL_DENIED`), and bounded duplicate tool loops.
   - Redacts PAN, TAN, bank account numbers, phone numbers, and emails before storing SHA-256 hash-chained audit logs or transmitting context to cloud LLMs. Raw PII is never serialized in frontend audit log payloads.
4. **YAML-Driven Deterministic Tax Engine (`rules/AY2026-27.yaml` + `server/taxEngine.ts`)**:
   - Loads and Zod-validates `rules/AY2026-27.yaml` at runtime (zero hardcoded slabs or deduction limits).
   - Computes New Regime (`Section 115BAC(1A)`: ₹75,000 standard deduction, ₹4L–₹24L slabs, ₹60,000 Section 87A rebate up to ₹12L + marginal relief) vs Old Regime (`₹50,000` standard deduction, `80C + 80CCD(1)` ₹1.5L cap, `80CCD(1B)` ₹50k, `80CCD(2)` employer NPS, `80D` self + parents, `80TTA` strictly on savings bank interest and never on FD interest).
   - Applies `drop_paise_then_half_up` rounding to the nearest ₹10 under Sections 288A and 288B.
   - Halts ITR-1 preparation on unsupported scenarios (`capital_gains`, `crypto/VDA`, `business_income`, `foreign_income`, `multiple_employers`, `house_property`, `senior_citizen` age ≥ 60, `non_resident`, or total income > `₹50,00,000`).
5. **Document Processing & Cross-Document Reconciliation**:
   - Extracts multi-page PDF text via `unpdf` and scanned images via `Tesseract.js` OCR.
   - Flags low-confidence (`< 85%`) OCR facts as `needs_review` and prevents overwriting verified financial figures.
   - Separates **Savings Bank Interest** (`80TTA` eligible) from **Fixed Deposit Interest** (non-`80TTA`) and deduplicates identical income reported across multiple documents (e.g., Bank Statement + AIS).

---

## 3. Installation & Setup

### Prerequisites
- **Node.js** `v22+` (uses built-in `node:sqlite` and `node:test`)
- **Optional Local LLM**: [Ollama](https://ollama.com) with `qwen3:8b` (`ollama pull qwen3:8b`)
- **Optional Cloud LLM**: `GEMINI_API_KEY` in `.env`

### Environment Variables (`.env`)
Copy `.env.example` to `.env`:
```bash
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"   # Optional if using Ollama or Deterministic Demo Fallback
OLLAMA_BASE_URL="http://127.0.0.1:11434"
OLLAMA_MODEL="qwen3:8b"
APP_URL="http://localhost:3000"
```
*Provider Selection Priority*:
1. Local **Ollama (`qwen3:8b`)** if reachable at `OLLAMA_BASE_URL`
2. **Gemini (`gemini-2.5-flash`)** if `GEMINI_API_KEY` is configured
3. **Deterministic Demo Fallback Planner** (explicitly labelled in UI & API responses when neither external LLM is configured)

### Commands
```bash
# Install dependencies
npm install

# Run unit + integration tests (18 tests across taxEngine.test.ts and integration.test.ts)
npm test

# Type-check TypeScript across frontend & server
npm run lint

# Build production frontend bundle
npm run build

# Start full-stack Express + MCP + Vite server on http://localhost:3000
npm run dev
```

---

## 4. Running the End-to-End Interactive Demo

1. Open `http://localhost:3000` to view the **axShield MCP** Landing Page.
2. Click **"Try Interactive Demo"** (or **"Launch Live Demo"**). This creates an isolated, resettable demo session preloaded with 4 synthetic AY 2026-27 documents:
   - `SYNTHETIC_Form16_AY2026_27.txt` — Gross Salary `₹12,00,000`, TDS `₹60,000`
   - `SYNTHETIC_BankStatement_AY2026_27.txt` — Savings Interest `₹10,000`
   - `SYNTHETIC_FD_Certificate_AY2026_27.txt` — Fixed Deposit Interest `₹15,000`
   - `SYNTHETIC_InvestmentProof_80C_AY2026_27.txt` — PPF + ELSS `₹1,00,000`
3. In **Tax Filing Assistant**, click or type `"Prepare my income tax return."`
4. Confirm inclusion of the reconciled items when prompted (`"Confirm & Include All Reconciled Items"`).
5. Review the inline **Approval Card** (showing before/after diffs, source documents, and exact tax impact: New Regime `₹0` tax / `₹60,000` refund vs Old Regime `₹1,37,280` tax) and click **"Approve & Continue Agent"**.
6. Approve the automatically staged `generate_return_draft` snapshot and download the validated ITR-1 JSON in **Generated Return**. Click **"Reset Demo"** in the top bar anytime to start fresh.

---

## 5. Transparent Limitations

- **Local Draft Preparation Only**: Does not file returns with the Income Tax Department portal or verify Aadhaar OTPs.
- **Resident Individual Below 60 (`ITR-1 Sahaj`) Scope**: Senior citizen slabs (`60+` / `80+` / `80TTB`), House Property loss/interest, Capital Gains, Business/Profession income, Foreign Assets, VDA/Crypto, and incomes above `₹50,00,000` are intentionally out of scope per `rules/AY2026-27.yaml` and trigger explicit halt warnings.
- **Rule Snapshot Hashes**: `rules/AY2026-27.yaml` cites 15 official CBDT sources verified on `2026-04-17`, while offline HTML `retrieval_hash` / `snapshot_path` fields in the YAML are currently `null` (transparently reported in the Tax Computation view).
