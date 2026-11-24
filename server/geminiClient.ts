import {
  GenerateContentConfig,
  GenerateContentResponse,
  GoogleGenAI,
  ThinkingLevel,
  ContentListUnion,
} from '@google/genai';

let cachedClient: GoogleGenAI | null = null;

export function hasValidGeminiApiKey(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim().length > 10 && key !== 'MY_GEMINI_API_KEY');
}

export function getGeminiClient(): GoogleGenAI {
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

const CLOUD_MODEL_CASCADE = [
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
  'gemini-flash-latest',
] as const;

/**
 * Calls Gemini on the server using a resilient latency-optimized cascade:
 * 1. Tries `gemini-3.1-flash-lite` first (~600ms-1.2s tool calling & structured JSON)
 * 2. Automatically falls back to `gemini-3.8-flash` and `gemini-flash-latest` if a model
 *    experiences transient 503 high-demand spikes or rate-limiting.
 */
export async function generateGeminiWithFallback(params: {
  contents: ContentListUnion;
  config?: GenerateContentConfig;
  perAttemptTimeoutMs?: number;
}): Promise<{ response: GenerateContentResponse; modelUsed: string }> {
  const ai = getGeminiClient();
  const timeoutMs = params.perAttemptTimeoutMs ?? 15_000;
  let lastError: unknown = null;

  for (const model of CLOUD_MODEL_CASCADE) {
    try {
      const effectiveConfig: GenerateContentConfig = {
        ...(params.config ?? {}),
      };
      if (model === 'gemini-3.8-flash' && !effectiveConfig.thinkingConfig) {
        effectiveConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
      }

      const response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: params.contents,
          config: effectiveConfig,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Model ${model} timed out after ${timeoutMs}ms`)),
            timeoutMs
          )
        ),
      ]);

      return { response, modelUsed: model };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('high demand') ||
        msg.includes('429') ||
        msg.includes('timed out') ||
        msg.includes('fetch failed');
      if (!isRetryable) {
        throw err;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('All Gemini models temporarily unavailable due to high demand.');
}
