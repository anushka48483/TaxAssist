import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteTaxWorkspaceStore } from '../server/store.js';
import { SYNTHETIC_DEMO_FILES } from '../server/syntheticDemo.js';
import { calculateTaxComparison } from '../server/taxEngine.js';
import { reconcileDocumentsAndReturn } from '../server/reconciliationEngine.js';
import { createBoundMcpClient, MCP_TOOL_DEFINITIONS } from '../server/mcpServer.js';
import {
  executeThroughSecurityGateway,
  maskSensitivePii,
  resolveApprovalRequest,
} from '../server/securityGateway.js';
import {
  resumeOrchestratorAfterApprovalDecision,
  runTaxAssistantTurn,
} from '../server/agentOrchestrator.js';
import { retrieveTaxRules } from '../server/ragKnowledgeBase.js';

test('1. MCP Catalog exposes all 22 required tools across Document, Financial, Tax, Return, and Security domains', () => {
  assert.equal(MCP_TOOL_DEFINITIONS.length, 22);
  const names = new Set(MCP_TOOL_DEFINITIONS.map((t) => t.name));
  const requiredTools = [
    'upload_document',
    'inspect_documents',
    'extract_document_facts',
    'get_document_details',
    'get_financial_summary',
    'reconcile_documents',
    'add_income_information',
    'add_deduction_information',
    'update_return_information',
    'retrieve_tax_rules',
    'calculate_tax',
    'compare_tax_regimes',
    'validate_return',
    'inspect_return',
    'generate_return_draft',
    'export_return_json',
    'get_return_status',
    'check_permissions',
    'request_user_approval',
    'approve_operation',
    'reject_operation',
    'get_audit_history',
  ];
  for (const tool of requiredTools) {
    assert.ok(names.has(tool), `Missing required MCP tool: ${tool}`);
  }
});

test('2. Synthetic 4-Document Demo Scenario: Separate Savings vs FD Reconciliation, Deterministic Tax Math & Provenance', async () => {
  const store = new SqliteTaxWorkspaceStore(':memory:');
  const mcpClient = await createBoundMcpClient(store);

  assert.equal(SYNTHETIC_DEMO_FILES.length, 4);

  for (const syn of SYNTHETIC_DEMO_FILES) {
    const res = await executeThroughSecurityGateway({
      toolName: 'upload_document',
      args: {
        fileName: syn.fileName,
        category: syn.category,
        textContent: syn.content,
      },
      requestedBy: 'ai_agent',
      store,
      mcpClient,
    });
    assert.equal(res.decision, 'ALLOWED_EXECUTED');
  }

  const docs = store.getDocuments();
  assert.equal(docs.length, 4);

  // Baseline Form 16 populates ₹12,00,000 salary and ₹60,000 TDS; Savings (₹10k), FD (₹15k), and 80C (₹1L) await approval
  const initialDraft = store.getActiveDraft();
  assert.equal(initialDraft.inputs.grossSalary, 1_200_000);
  assert.equal(initialDraft.inputs.tdsClaimed, 60_000);
  assert.equal(initialDraft.inputs.savingsInterest, 0);
  assert.equal(initialDraft.inputs.fdInterest, 0);
  assert.equal(initialDraft.inputs.section80C, 0);

  // Reconciliation must produce SEPARATE variance items for Savings Interest (₹10k), FD Interest (₹15k), and 80C (₹1L)
  const recon = reconcileDocumentsAndReturn(docs, initialDraft.inputs);
  const savingsItem = recon.items.find((i) => i.id === 'rec-interest-bank-return');
  const fdItem = recon.items.find((i) => i.id === 'rec-fd-interest-return');
  const invItem = recon.items.find((i) => i.id === 'rec-80c-f16-proofs');

  assert.ok(savingsItem, 'Savings interest reconciliation item missing');
  assert.equal(savingsItem.varianceAmount, 10_000);
  assert.ok(fdItem, 'FD interest reconciliation item missing');
  assert.equal(fdItem.varianceAmount, 15_000);
  assert.ok(invItem, '80C proof reconciliation item missing');
  assert.equal(invItem.varianceAmount, 100_000);

  // Stage update via SecurityGateway
  const staged = await executeThroughSecurityGateway({
    toolName: 'update_return_information',
    args: {
      savingsInterest: 10_000,
      fdInterest: 15_000,
      section80C: 100_000,
      reason: 'Include verified ₹10k savings interest, ₹15k FD interest, and ₹1L 80C proofs.',
    },
    requestedBy: 'ai_agent',
    store,
    mcpClient,
  });
  assert.equal(staged.decision, 'HELD_FOR_HUMAN_APPROVAL');
  assert.ok(staged.approvalRequest);

  // Idempotency check: staging identical semantic mutation with different reason text reuses same pending ApprovalRequest!
  const duplicateStage = await executeThroughSecurityGateway({
    toolName: 'update_return_information',
    args: {
      fdInterest: 15_000,
      savingsInterest: 10_000,
      section80C: 100_000,
      reason: 'Different prose reason but identical financial mutation.',
    },
    requestedBy: 'ai_agent',
    store,
    mcpClient,
  });
  assert.equal(duplicateStage.approvalRequest?.id, staged.approvalRequest.id);
  assert.equal(store.getApprovals().filter((a) => a.status === 'pending').length, 1);

  // Approve -> transitions to 'executed' and applies mutation once
  const executed = await resolveApprovalRequest({
    approvalId: staged.approvalRequest.id,
    action: 'approve',
    store,
    mcpClient,
  });
  assert.equal(executed.status, 'executed');

  // Re-approving an already executed request must throw and never double-apply
  await assert.rejects(
    () =>
      resolveApprovalRequest({
        approvalId: staged.approvalRequest!.id,
        action: 'approve',
        store,
        mcpClient,
      }),
    /cannot be resolved again/i
  );

  // Verify exact 4-doc tax math:
  // New Regime: 12,00,000 - 75,000 + 25,000 = 11,50,000 taxable -> 55,000 slab tax - 55,000 rebate = ₹0 tax -> ₹60,000 refund
  // Old Regime: 12,00,000 - 50,000 + 25,000 = 11,75,000 GTI - 1,00,000 (80C) - 10,000 (80TTA on savings only!) = 10,65,000 taxable
  // Old Slab Tax: 12,500 + 1,00,000 + 19,500 (65k @ 30%) = 1,32,000 + 5,280 (4% cess) = ₹1,37,280 -> ₹77,280 payable
  const updatedDraft = store.getActiveDraft();
  const comp = calculateTaxComparison(updatedDraft.inputs);
  assert.equal(comp.newRegime.taxableIncome, 1_150_000);
  assert.equal(comp.newRegime.totalTaxLiability, 0);
  assert.equal(comp.newRegime.refundDue, 60_000);

  assert.equal(comp.oldRegime.eligible80TTA, 10_000);
  assert.equal(comp.oldRegime.taxableIncome, 1_065_000);
  assert.equal(comp.oldRegime.totalTaxLiability, 137_280);
  assert.equal(comp.oldRegime.netTaxPayable, 77_280);
  assert.equal(comp.recommendedRegime, 'new');

  await mcpClient.close();
});

test('3. Orchestrator Lifecycle: Clarification -> Approval Staging -> Automatic Post-Approval Continuation -> COMPLETED (Never Stuck)', async () => {
  // Force deterministic planner during unit test so it runs fast & deterministically without external network dependency
  const prevProvider = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = 'fallback';

  try {
    const store = new SqliteTaxWorkspaceStore(':memory:');
    const mcpClient = await createBoundMcpClient(store);

    // Load 4-doc isolated demo session (matching POST /api/demo/start)
    store.resetIsolatedDemoSession();
    for (const syn of SYNTHETIC_DEMO_FILES) {
      await executeThroughSecurityGateway({
        toolName: 'upload_document',
        args: {
          fileName: syn.fileName,
          category: syn.category,
          textContent: syn.content,
        },
        requestedBy: 'ai_agent',
        store,
        mcpClient,
      });
    }

    // Turn 1: User asks "Prepare my income tax return." -> Agent inspects & reconciles, finds variances, asks clarification
    await runTaxAssistantTurn({
      message: 'Prepare my income tax return.',
      store,
      mcpClient,
    });
    assert.equal(store.getActiveSession().agentState, 'WAITING_FOR_USER_CLARIFICATION');

    // Turn 2: User confirms including savings, FD, and 80C -> Agent stages sensitive write -> WAITING_FOR_HUMAN_APPROVAL
    await runTaxAssistantTurn({
      message:
        'Yes, include all my savings interest, FD interest, and verified Section 80C investment proofs.',
      store,
      mcpClient,
    });
    assert.equal(store.getActiveSession().agentState, 'WAITING_FOR_HUMAN_APPROVAL');
    const pendingWrite = store.getApprovals().find((a) => a.status === 'pending');
    assert.ok(pendingWrite, 'Expected pending update_return_information approval');

    // Human approves write -> resolve + resumeOrchestratorAfterApprovalDecision automatically advances workflow!
    const resolvedWrite = await resolveApprovalRequest({
      approvalId: pendingWrite.id,
      action: 'approve',
      store,
      mcpClient,
    });
    await resumeOrchestratorAfterApprovalDecision({
      resolvedApproval: resolvedWrite,
      action: 'approve',
      store,
      mcpClient,
    });

    // Because financial reconciliation is now clean, auto-resume stages generate_return_draft (not stuck on old request!)
    const pendingDraftGen = store
      .getApprovals()
      .find((a) => a.status === 'pending' && a.toolName === 'generate_return_draft');
    assert.ok(pendingDraftGen, 'Auto-resume should stage generate_return_draft after clean reconciliation');
    assert.equal(store.getActiveSession().agentState, 'WAITING_FOR_HUMAN_APPROVAL');

    // Human approves generate_return_draft -> auto-resume transitions session cleanly to COMPLETED!
    const resolvedGen = await resolveApprovalRequest({
      approvalId: pendingDraftGen.id,
      action: 'approve',
      store,
      mcpClient,
    });
    await resumeOrchestratorAfterApprovalDecision({
      resolvedApproval: resolvedGen,
      action: 'approve',
      store,
      mcpClient,
    });

    assert.equal(store.getActiveSession().agentState, 'COMPLETED');
    assert.equal(store.getApprovals().filter((a) => a.status === 'pending').length, 0);
    assert.equal(store.getActiveDraft().status, 'validated_ready');

    await mcpClient.close();
  } finally {
    if (prevProvider !== undefined) {
      process.env.LLM_PROVIDER = prevProvider;
    } else {
      delete process.env.LLM_PROVIDER;
    }
  }
});

test('4. Rejection Path, Duplicate Cross-Doc Deduplication, Low-Confidence OCR Gate & Hash-Chained Redacted Audit', async () => {
  const store = new SqliteTaxWorkspaceStore(':memory:');
  const mcpClient = await createBoundMcpClient(store);
  store.resetIsolatedDemoSession();
  for (const syn of SYNTHETIC_DEMO_FILES) {
    await executeThroughSecurityGateway({
      toolName: 'upload_document',
      args: {
        fileName: syn.fileName,
        category: syn.category,
        textContent: syn.content,
      },
      requestedBy: 'ai_agent',
      store,
      mcpClient,
    });
  }

  // Stage a valid Schedule OS income addition and REJECT it -> verify return unchanged & state moves to WAITING_FOR_USER_CLARIFICATION
  const addAttempt = await executeThroughSecurityGateway({
    toolName: 'add_income_information',
    args: {
      incomeType: 'otherIncome',
      amount: 25_000,
      description: 'Interest on income tax refund',
    },
    requestedBy: 'ai_agent',
    store,
    mcpClient,
  });
  assert.ok(addAttempt.approvalRequest);

  const rejected = await resolveApprovalRequest({
    approvalId: addAttempt.approvalRequest.id,
    action: 'reject',
    decisionNote: 'Incorrect entry',
    store,
    mcpClient,
  });
  await resumeOrchestratorAfterApprovalDecision({
    resolvedApproval: rejected,
    action: 'reject',
    store,
    mcpClient,
  });
  assert.equal(rejected.status, 'rejected');
  assert.equal(store.getActiveDraft().inputs.otherIncome, 0);
  assert.equal(store.getActiveSession().agentState, 'WAITING_FOR_USER_CLARIFICATION');

  // Verify unsupported ITR-1 business/freelance income is intercepted and flagged without staging an approval
  const unsupportedFreelanceAttempt = await executeThroughSecurityGateway({
    toolName: 'add_income_information',
    args: {
      incomeType: 'otherIncome',
      amount: 50_000,
      description: 'Freelance consulting honorarium',
    },
    requestedBy: 'ai_agent',
    store,
    mcpClient,
  });
  assert.equal(unsupportedFreelanceAttempt.approvalRequest, undefined);
  assert.ok(store.getActiveSession().unsupportedScenarios.length > 0);

  // Duplicate cross-document interest detection: upload an AIS reporting the exact same ₹10,000 savings interest
  await executeThroughSecurityGateway({
    toolName: 'upload_document',
    args: {
      fileName: 'AIS_Statement_AY2026_27.txt',
      category: 'ais',
      textContent:
        'Annual Information Statement AY 2026-27\nSavings Bank Interest Credited: Rs. 10,000',
    },
    requestedBy: 'ai_agent',
    store,
    mcpClient,
  });
  const reconAfterDup = reconcileDocumentsAndReturn(
    store.getDocuments(),
    store.getActiveDraft().inputs
  );
  const savRow = reconAfterDup.items.find((i) => i.id === 'rec-interest-bank-return');
  // Deduplicated value must remain ₹10,000 (NOT double-counted as ₹20,000!)
  assert.equal(savRow?.sourceAValue, 10_000);

  // Low-confidence OCR upload must be flagged needsUserReview and NEVER overwrite verified salary
  await executeThroughSecurityGateway({
    toolName: 'upload_document',
    args: {
      fileName: 'Blurry_Form16_Scan.txt',
      category: 'form_16',
      textContent:
        '[LOW_CONFIDENCE_OCR]\nForm 16 Gross Salary u/s 17(1): Rs. 9,99,999\nTotal TDS Deducted: Rs. 10,000',
    },
    requestedBy: 'ai_agent',
    store,
    mcpClient,
  });
  const blurryDoc = store
    .getDocuments()
    .find((d) => d.fileName === 'Blurry_Form16_Scan.txt');
  assert.equal(blurryDoc?.needsUserReview, true);
  assert.equal(store.getActiveDraft().inputs.grossSalary, 1_200_000); // Verified ₹12L preserved!

  // SecurityGateway protections: self-approval, path traversal, ACL block
  const selfApprove = await executeThroughSecurityGateway({
    toolName: 'approve_operation',
    args: { approvalId: 'appr-fake' },
    requestedBy: 'ai_agent',
    store,
    mcpClient,
  });
  assert.equal(selfApprove.decision, 'BLOCKED_UNAUTHORIZED');

  const traversal = await executeThroughSecurityGateway({
    toolName: 'upload_document',
    args: { fileName: '../../etc/passwd', category: 'other_tax_doc', textContent: 'x' },
    requestedBy: 'ai_agent',
    store,
    mcpClient,
  });
  assert.equal(traversal.decision, 'BLOCKED_PATH_TRAVERSAL');

  const targetDoc = store.getDocuments()[0];
  store.toggleDocumentAcl(targetDoc.id, false);
  const aclBlocked = await executeThroughSecurityGateway({
    toolName: 'extract_document_facts',
    args: { documentIdOrCategory: targetDoc.id },
    requestedBy: 'ai_agent',
    store,
    mcpClient,
  });
  assert.equal(aclBlocked.decision, 'BLOCKED_ACL');

  // Verify SHA-256 hash chain integrity and strict PII redaction in snapshot
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.auditChainValid, true);
  assert.ok(snapshot.auditLogs.length > 0);
  for (const log of snapshot.auditLogs) {
    assert.ok(!log.maskedPayloadPreview.includes('SYNTP1234K'), 'Raw PAN leaked in audit log');
    assert.ok(
      !log.maskedPayloadPreview.includes('409988112233'),
      'Raw bank account leaked in audit log'
    );
    assert.equal('unmaskedPayloadPreview' in log, false);
  }

  // Verify PII redaction helper & YAML-grounded RAG citations
  const masked = maskSensitivePii(
    'PAN SYNTP1234K, TAN BLRA99120F, Account 409988112233, Phone 9876543210'
  );
  assert.equal(masked.maskedCount, 4);
  const citations = retrieveTaxRules('Section 87A marginal relief 12 lakh', 3);
  assert.ok(citations.some((c) => c.section.includes('87A')));

  await mcpClient.close();
});
