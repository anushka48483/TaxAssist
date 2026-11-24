# TaxShield

**TaxShield** is a security-first Indian income tax preparation assistant for resident salaried taxpayers filing **ITR-1 (Sahaj)** for **AY 2026–27 (FY 2025–26)**.

Instead of trusting an LLM to do tax math or directly mutate financial records, TaxShield separates responsibilities cleanly: AI handles document understanding and plain-English explanations, while a Zod-validated YAML rule engine performs every calculation deterministically and a Security Gateway mediates all tool execution over the **Model Context Protocol (MCP)**.

> **Important Note:** TaxShield prepares and validates local ITR-1 JSON drafts for personal review and export. It never connects to or submits returns directly to the Income Tax Department e-Filing portal.

---

## Why TaxShield?

Standard LLM chatbots fail quickly in personal taxation because they:
- Guess tax slabs, Section 87A rebates, or statutory rounding rules instead of computing them deterministically.
- Merge **Savings Bank Interest** (eligible for deduction up to ₹10,000 u/s 80TTA in the Old Regime) with **Fixed Deposit Interest** (excluded from 80TTA).
- Silently overwrite user-edited figures when new documents are uploaded.
- Expose sensitive PAN, TAN, Aadhaar, and bank account details directly to external models or logs.

TaxShield addresses each of these at the architectural level while keeping the taxpayer experience as simple as a 3-step guided workflow.

---

## Key Features

### 1. Guided 3-Step Filing Experience
- **Step 1 — Upload Documents:** Drag and drop Form 16, salary slips, bank statements, FD certificates, investment proofs, or Form 26AS/AIS (PDF, PNG, JPG, TXT). Includes a built-in **Download Sample PDFs (.zip)** option with 5 realistic test documents and a one-click **Try Sample Tax Pack** mode.
- **Step 2 — Review Numbers & Tax:** Inspect and edit income figures, toggle deductions (`80C`, `80D`, `80CCD(1B)`, `80CCD(2)`, HRA), review every auto-filled personal/employer/bank field with source document attribution, and compare **New Regime (`u/s 115BAC(1A)`)** vs. **Old Regime** side by side.
- **Step 3 — Approve & Submit:** Confirm final figures through an explicit human-approval gate and download the validated **ITR-1 JSON** along with the filing receipt and audit log.

### 2. On-Demand Tax Support Copilot
- Contextual **`?`** buttons sit next to interest fields, validation alerts, and regime recommendations.
- Clicking `?` opens the collapsible **Tax Support** panel and answers in plain English using your actual return numbers and statutory rules retrieved from `rules/AY2026-27.yaml`.

### 3. Document Intelligence & Cross-Document Reconciliation
- Extracts multi-page PDF text with `unpdf` and scanned image text via `Tesseract.js` OCR (plus multimodal Gemini extraction when `GEMINI_API_KEY` is configured).
- Flags OCR values with confidence `< 85%` for manual review before they touch your return.
- Keeps **Savings Bank Interest** and **Fixed Deposit Interest** strictly separate and deduplicates overlapping interest/TDS figures across Bank Statements, Form 16, Form 26AS, and AIS.
- Protects manually edited fields (`editedByUser`) from being silently overwritten by subsequent uploads.

### 4. YAML-Driven Deterministic Tax Engine (`rules/AY2026-27.yaml`)
- Loads and validates statutory parameters at runtime using Zod (zero hardcoded slabs or limits).
- Implements the full 10-step computation order: salary exemptions, standard deduction (`₹75,000` New / `₹50,000` Old), Chapter VI-A caps (`80C + 80CCD(1)` combined `₹1.5L`, `80CCD(1B)` `₹50k`, `80CCD(2)` `14%/10%`, `80D`, `80TTA`), Section 288A/288B nearest-₹10 rounding, slab math, and Section 87A rebate with marginal relief above `₹12,00,000`.
- Safely halts ITR-1 draft generation on out-of-scope scenarios (income `> ₹50,00,000`, age `≥ 60`, multiple employers, capital gains, crypto/VDA `u/s 115BBH`, business/freelance income, house property, or NRI/foreign income).

### 5. MCP Governance, Security Gateway & Audit Trail
- Exposes **22 controlled MCP tools** (`server/mcpServer.ts`) across document, financial, tax, return, and security domains over `@modelcontextprotocol/sdk`.
- **Zero-Trust Security Gateway (`server/securityGateway.ts`):**
  - Masks PAN, TAN, bank account numbers, phone numbers, and emails before LLM calls or audit storage.
  - Blocks AI self-approval (`ERR_AGENT_CANNOT_SELF_APPROVE`), path traversal, duplicate tool loops, and ACL-restricted document reads.
  - Stages sensitive mutations and draft finalization behind SHA-256 idempotent human approvals.
- **Tamper-Evident Audit Log (`server/store.ts`):** Stores every tool decision in SQLite (`node:sqlite`) chained via SHA-256 `previous_hash` → `integrity_hash`, inspectable in the top-right **Activity & Security** drawer.

---

## Architecture Overview

```text
React Frontend (Vite + Tailwind CSS + EventSource SSE)
        │
        ▼  REST / Multipart / SSE (/api/events)
Express API Server (server.ts)
        ├── Document Intelligence (unpdf + Tesseract.js + Gemini Schema Extraction)
        ├── Agent Orchestrator (server/agentOrchestrator.ts)
        │     └── Provider Cascade: Local Ollama (qwen3:8b) → Gemini → Deterministic Planner
        ├── Zero-Trust Security Gateway (server/securityGateway.ts)
        │     └── PII Redaction, Zod Validation, ACLs, Idempotent Human Approvals
        ├── MCP Server — 22 Tools (server/mcpServer.ts via InMemoryTransport)
        ├── Deterministic Tax & Reconciliation Engines (rules/AY2026-27.yaml)
        └── SQLite Store + SHA-256 Hash-Chained Audit Log (data/taxshield.sqlite)
```

---

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS 4, Lucide Icons
- **Backend:** Node.js 22+, Express 4, Multer, Server-Sent Events (SSE)
- **AI & Protocols:** `@modelcontextprotocol/sdk`, `@google/genai`, Ollama adapter
- **Parsing & Validation:** `unpdf`, `tesseract.js`, `yaml`, `zod`
- **Database & Testing:** Built-in `node:sqlite` and `node:test`

---

## Getting Started

### Prerequisites
- **Node.js `v22+`** (required for built-in `node:sqlite` and `node:test`)
- Optional: [Ollama](https://ollama.com) with `qwen3:8b` (`ollama pull qwen3:8b`) for local LLM execution, or a `GEMINI_API_KEY` from Google AI Studio for cloud LLM + Vision OCR

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Available options in `.env`:
```env
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"   # Optional — enables Gemini chat & scanned PDF vision OCR
LLM_PROVIDER="auto"                    # auto | ollama | gemini | deterministic
OLLAMA_BASE_URL="http://127.0.0.1:11434"
OLLAMA_MODEL="qwen3:8b"
SQLITE_DB_PATH="./data/taxshield.sqlite"
APP_URL="http://localhost:3000"
```

> If neither Ollama nor `GEMINI_API_KEY` is configured, TaxShield automatically runs its labelled **Deterministic Rule Planner**, keeping PDF parsing, reconciliation, tax comparison, MCP approvals, and ITR-1 JSON generation fully functional.

### 3. Run in Development
```bash
npm run dev
```
Open `http://localhost:3000` in your browser.

### 4. Build & Run in Production
```bash
npm run build
NODE_ENV=production npm start
```

---

## Testing & Verification

Run the automated unit and integration test suite (**21 tests** covering tax slabs, Section 87A marginal relief, 80TTA exclusion of FD interest, 22 MCP tool registrations, approval idempotency, OCR confidence gating, PII redaction, and hash-chain verification):

```bash
npm test
```

Run TypeScript type-checking across both frontend and server:

```bash
npm run lint
```

---

## Project Structure

```text
├── rules/
│   └── AY2026-27.yaml                # Zod-validated statutory tax rules & citations
├── server/
│   ├── agentOrchestrator.ts          # Stateful agent workflow & post-approval resume
│   ├── documentExtractor.ts          # unpdf + Tesseract OCR + structured extractor
│   ├── geminiClient.ts               # Gemini SDK client with fallback model cascade
│   ├── llmAdapter.ts                 # Ollama / Gemini / Deterministic provider selector
│   ├── mcpServer.ts                  # 22 controlled MCP tools over InMemoryTransport
│   ├── ragKnowledgeBase.ts           # Searchable statutory corpus built from YAML
│   ├── reconciliationEngine.ts       # Cross-document verification & deduplication
│   ├── samplePdfPack.ts              # Built-in 5-PDF sample test pack + ZIP builder
│   ├── securityGateway.ts            # PII redaction, ACLs, Zod checks, HITL approvals
│   ├── store.ts                      # SQLite persistence & SHA-256 hash-chained audit
│   ├── syntheticDemo.ts              # 4-document quick synthetic demo pack
│   └── taxEngine.ts                  # 10-step deterministic tax engine & ITR-1 builder
├── src/
│   ├── components/
│   │   ├── ActivitySecurityDrawer.tsx
│   │   ├── ApprovalConfirmationModal.tsx
│   │   ├── ChatSupportPanel.tsx
│   │   ├── ConsumerFilingWorkspace.tsx
│   │   ├── DesignSystem.tsx
│   │   ├── LandingPageView.tsx
│   │   └── TaxBreakdownModal.tsx
│   ├── shared/types.ts               # Shared TypeScript interfaces across stack
│   └── App.tsx                       # Main SPA shell & live SSE listener
├── tests/
│   ├── taxEngine.test.ts             # 15 deterministic tax & scope guardrail tests
│   └── integration.test.ts           # 6 end-to-end MCP, Security & SSE tests
└── server.ts                         # Express entry point, REST routes, SSE & Vite
```

---

## Known Limitations

- **Offline Draft Only:** Generates a validated ITR-1 JSON package for personal inspection; does not integrate with live government e-Filing submission APIs or Aadhaar OTP verification.
- **ITR-1 Resident Salaried Scope (`< 60` Years):** Taxpayers aged 60+, NRIs, multiple-employer cases, capital gains, crypto/VDA, business income, house property, and total income above `₹50,00,000` are intentionally flagged and halted as unsupported per `rules/AY2026-27.yaml`.
- **Rule Snapshot Hashes:** `rules/AY2026-27.yaml` cites 15 official Income Tax Department URLs reviewed on `2026-10-20`, while offline HTML `retrieval_hash` and `snapshot_path` fields are currently `null` and reported transparently in rule metadata.
