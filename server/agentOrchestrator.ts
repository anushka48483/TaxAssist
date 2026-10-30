import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Content, FunctionDeclaration, Type } from '@google/genai';
import {
  AgentExecutionPlan,
  AgentExecutionState,
  AgentPlanStep,
  AgentToolTrace,
  ApprovalRequest,
  ChatMessage,
  McpToolName,
  RagRuleCitation,
  ReconciliationReport,
  TaxComparisonSummary,
  ValidationResult,
} from '../src/shared/types.js';
import { generateGeminiWithFallback, hasValidGeminiApiKey } from './geminiClient.js';
import { callOllamaChatWithTools, getLlmRuntimeStatus } from './llmAdapter.js';
import { MCP_TOOL_DEFINITIONS } from './mcpServer.js';
import { executeThroughSecurityGateway, maskSensitivePii } from './securityGateway.js';
import { SqliteTaxWorkspaceStore, workspaceStore } from './store.js';
import { detectUnsupportedFilingScenario } from './taxEngine.js';

function convertMcpSchemasToGeminiDeclarations(): FunctionDeclaration[] {
  return MCP_TOOL_DEFINITIONS.filter(
    (t) => t.name !== 'approve_operation' && t.name !== 'reject_operation'
  ).map((tool) => {
    const props: Record<string, { type: Type; description?: string }> = {};
    const rawProps = (tool.inputSchema.properties ?? {}) as Record<
      string,
      { type?: string; description?: string }
    >;

    for (const [key, val] of Object.entries(rawProps)) {
      let mappedType = Type.STRING;
      if (val.type === 'number') mappedType = Type.NUMBER;
      else if (val.type === 'boolean') mappedType = Type.BOOLEAN;
      else if (val.type === 'object') mappedType = Type.OBJECT;

      if (mappedType === Type.OBJECT) {
        (props as Record<string, unknown>)[key] = {
          type: Type.OBJECT,
          description: val.description,
          properties: {
            savingsInterest: { type: Type.NUMBER },
            fdInterest: { type: Type.NUMBER },
            section80C: { type: Type.NUMBER },
            section80D: { type: Type.NUMBER },
            grossSalary: { type: Type.NUMBER },
            tdsClaimed: { type: Type.NUMBER },
          },
        };
      } else {
        props[key] = {
          type: mappedType,
          description: val.description,
        };
      }
    }

    if (Object.keys(props).length === 0) {
      props._contextCheck = {
        type: Type.BOOLEAN,
        description: 'Optional flag to inspect full context.',
      };
    }

    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: Type.OBJECT,
        properties: props,
        required: 'required' in tool.inputSchema ? tool.inputSchema.required : undefined,
      },
    };
  });
}

const GEMINI_TOOL_DECLARATIONS = convertMcpSchemasToGeminiDeclarations();

function buildDynamicInitialPlan(
  userPrompt: string,
  llmLabel: string,
  store: SqliteTaxWorkspaceStore
): AgentExecutionPlan {
  const lower = userPrompt.toLowerCase();
  const docs = store.getDocuments();
  const draft = store.getActiveDraft();
  const steps: AgentPlanStep[] = [];
  let stepNum = 1;

  const pushStep = (toolName: McpToolName | 'ask_clarification', objective: string) => {
    steps.push({
      stepNumber: stepNum++,
      toolName,
      objective,
      status: 'planned',
    });
  };

  if (
    lower.includes('prepare') ||
    lower.includes('analyze') ||
    lower.includes('full') ||
    lower.includes('file') ||
    lower.includes('return')
  ) {
    pushStep('inspect_documents', 'Check uploaded documents and extraction readiness');
    if (docs.length > 0) {
      pushStep(
        'reconcile_documents',
        'Cross-verify Form 16, Savings Interest, FD Interest, and Investment Proofs'
      );
    }
    pushStep('compare_tax_regimes', 'Run YAML-driven Old vs New tax regime calculation');
    if (
      lower.includes('generate') ||
      lower.includes('finalize') ||
      (docs.length > 0 && draft.inputs.grossSalary > 0)
    ) {
      pushStep('validate_return', 'Validate mandatory ITR-1 fields and scope eligibility');
    }
  } else if (
    lower.includes('include') ||
    lower.includes('yes') ||
    lower.includes('confirm') ||
    lower.includes('received') ||
    lower.includes('invested') ||
    lower.includes('paid') ||
    lower.includes('add') ||
    lower.includes('update') ||
    lower.includes('rental') ||
    lower.includes('crypto') ||
    lower.includes('capital gain') ||
    lower.includes('employer')
  ) {
    pushStep('get_financial_summary', 'Inspect current provenance-separated financial state');
    pushStep('reconcile_documents', 'Verify reconciliation items to stage');
    pushStep('update_return_information', 'Stage confirmed financial update via SecurityGateway');
    pushStep('compare_tax_regimes', 'Recalculate deterministic Old vs New regime impact');
  } else if (
    lower.includes('calculate') ||
    lower.includes('regime') ||
    lower.includes('compare') ||
    lower.includes('taxable')
  ) {
    pushStep('compare_tax_regimes', 'Compute deterministic tax liability under Old and New regimes');
  } else if (
    lower.includes('reconcil') ||
    lower.includes('mismatch') ||
    lower.includes('discrepanc') ||
    lower.includes('missing') ||
    lower.includes('interest')
  ) {
    pushStep('inspect_documents', 'Check available documents');
    pushStep('reconcile_documents', 'Identify cross-document variances and missing evidence');
  } else {
    pushStep('retrieve_tax_rules', 'Retrieve applicable AY 2026-27 statutory provisions');
    pushStep('inspect_return', 'Ground response in current return state');
  }

  return {
    intentSummary: userPrompt.slice(0, 140),
    llmEngineUsed: llmLabel,
    steps,
  };
}

const ORCHESTRATOR_SYSTEM_PROMPT = `You are the TaxShield MCP Autonomous AI Tax Filing Assistant for Resident Salaried Individuals in India (AY 2026-27 / FY 2025-26, ITR-1 Sahaj).

OPERATING RULES:
1. DYNAMIC MCP WORKFLOW EXECUTION:
   - Autonomously invoke the appropriate MCP tools to inspect documents, reconcile discrepancies, retrieve rules from rules/AY2026-27.yaml, and compute taxes.
   - NEVER repeat identical tool calls in the same turn.

2. STRICT DETERMINISTIC TAX AUTHORITY:
   - NEVER calculate, estimate, or invent tax amounts yourself. ALWAYS invoke \`compare_tax_regimes\` or \`calculate_tax\` (passing hypothetical figures when showing the impact of unconfirmed items) and report the exact INR numbers returned by the YAML deterministic engine.

3. SEPARATE SAVINGS VS FIXED DEPOSIT INTEREST & RECONCILIATION:
   - NEVER combine Savings Bank Interest (\`savingsInterest\`) and Fixed Deposit Interest (\`fdInterest\`). Savings interest qualifies for Section 80TTA (up to ₹10,000 in Old Regime), whereas FD interest is strictly excluded from Section 80TTA!
   - When \`reconcile_documents\` reveals unconfirmed items (e.g. ₹10,000 savings interest in Bank Statement, ₹15,000 FD interest in FD Certificate, or ₹1,00,000 u/s 80C in Investment Proof):
     a) If the user has NOT yet confirmed including them (e.g. initial "Analyze my documents" or "Check discrepancies"), cite each source filename, page number, and amount using clean Markdown headings and tables, explain why Savings Bank Interest (Section 80TTA eligible in Old Regime) and Fixed Deposit Interest (taxable Schedule OS, non-80TTA) are treated separately, and ask the user to confirm inclusion — OR if the user explicitly asked to "Prepare my income tax return" / "Include all uploaded documents" / "Yes, include them", call \`update_return_information\` (with separate \`savingsInterest\`, \`fdInterest\`, \`section80C\`, etc.) so the SecurityGateway stages the operation for their explicit human approval!
   - If the user mentions unsupported scope items (capital gains, crypto/VDA, business/freelance income, foreign assets/NRI, multiple employers, senior citizen 60+/80TTB, house property, or income > ₹50L), call \`add_income_information\` or explain clearly that ITR-1 automated preparation halts safely for unsupported scope.

4. HUMAN-IN-THE-LOOP SECURITY GATEWAY & CLEAN MARKDOWN OUTPUT:
   - Structure responses with concise Markdown headings (\`###\`), bullet points, and Markdown tables for financial comparisons.
   - NEVER output plain-text fake button labels at the bottom of your message (the UI renders real interactive action buttons automatically).
   - Whenever a mutation tool returns \`PENDING_HUMAN_APPROVAL\`, clearly summarize the staged fields, source documents, and tax impact so the user can click **Approve**, **Reject**, or **Cancel**.
   - NEVER claim a return was submitted to the Income Tax Department portal. All generated ITR-1 drafts are local review & download files only.`;

/**
 * Deterministic Non-LLM Demo Fallback Planner:
 * Clearly labelled (`isDeterministicFallback: true`) when neither local Ollama nor cloud Gemini API
 * is reachable/configured. Executes the exact same real MCP tools, SecurityGateway, approval workflow,
 * and YAML deterministic tax engine without pretending to be a generative LLM.
 */
async function runDeterministicDemoFallbackLoop(params: {
  userPrompt: string;
  store: SqliteTaxWorkspaceStore;
  mcpClient?: Client;
  plan: AgentExecutionPlan;
  toolTraces: AgentToolTrace[];
  collectedCitations: Map<string, RagRuleCitation>;
  pendingApprovalIds: string[];
  clarificationQuestions: string[];
  turnSignatures: Map<string, number>;
}): Promise<string> {
  const {
    userPrompt,
    store,
    mcpClient,
    plan,
    toolTraces,
    collectedCitations,
    pendingApprovalIds,
    clarificationQuestions,
    turnSignatures,
  } = params;

  plan.llmEngineUsed = 'Deterministic Rule Planner (Non-LLM Fallback)';
  const lower = userPrompt.toLowerCase();

  const callTool = async (toolName: McpToolName, args: Record<string, unknown>) => {
    const outcome = await executeThroughSecurityGateway({
      toolName,
      args,
      requestedBy: 'ai_agent',
      store,
      mcpClient,
      turnToolCallSignatures: turnSignatures,
    });
    recordOutcomeIntoPlanAndCollections({
      toolName,
      args,
      outcome,
      plan,
      toolTraces,
      collectedCitations,
      pendingApprovalIds,
      clarificationQuestions,
    });
    return outcome;
  };

  // 1. Check unsupported scenario in natural-language prompt first
  const unsupported = detectUnsupportedFilingScenario(userPrompt);
  if (unsupported) {
    await callTool('add_income_information', {
      incomeType: unsupported.code,
      amount: 1,
      description: userPrompt,
    });
    return `[Deterministic Non-LLM Fallback Mode]\n\n**Unsupported Filing Scenario Halted (${unsupported.title})**\n\n${unsupported.reason}\n\n- **Detected From**: "${unsupported.detectedFrom}"\n- **Required Handling**: ${unsupported.recommendedItrForm}\n- **Safety Status**: Automated ITR-1 draft generation has been halted to prevent an invalid filing.`;
  }

  // 2. Inspect uploaded documents & reconcile
  await callTool('inspect_documents', {});
  const reconOutcome = await callTool('reconcile_documents', {});
  const recon = reconOutcome.toolOutputForAgent as unknown as ReconciliationReport;

  await callTool('retrieve_tax_rules', {
    query: 'Section 115BAC 87A 80C 80TTA AY 2026-27',
  });

  const activeDraft = store.getActiveDraft();
  const actionableConflicts = (recon.items ?? []).filter(
    (item) => item.recommendedAction && item.resolutionStatus === 'needs_clarification'
  );

  const userConfirmedApply =
    lower.includes('yes') ||
    lower.includes('confirm') ||
    lower.includes('include') ||
    lower.includes('apply') ||
    lower.includes('stage') ||
    lower.includes('finalize') ||
    lower.includes('generate');

  // Parse explicit user natural-language additions (e.g. "add 25000 80D" or "savings interest 12000")
  const explicit80DMatch = userPrompt.match(/(?:80d|health insurance)[^\d]*([\d,]+)/i);
  if (explicit80DMatch?.[1]) {
    const amt = Number(explicit80DMatch[1].replace(/,/g, ''));
    if (amt > 0) {
      await callTool('add_deduction_information', {
        deductionSection: 'section80D',
        amount: amt,
        description: `User confirmed Section 80D health insurance of ₹${amt.toLocaleString('en-IN')}`,
        hasSupportingProof: true,
      });
    }
  }

  if (actionableConflicts.length > 0 && userConfirmedApply) {
    const updatePayload: Record<string, unknown> = {
      reason:
        'Reconciled uploaded documents (keeping Savings Bank Interest and FD Interest strictly separate alongside verified Section 80C proofs).',
    };
    for (const c of actionableConflicts) {
      if (c.recommendedAction) {
        updatePayload[c.recommendedAction.fieldToUpdate] = c.recommendedAction.proposedValue;
      }
    }
    await callTool('update_return_information', updatePayload);

    const hypOutcome = await callTool('compare_tax_regimes', updatePayload);
    const hyp = hypOutcome.toolOutputForAgent as unknown as TaxComparisonSummary;

    return `### Staged Return Update Ready for Approval\n\nI inspected your uploaded documents, reconciled every discrepancy, and staged the financial updates through the **SecurityGateway**:\n\n| Schedule / Item | Proposed Amount | Statutory Tax Treatment |\n| --- | ---: | --- |\n| **Gross Salary (Form 16)** | ₹${hyp.newRegime.grossSalary.toLocaleString('en-IN')} | Schedule S (TDS Credited: ₹${hyp.newRegime.tdsCredited.toLocaleString('en-IN')}) |\n| **Savings Bank Interest** | ₹${hyp.newRegime.savingsInterest.toLocaleString('en-IN')} | Eligible for **Section 80TTA** deduction up to ₹10,000 in Old Regime |\n| **Fixed Deposit Interest** | ₹${hyp.newRegime.fdInterest.toLocaleString('en-IN')} | Taxable under Schedule OS · **Excluded from Section 80TTA** |\n| **Section 80C Investments** | ₹${Number(updatePayload.section80C ?? activeDraft.inputs.section80C).toLocaleString('en-IN')} | Eligible up to ₹1,50,000 in Old Regime |\n\n### Projected Regime Comparison (${hyp.assessmentYear})\n\n| Metric | New Regime (115BAC) | Old Regime |\n| --- | ---: | ---: |\n| **Taxable Income** | ₹${hyp.newRegime.taxableIncome.toLocaleString('en-IN')} | ₹${hyp.oldRegime.taxableIncome.toLocaleString('en-IN')} |\n| **Total Tax Liability** | **₹${hyp.newRegime.totalTaxLiability.toLocaleString('en-IN')}** | **₹${hyp.oldRegime.totalTaxLiability.toLocaleString('en-IN')}** |\n| **Refund / Net Payable** | Refund **₹${hyp.newRegime.refundDue.toLocaleString('en-IN')}** | ${hyp.oldRegime.refundDue > 0 ? `Refund ₹${hyp.oldRegime.refundDue.toLocaleString('en-IN')}` : `Payable ₹${hyp.oldRegime.netTaxPayable.toLocaleString('en-IN')}`} |\n\nReview and click **Approve & Continue Agent** on the staged operation card below. Once approved, I will automatically resume, validate the return, and stage your ITR-1 draft.`;
  }

  if (actionableConflicts.length > 0 && !userConfirmedApply) {
    const compOutcome = await callTool('compare_tax_regimes', {});
    const comp = compOutcome.toolOutputForAgent as unknown as TaxComparisonSummary;
    const conflictRows = actionableConflicts
      .map(
        (c) =>
          `| **${c.title}** | ${c.sourceBDocName}${c.sourceBPage ? ` (p.${c.sourceBPage})` : ''} | ₹${(c.sourceBValue ?? c.varianceAmount).toLocaleString('en-IN')} | ${c.explanation} |`
      )
      .join('\n');

    const question =
      'Would you like me to include your extracted Savings Bank Interest, Fixed Deposit Interest, and verified Section 80C investment proofs in your return, and do you have any additional deductions (such as Section 80D health insurance)?';
    clarificationQuestions.push(question);
    plan.steps.push({
      stepNumber: plan.steps.length + 1,
      toolName: 'ask_clarification',
      objective: `Request taxpayer confirmation on ${actionableConflicts.length} reconciled document variance(s)`,
      status: 'completed',
    });

    return `### Document Reconciliation Findings\n\nI analyzed your uploaded documents and identified **${actionableConflicts.length} unconfirmed financial item(s)** not yet reflected in your Form 16 baseline:\n\n| Item | Source Document | Extracted Value | Reconciliation Detail |\n| --- | --- | ---: | --- |\n${conflictRows}\n\n- **Savings Bank Interest vs. Fixed Deposit Interest**: Savings bank interest qualifies for **Section 80TTA** (up to ₹10,000 in the Old Regime), whereas fixed deposit interest is fully taxable under Schedule OS in both regimes and must remain separate.\n- **Current Baseline Tax**: New Regime tax on Form 16 salary alone is **₹${comp.newRegime.totalTaxLiability.toLocaleString('en-IN')}** (TDS credited: ₹${comp.newRegime.tdsCredited.toLocaleString('en-IN')}).\n\n${question}`;
  }

  // No unconfirmed conflicts left -> compare regimes, validate, and stage draft generation if requested
  const compOutcome = await callTool('compare_tax_regimes', {});
  const comp = compOutcome.toolOutputForAgent as unknown as TaxComparisonSummary;
  const valOutcome = await callTool('validate_return', {});
  const val = valOutcome.toolOutputForAgent as unknown as ValidationResult;

  if (
    (lower.includes('generate') || lower.includes('finalize') || lower.includes('prepare')) &&
    val.isValid &&
    activeDraft.inputs.grossSalary > 0 &&
    activeDraft.status !== 'validated_ready'
  ) {
    await callTool('generate_return_draft', {
      selectedRegime: comp.recommendedRegime,
      releaseNote: `Finalized ITR-1 Sahaj draft under optimal ${comp.recommendedRegime.toUpperCase()} regime.`,
    });
    return `### Ready to Finalize ITR-1 Draft\n\nAll documents are reconciled and validation passed (**${val.passCount} checks passed, 0 errors**). I have staged **Finalize & Generate ITR-1 Draft** under the optimal **${comp.recommendedRegime.toUpperCase()} Regime** for your approval.`;
  }

  return `### Deterministic Tax Regime Comparison (${comp.assessmentYear})\n\n| Metric | New Regime (115BAC) | Old Regime |\n| --- | ---: | ---: |\n| **Gross Total Income** | ₹${comp.newRegime.grossTotalIncome.toLocaleString('en-IN')} | ₹${comp.oldRegime.grossTotalIncome.toLocaleString('en-IN')} |\n| **Chapter VI-A Deductions** | ₹${comp.newRegime.totalChapterVIADeductions.toLocaleString('en-IN')} | ₹${comp.oldRegime.totalChapterVIADeductions.toLocaleString('en-IN')} |\n| **Taxable Income** | ₹${comp.newRegime.taxableIncome.toLocaleString('en-IN')} | ₹${comp.oldRegime.taxableIncome.toLocaleString('en-IN')} |\n| **Total Tax Liability** | **₹${comp.newRegime.totalTaxLiability.toLocaleString('en-IN')}** | **₹${comp.oldRegime.totalTaxLiability.toLocaleString('en-IN')}** |\n| **Refund / Payable** | Refund **₹${comp.newRegime.refundDue.toLocaleString('en-IN')}** | ${comp.oldRegime.refundDue > 0 ? `Refund ₹${comp.oldRegime.refundDue.toLocaleString('en-IN')}` : `Payable ₹${comp.oldRegime.netTaxPayable.toLocaleString('en-IN')}`} |\n\n- **Recommended Regime**: **${comp.recommendedRegime.toUpperCase()}** (saves **₹${comp.netSavingsInRecommended.toLocaleString('en-IN')}**).`;
}

export async function runTaxAssistantTurn(params: {
  message: string;
  attachedDocNames?: string[];
  store?: SqliteTaxWorkspaceStore;
  mcpClient?: Client;
}): Promise<ChatMessage> {
  const store = params.store ?? workspaceStore;
  const userPrompt = params.message.trim();
  const llmStatus = await getLlmRuntimeStatus();
  const llmLabel =
    llmStatus.activeProvider === 'ollama_qwen3'
      ? `Ollama (${llmStatus.configuredModel})`
      : llmStatus.activeProvider === 'gemini_cloud'
        ? `Gemini (${llmStatus.configuredModel})`
        : llmStatus.configuredModel;

  store.setAgentState('PLANNING');

  const userMsg: ChatMessage = {
    id: `msg-user-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    role: 'user',
    content: userPrompt,
    timestamp: new Date().toISOString(),
    attachedDocuments: params.attachedDocNames,
  };
  store.appendChatMessage(userMsg);

  const plan = buildDynamicInitialPlan(userPrompt, llmLabel, store);
  const gatewayConfig = store.getGatewayConfig();
  const promptForLlm = gatewayConfig.enforcePiiMaskingToLlm
    ? maskSensitivePii(userPrompt).maskedText
    : userPrompt;

  const toolTraces: AgentToolTrace[] = [];
  const collectedCitations = new Map<string, RagRuleCitation>();
  const pendingApprovalIds: string[] = [];
  const clarificationQuestions: string[] = [];
  const turnSignatures = new Map<string, number>();

  store.setAgentState('EXECUTING_TOOLS');

  let finalAssistantText = '';
  let usedDeterministicFallback = false;
  const maxIterations = 6;

  const runGeminiLoop = async () => {
    const priorHistory = store.getChatHistory().slice(-9, -1);
    const rawTurns: Array<{ role: 'user' | 'model'; text: string }> = priorHistory.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      text: gatewayConfig.enforcePiiMaskingToLlm
        ? maskSensitivePii(m.content).maskedText
        : m.content,
    }));

    const attachmentContext =
      params.attachedDocNames && params.attachedDocNames.length > 0
        ? `\n[System Note: User just uploaded and extracted ${params.attachedDocNames.length} document(s) in this turn: ${params.attachedDocNames.join(', ')}. Inspect and reconcile them.]`
        : '';

    rawTurns.push({
      role: 'user',
      text: `${promptForLlm}${attachmentContext}`,
    });

    while (rawTurns.length > 1 && rawTurns[0].role === 'model') {
      rawTurns.shift();
    }
    const contents: Content[] = [];
    for (const turn of rawTurns) {
      const prev = contents[contents.length - 1];
      if (prev && prev.role === turn.role && prev.parts?.[0] && 'text' in prev.parts[0]) {
        prev.parts[0] = { text: `${prev.parts[0].text}\n\n${turn.text}` };
      } else {
        contents.push({
          role: turn.role,
          parts: [{ text: turn.text }],
        });
      }
    }

    for (let step = 0; step < maxIterations; step++) {
      const { response, modelUsed } = await generateGeminiWithFallback({
        contents,
        config: {
          systemInstruction: ORCHESTRATOR_SYSTEM_PROMPT,
          tools: [{ functionDeclarations: GEMINI_TOOL_DECLARATIONS }],
        },
        perAttemptTimeoutMs: 15_000,
      });
      plan.llmEngineUsed = `Gemini (${modelUsed})`;

      const candidateContent = response.candidates?.[0]?.content;
      const functionCalls = response.functionCalls;

      if (!functionCalls || functionCalls.length === 0 || !candidateContent) {
        finalAssistantText = response.text || '';
        break;
      }

      contents.push(candidateContent);

      const responseParts: Array<{
        functionResponse: {
          id?: string;
          name: string;
          response: Record<string, unknown>;
        };
      }> = [];

      for (const call of functionCalls) {
        const toolName = call.name as McpToolName;
        const toolArgs = (call.args ?? {}) as Record<string, unknown>;

        const outcome = await executeThroughSecurityGateway({
          toolName,
          args: toolArgs,
          requestedBy: 'ai_agent',
          store,
          mcpClient: params.mcpClient,
          turnToolCallSignatures: turnSignatures,
        });

        recordOutcomeIntoPlanAndCollections({
          toolName,
          args: toolArgs,
          outcome,
          plan,
          toolTraces,
          collectedCitations,
          pendingApprovalIds,
          clarificationQuestions,
        });

        responseParts.push({
          functionResponse: {
            id: call.id,
            name: toolName,
            response: outcome.toolOutputForAgent,
          },
        });
      }

      contents.push({
        role: 'user',
        parts: responseParts,
      });
    }
  };

  try {
    if (llmStatus.activeProvider === 'deterministic_demo_fallback') {
      usedDeterministicFallback = true;
      finalAssistantText = await runDeterministicDemoFallbackLoop({
        userPrompt,
        store,
        mcpClient: params.mcpClient,
        plan,
        toolTraces,
        collectedCitations,
        pendingApprovalIds,
        clarificationQuestions,
        turnSignatures,
      });
    } else if (llmStatus.activeProvider === 'ollama_qwen3') {
      try {
        const priorHistory = store.getChatHistory().slice(-7, -1);
        const ollamaMessages: Array<{
          role: 'system' | 'user' | 'assistant' | 'tool';
          content: string;
        }> = [
          { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
          ...priorHistory.map((m) => ({
            role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
            content: gatewayConfig.enforcePiiMaskingToLlm
              ? maskSensitivePii(m.content).maskedText
              : m.content,
          })),
          { role: 'user', content: promptForLlm },
        ];

        const ollamaTools = MCP_TOOL_DEFINITIONS.filter(
          (t) => t.name !== 'approve_operation' && t.name !== 'reject_operation'
        ).map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema as Record<string, unknown>,
          },
        }));

        for (let step = 0; step < maxIterations; step++) {
          const res = await callOllamaChatWithTools({
            ollamaUrl: llmStatus.ollamaUrl,
            model: llmStatus.configuredModel,
            messages: ollamaMessages,
            tools: ollamaTools,
          });

          if (res.toolCalls.length === 0) {
            finalAssistantText = res.text;
            break;
          }

          ollamaMessages.push({
            role: 'assistant',
            content: res.text || 'Invoking controlled MCP tools...',
          });

          for (const call of res.toolCalls) {
            const toolName = call.name as McpToolName;
            const outcome = await executeThroughSecurityGateway({
              toolName,
              args: call.args,
              requestedBy: 'ai_agent',
              store,
              mcpClient: params.mcpClient,
              turnToolCallSignatures: turnSignatures,
            });

            recordOutcomeIntoPlanAndCollections({
              toolName,
              args: call.args,
              outcome,
              plan,
              toolTraces,
              collectedCitations,
              pendingApprovalIds,
              clarificationQuestions,
            });

            ollamaMessages.push({
              role: 'tool',
              content: JSON.stringify(outcome.toolOutputForAgent),
            });
          }
        }
      } catch {
        if (hasValidGeminiApiKey()) {
          await runGeminiLoop();
        } else {
          usedDeterministicFallback = true;
          finalAssistantText = await runDeterministicDemoFallbackLoop({
            userPrompt,
            store,
            mcpClient: params.mcpClient,
            plan,
            toolTraces,
            collectedCitations,
            pendingApprovalIds,
            clarificationQuestions,
            turnSignatures,
          });
        }
      }
    } else {
      try {
        await runGeminiLoop();
      } catch {
        usedDeterministicFallback = true;
        finalAssistantText = await runDeterministicDemoFallbackLoop({
          userPrompt,
          store,
          mcpClient: params.mcpClient,
          plan,
          toolTraces,
          collectedCitations,
          pendingApprovalIds,
          clarificationQuestions,
          turnSignatures,
        });
      }
    }
  } catch (err) {
    store.setAgentState('ERROR');
    throw err;
  }

  for (const s of plan.steps) {
    if (s.status === 'planned') {
      const ran = toolTraces.some((t) => t.toolName === s.toolName);
      s.status = ran ? 'completed' : 'skipped';
    }
  }

  const activeSession = store.getActiveSession();
  const stillPendingCount = store
    .getApprovals(activeSession.id)
    .filter((a) => a.status === 'pending').length;

  let nextState: AgentExecutionState = 'IDLE';
  if (
    activeSession.unsupportedScenarios.length > 0 ||
    store.getActiveDraft(activeSession.id).validation.unsupportedScenarios.length > 0
  ) {
    nextState = 'HALTED_UNSUPPORTED_SCENARIO';
    store.setAgentState('HALTED_UNSUPPORTED_SCENARIO', 'unsupported_scenario', activeSession.id);
  } else if (pendingApprovalIds.length > 0 || stillPendingCount > 0) {
    nextState = 'WAITING_FOR_HUMAN_APPROVAL';
    store.setAgentState('WAITING_FOR_HUMAN_APPROVAL', 'pending_approval', activeSession.id);
  } else if (clarificationQuestions.length > 0 || finalAssistantText.includes('?')) {
    nextState = 'WAITING_FOR_USER_CLARIFICATION';
    store.setAgentState(
      'WAITING_FOR_USER_CLARIFICATION',
      'awaiting_clarification',
      activeSession.id
    );
  } else if (store.getActiveDraft(activeSession.id).status === 'validated_ready') {
    nextState = 'COMPLETED';
    store.setAgentState('COMPLETED', 'ready_to_download', activeSession.id);
  } else {
    store.setAgentState('IDLE', undefined, activeSession.id);
  }

  if (!finalAssistantText) {
    finalAssistantText =
      'I have executed the planned MCP tools via the SecurityGateway. Review the execution plan, extracted facts, and any pending approval cards below.';
  }

  const uniquePendingIds = Array.from(new Set(pendingApprovalIds));

  const assistantMsg: ChatMessage = {
    id: `msg-ai-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    role: 'assistant',
    content: finalAssistantText,
    timestamp: new Date().toISOString(),
    agentStateAfterTurn: nextState,
    isDeterministicFallback: usedDeterministicFallback || undefined,
    executionPlan: plan,
    toolTraces: toolTraces.length > 0 ? toolTraces : undefined,
    citations:
      collectedCitations.size > 0 ? Array.from(collectedCitations.values()) : undefined,
    pendingApprovalIds: uniquePendingIds.length > 0 ? uniquePendingIds : undefined,
    clarificationQuestions:
      clarificationQuestions.length > 0 ? clarificationQuestions : undefined,
  };

  store.appendChatMessage(assistantMsg);
  return assistantMsg;
}

/**
 * Automatic Post-Approval Orchestrator Continuation (Fixes Stuck WAITING_FOR_HUMAN_APPROVAL Bug):
 * Invoked automatically when a taxpayer resolves an approval request (`approve`, `reject`, or `cancel`).
 * If there are no remaining `pending` approvals in the session, the orchestrator immediately resumes:
 * - Refreshes reconciliation, deterministic tax comparison, and validation via real MCP tools.
 * - Stages `generate_return_draft` once financial updates are reconciled, OR marks `COMPLETED` once
 *   `generate_return_draft` finishes executing, OR transitions cleanly to `WAITING_FOR_USER_CLARIFICATION`
 *   on rejection/cancellation without modifying return state!
 */
export async function resumeOrchestratorAfterApprovalDecision(params: {
  resolvedApproval: ApprovalRequest;
  action: 'approve' | 'reject' | 'cancel';
  store?: SqliteTaxWorkspaceStore;
  mcpClient?: Client;
}): Promise<ChatMessage | null> {
  const store = params.store ?? workspaceStore;
  const { resolvedApproval, action, mcpClient } = params;
  const sessionId = resolvedApproval.sessionId;

  // Ensure store points at the session being resolved
  if (store.getActiveSessionId() !== sessionId) {
    store.switchSession(sessionId);
  }

  const remainingPending = store
    .getApprovals(sessionId)
    .filter((a) => a.status === 'pending');

  // If more approvals are still pending in this batch, remain in WAITING_FOR_HUMAN_APPROVAL until resolved
  if (remainingPending.length > 0) {
    store.setAgentState('WAITING_FOR_HUMAN_APPROVAL', 'pending_approval', sessionId);
    const partialMsg: ChatMessage = {
      id: `msg-appr-progress-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      role: 'assistant',
      timestamp: new Date().toISOString(),
      agentStateAfterTurn: 'WAITING_FOR_HUMAN_APPROVAL',
      isAutoResumedTurn: true,
      pendingApprovalIds: remainingPending.map((a) => a.id),
      content: `Resolved **${resolvedApproval.summary}** (${resolvedApproval.status.toUpperCase()}). ${remainingPending.length} staged operation(s) remain pending your decision before I resume the workflow.`,
    };
    store.appendChatMessage(partialMsg, sessionId);
    return partialMsg;
  }

  // Handle Rejection or Cancellation cleanly without mutating return state
  if (action === 'reject' || action === 'cancel') {
    store.setAgentState('WAITING_FOR_USER_CLARIFICATION', 'awaiting_clarification', sessionId);
    const rejectedMsg: ChatMessage = {
      id: `msg-appr-rejected-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      role: 'assistant',
      timestamp: new Date().toISOString(),
      agentStateAfterTurn: 'WAITING_FOR_USER_CLARIFICATION',
      isAutoResumedTurn: true,
      content: `Operation **${resolvedApproval.summary}** was **${resolvedApproval.status.toUpperCase()}**. Your return figures were **not** modified.\n\nWould you like to provide an alternative value in chat, keep the existing return figures, or proceed with a different regime?`,
    };
    store.appendChatMessage(rejectedMsg, sessionId);
    return rejectedMsg;
  }

  // Handle Failed Execution
  if (resolvedApproval.status === 'failed') {
    const session = store.getActiveSession(sessionId);
    const nextState: AgentExecutionState =
      session.unsupportedScenarios.length > 0 ? 'HALTED_UNSUPPORTED_SCENARIO' : 'ERROR';
    store.setAgentState(
      nextState,
      nextState === 'HALTED_UNSUPPORTED_SCENARIO' ? 'unsupported_scenario' : 'reconciling',
      sessionId
    );
    const failMsg: ChatMessage = {
      id: `msg-appr-failed-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      role: 'assistant',
      timestamp: new Date().toISOString(),
      agentStateAfterTurn: nextState,
      isAutoResumedTurn: true,
      content: `Execution of **${resolvedApproval.summary}** halted safely: ${resolvedApproval.executionResultSummary || 'Scope or validation error.'}`,
    };
    store.appendChatMessage(failMsg, sessionId);
    return failMsg;
  }

  // All pending approvals are now resolved and this approval was `executed`!
  // Resume orchestrator (`PLANNING` -> `EXECUTING_TOOLS`) to continue the filing workflow automatically.
  store.setAgentState('PLANNING', 'reconciling', sessionId);
  const plan: AgentExecutionPlan = {
    intentSummary: `Auto-resumed workflow after executing "${resolvedApproval.summary}"`,
    llmEngineUsed: 'Orchestrator Auto-Resume (MCP + YAML Deterministic Engine)',
    steps: [],
  };
  const toolTraces: AgentToolTrace[] = [];
  const collectedCitations = new Map<string, RagRuleCitation>();
  const pendingApprovalIds: string[] = [];
  const clarificationQuestions: string[] = [];
  const turnSignatures = new Map<string, number>();

  store.setAgentState('EXECUTING_TOOLS', 'reconciling', sessionId);

  const runStep = async (
    toolName: McpToolName,
    objective: string,
    args: Record<string, unknown> = {}
  ) => {
    plan.steps.push({
      stepNumber: plan.steps.length + 1,
      toolName,
      objective,
      status: 'planned',
    });
    const outcome = await executeThroughSecurityGateway({
      toolName,
      args,
      requestedBy: 'ai_agent',
      store,
      mcpClient,
      turnToolCallSignatures: turnSignatures,
    });
    recordOutcomeIntoPlanAndCollections({
      toolName,
      args,
      outcome,
      plan,
      toolTraces,
      collectedCitations,
      pendingApprovalIds,
      clarificationQuestions,
    });
    return outcome;
  };

  // Case A: The approved operation WAS `generate_return_draft` -> Validate & Complete!
  if (resolvedApproval.operationType === 'draft_finalization') {
    const valOut = await runStep(
      'validate_return',
      'Verify finalized ITR-1 draft schema and statutory checks'
    );
    await runStep('get_return_status', 'Confirm final session readiness');
    const val = valOut.toolOutputForAgent as unknown as ValidationResult;
    const latestDraft = store.getActiveDraft(sessionId);
    const activeRegimeCalc =
      latestDraft.selectedRegime === 'new'
        ? latestDraft.taxSummary.newRegime
        : latestDraft.taxSummary.oldRegime;

    const finalState: AgentExecutionState =
      val.unsupportedScenarios.length > 0 ? 'HALTED_UNSUPPORTED_SCENARIO' : 'COMPLETED';
    store.setAgentState(
      finalState,
      finalState === 'COMPLETED' ? 'ready_to_download' : 'unsupported_scenario',
      sessionId
    );

    const completionMsg: ChatMessage = {
      id: `msg-auto-complete-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      role: 'assistant',
      timestamp: new Date().toISOString(),
      agentStateAfterTurn: finalState,
      isAutoResumedTurn: true,
      executionPlan: plan,
      toolTraces,
      content: `**ITR-1 (Sahaj) Draft v${latestDraft.version} Finalized & Ready for Download**\n\nYour approved finalization has executed and all post-execution checks completed:\n- **Selected Regime**: ${latestDraft.selectedRegime.toUpperCase()} Regime (${latestDraft.taxSummary.ruleEngineVersion})\n- **Taxable Income (u/s 288A)**: ₹${activeRegimeCalc.taxableIncome.toLocaleString('en-IN')}\n- **Total Tax Liability (incl. 4% Cess)**: ₹${activeRegimeCalc.totalTaxLiability.toLocaleString('en-IN')}\n- **Verified TDS & Advance Tax**: ₹${(activeRegimeCalc.tdsCredited + activeRegimeCalc.advanceTaxPaid).toLocaleString('en-IN')}\n- **${activeRegimeCalc.refundDue > 0 ? 'Net Refund Due (u/s 288B)' : 'Net Tax Payable (u/s 288B)'}**: **₹${(activeRegimeCalc.refundDue > 0 ? activeRegimeCalc.refundDue : activeRegimeCalc.netTaxPayable).toLocaleString('en-IN')}**\n- **Validation**: ${val.passCount} passed · ${val.errorCount} errors\n\nOpen **Generated Return** to inspect or download your structured ITR-1 JSON draft *(local review draft only — never submitted to the Income Tax Department portal)*.`,
    };
    store.appendChatMessage(completionMsg, sessionId);
    return completionMsg;
  }

  // Case B: The approved operation updated financial inputs (`return_update`, `income_addition`, `deduction_addition`, `conflict_resolution`)
  // Automatically refresh reconciliation, recalculate taxes, validate, and stage `generate_return_draft` if ready!
  const reconOut = await runStep(
    'reconcile_documents',
    'Verify cross-document reconciliation after approved update'
  );
  const compOut = await runStep(
    'compare_tax_regimes',
    'Recalculate deterministic Old vs New tax liability on updated state'
  );
  const valOut = await runStep(
    'validate_return',
    'Run mandatory ITR-1 field and scope validation'
  );

  const recon = reconOut.toolOutputForAgent as unknown as ReconciliationReport;
  const comp = compOut.toolOutputForAgent as unknown as TaxComparisonSummary;
  const val = valOut.toolOutputForAgent as unknown as ValidationResult;
  const latestDraft = store.getActiveDraft(sessionId);

  if (val.unsupportedScenarios.length > 0) {
    store.setAgentState('HALTED_UNSUPPORTED_SCENARIO', 'unsupported_scenario', sessionId);
    const haltMsg: ChatMessage = {
      id: `msg-auto-halt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      role: 'assistant',
      timestamp: new Date().toISOString(),
      agentStateAfterTurn: 'HALTED_UNSUPPORTED_SCENARIO',
      isAutoResumedTurn: true,
      executionPlan: plan,
      toolTraces,
      content: `Approved update **${resolvedApproval.summary}** was recorded, but validation detected an **unsupported ITR-1 scenario** (${val.unsupportedScenarios.map((u) => u.title).join(', ')}). Automated ITR-1 draft generation has been halted safely.`,
    };
    store.appendChatMessage(haltMsg, sessionId);
    return haltMsg;
  }

  const remainingActionableConflicts = (recon.items ?? []).filter(
    (i) => i.recommendedAction && i.resolutionStatus === 'needs_clarification'
  );

  if (remainingActionableConflicts.length === 0 && val.isValid && latestDraft.inputs.grossSalary > 0) {
    // Stage final ITR-1 draft generation automatically so the user can finish in one click!
    await runStep(
      'generate_return_draft',
      `Stage final ITR-1 Sahaj draft under optimal ${comp.recommendedRegime.toUpperCase()} regime`,
      {
        selectedRegime: comp.recommendedRegime,
        releaseNote: `Auto-staged validated ITR-1 draft under optimal ${comp.recommendedRegime.toUpperCase()} regime after reconciling all uploaded documents.`,
      }
    );

    const hasNewPending = pendingApprovalIds.length > 0;
    const nextState: AgentExecutionState = hasNewPending
      ? 'WAITING_FOR_HUMAN_APPROVAL'
      : 'COMPLETED';
    store.setAgentState(
      nextState,
      hasNewPending ? 'pending_approval' : 'ready_to_download',
      sessionId
    );

    const resumedMsg: ChatMessage = {
      id: `msg-auto-stage-draft-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      role: 'assistant',
      timestamp: new Date().toISOString(),
      agentStateAfterTurn: nextState,
      isAutoResumedTurn: true,
      executionPlan: plan,
      toolTraces,
      pendingApprovalIds: hasNewPending ? Array.from(new Set(pendingApprovalIds)) : undefined,
      content: `Approved operation **${resolvedApproval.summary}** executed (` +
        `Draft v${latestDraft.version}). I automatically resumed your workflow, verified zero remaining document conflicts, and recalculated your return:\n\n` +
        `- **New Tax Regime (u/s 115BAC(1A))**: Taxable Income ₹${comp.newRegime.taxableIncome.toLocaleString('en-IN')} · Tax **₹${comp.newRegime.totalTaxLiability.toLocaleString('en-IN')}** · ${comp.newRegime.refundDue > 0 ? `Refund **₹${comp.newRegime.refundDue.toLocaleString('en-IN')}**` : `Payable **₹${comp.newRegime.netTaxPayable.toLocaleString('en-IN')}**`}\n` +
        `- **Old Tax Regime**: Taxable Income ₹${comp.oldRegime.taxableIncome.toLocaleString('en-IN')} · Tax **₹${comp.oldRegime.totalTaxLiability.toLocaleString('en-IN')}** · ${comp.oldRegime.refundDue > 0 ? `Refund **₹${comp.oldRegime.refundDue.toLocaleString('en-IN')}**` : `Payable **₹${comp.oldRegime.netTaxPayable.toLocaleString('en-IN')}**`}\n` +
        `- **Optimal Regime**: **${comp.recommendedRegime.toUpperCase()}** (saves ₹${comp.netSavingsInRecommended.toLocaleString('en-IN')})\n\n` +
        (hasNewPending
          ? `I have staged **Finalize & Generate ITR-1 Draft** below. Click **Approve** to lock and download your validated ITR-1 JSON draft.`
          : `Your validated ITR-1 JSON draft is now complete and ready for download.`),
    };
    store.appendChatMessage(resumedMsg, sessionId);
    return resumedMsg;
  }

  // Otherwise, report updated tax numbers and highlight any remaining unconfirmed items
  const nextState: AgentExecutionState =
    remainingActionableConflicts.length > 0 ? 'WAITING_FOR_USER_CLARIFICATION' : 'IDLE';
  store.setAgentState(
    nextState,
    remainingActionableConflicts.length > 0 ? 'awaiting_clarification' : 'reconciling',
    sessionId
  );

  const followUpList = remainingActionableConflicts
    .map((c) => `- **${c.title}**: ${c.explanation}`)
    .join('\n');

  const followUpMsg: ChatMessage = {
    id: `msg-auto-followup-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    role: 'assistant',
    timestamp: new Date().toISOString(),
    agentStateAfterTurn: nextState,
    isAutoResumedTurn: true,
    executionPlan: plan,
    toolTraces,
    clarificationQuestions: clarificationQuestions.length > 0 ? clarificationQuestions : undefined,
    content:
      `Approved operation **${resolvedApproval.summary}** executed (Draft v${latestDraft.version}).\n\n` +
      `- **New Regime Tax**: ₹${comp.newRegime.totalTaxLiability.toLocaleString('en-IN')} (Refund ₹${comp.newRegime.refundDue.toLocaleString('en-IN')})\n` +
      `- **Old Regime Tax**: ₹${comp.oldRegime.totalTaxLiability.toLocaleString('en-IN')}\n\n` +
      (remainingActionableConflicts.length > 0
        ? `Before finalizing your ITR-1 draft, please confirm how you would like to handle the remaining item(s):\n${followUpList}`
        : `Let me know if you have any additional income/deductions or when you would like to generate your ITR-1 draft.`),
  };
  store.appendChatMessage(followUpMsg, sessionId);
  return followUpMsg;
}

function recordOutcomeIntoPlanAndCollections(params: {
  toolName: McpToolName;
  args?: Record<string, unknown>;
  outcome: Awaited<ReturnType<typeof executeThroughSecurityGateway>>;
  plan: AgentExecutionPlan;
  toolTraces: AgentToolTrace[];
  collectedCitations: Map<string, RagRuleCitation>;
  pendingApprovalIds: string[];
  clarificationQuestions: string[];
}): void {
  const {
    toolName,
    args,
    outcome,
    plan,
    toolTraces,
    collectedCitations,
    pendingApprovalIds,
    clarificationQuestions,
  } = params;

  const matchingStep = plan.steps.find(
    (s) => s.toolName === toolName && s.status === 'planned'
  );
  if (matchingStep) {
    matchingStep.status =
      outcome.decision === 'HELD_FOR_HUMAN_APPROVAL'
        ? 'held_for_approval'
        : outcome.errorCode
          ? 'failed'
          : 'completed';
  } else {
    plan.steps.push({
      stepNumber: plan.steps.length + 1,
      toolName,
      objective: `Dynamically invoked ${toolName}`,
      status:
        outcome.decision === 'HELD_FOR_HUMAN_APPROVAL'
          ? 'held_for_approval'
          : outcome.errorCode
            ? 'failed'
            : 'completed',
    });
  }

  if (outcome.approvalRequest) {
    pendingApprovalIds.push(outcome.approvalRequest.id);
  }

  if (
    toolName === 'retrieve_tax_rules' &&
    Array.isArray(outcome.toolOutputForAgent.citations)
  ) {
    for (const cit of outcome.toolOutputForAgent.citations as RagRuleCitation[]) {
      collectedCitations.set(cit.id, cit);
    }
  }

  if (
    toolName === 'reconcile_documents' &&
    Array.isArray(outcome.toolOutputForAgent.items)
  ) {
    for (const item of outcome.toolOutputForAgent.items as Array<{
      clarificationPrompt?: string;
    }>) {
      if (
        item.clarificationPrompt &&
        !clarificationQuestions.includes(item.clarificationPrompt)
      ) {
        clarificationQuestions.push(item.clarificationPrompt);
      }
    }
  }

  let traceSummary = `Executed ${toolName}`;
  if (outcome.decision === 'HELD_FOR_HUMAN_APPROVAL') {
    traceSummary = `Held ${toolName} for Human Approval`;
  } else if (outcome.errorCode) {
    traceSummary = `${outcome.decision} (${outcome.errorCode})`;
  }

  const maskedArgsPreview = maskSensitivePii(JSON.stringify(args ?? {})).maskedText.slice(0, 600);
  const maskedResponsePreview = maskSensitivePii(
    JSON.stringify(outcome.toolOutputForAgent ?? {})
  ).maskedText.slice(0, 900);

  toolTraces.push({
    id: `trace-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    toolName,
    gatewayDecision: outcome.decision,
    piiMaskedCount: outcome.piiMaskedCount,
    durationMs: outcome.durationMs,
    summary: traceSummary,
    timestamp: new Date().toISOString(),
    maskedArgsPreview,
    maskedResponsePreview,
    approvalRequestId: outcome.approvalRequest?.id,
    errorCode: outcome.errorCode,
  });
}
