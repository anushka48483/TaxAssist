import { LlmRuntimeStatus } from '../src/shared/types.js';
import { hasValidGeminiApiKey } from './geminiClient.js';

let cachedOllamaCheck: { checkedAt: number; reachable: boolean } | null = null;

export async function getLlmRuntimeStatus(): Promise<LlmRuntimeStatus> {
  const ollamaUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(
    /\/$/,
    ''
  );
  const ollamaModel = process.env.OLLAMA_MODEL || 'qwen3:8b';
  const forcedProvider = (process.env.LLM_PROVIDER || 'auto').toLowerCase();

  if (forcedProvider === 'deterministic' || forcedProvider === 'fallback') {
    return {
      activeProvider: 'deterministic_demo_fallback',
      configuredModel: 'Deterministic Rule Planner (Non-LLM Fallback)',
      ollamaReachable: false,
      ollamaUrl,
      isFallbackMode: true,
    };
  }

  if (forcedProvider === 'gemini' && hasValidGeminiApiKey()) {
    return {
      activeProvider: 'gemini_cloud',
      configuredModel: 'gemini-3.1-flash-lite',
      ollamaReachable: false,
      ollamaUrl,
      isFallbackMode: false,
    };
  }

  const now = Date.now();
  if (!cachedOllamaCheck || now - cachedOllamaCheck.checkedAt > 20_000) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 900);
      const res = await fetch(`${ollamaUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);
      cachedOllamaCheck = { checkedAt: now, reachable: res.ok };
    } catch {
      cachedOllamaCheck = { checkedAt: now, reachable: false };
    }
  }

  if (cachedOllamaCheck.reachable) {
    return {
      activeProvider: 'ollama_qwen3',
      configuredModel: ollamaModel,
      ollamaReachable: true,
      ollamaUrl,
      isFallbackMode: false,
    };
  }

  if (hasValidGeminiApiKey()) {
    return {
      activeProvider: 'gemini_cloud',
      configuredModel: 'gemini-3.1-flash-lite',
      ollamaReachable: false,
      ollamaUrl,
      isFallbackMode: false,
    };
  }

  return {
    activeProvider: 'deterministic_demo_fallback',
    configuredModel: 'Deterministic Rule Planner (Non-LLM Fallback)',
    ollamaReachable: false,
    ollamaUrl,
    isFallbackMode: true,
  };
}

export interface OllamaToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export async function callOllamaChatWithTools(params: {
  ollamaUrl: string;
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: Array<{
      function: { name: string; arguments: Record<string, unknown> };
    }>;
  }>;
  tools: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
}): Promise<{ text: string; toolCalls: OllamaToolCall[] }> {
  const res = await fetch(`${params.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: params.model,
      stream: false,
      messages: params.messages,
      tools: params.tools,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama (${params.model}) error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    message?: {
      content?: string;
      tool_calls?: Array<{
        function?: { name?: string; arguments?: Record<string, unknown> };
      }>;
    };
  };

  const rawCalls = data.message?.tool_calls ?? [];
  const toolCalls: OllamaToolCall[] = rawCalls
    .filter((c) => c.function?.name)
    .map((c, idx) => ({
      id: `ollama-call-${Date.now()}-${idx}`,
      name: String(c.function!.name),
      args: (c.function!.arguments ?? {}) as Record<string, unknown>,
    }));

  return {
    text: (data.message?.content ?? '').trim(),
    toolCalls,
  };
}
