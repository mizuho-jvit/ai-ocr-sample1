import {
  executeOperation,
  type OperationTrace,
} from "../observability/operation-trace";
import { ApiErrorException } from "../types";

/** AI-5: Geminiの最大出力トークン数。 */
const MAX_OUTPUT_TOKENS = 4_000;

export interface GeminiClientOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly aiGatewayAccountId: string;
  readonly aiGatewayId: string;
  readonly requestFetch?: typeof fetch;
}

export interface GeminiInlineImage {
  readonly mimeType: string;
  readonly base64: string;
}

export interface GeminiStructuredRequest {
  readonly systemInstruction: string;
  readonly userText?: string;
  readonly image?: GeminiInlineImage;
  readonly responseSchema: Record<string, unknown>;
  readonly trace?: OperationTrace;
}

export interface GeminiClient {
  generateStructured(request: GeminiStructuredRequest): Promise<unknown>;
}

function endpointUrl(options: GeminiClientOptions): string {
  return `https://gateway.ai.cloudflare.com/v1/${options.aiGatewayAccountId}/${options.aiGatewayId}/google-ai-studio/v1/models/${options.model}:generateContent`;
}

function toContentParts(
  request: GeminiStructuredRequest,
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  if (request.userText) {
    parts.push({ text: request.userText });
  }
  if (request.image) {
    parts.push({
      inlineData: {
        data: request.image.base64,
        mimeType: request.image.mimeType,
      },
    });
  }
  return parts;
}

function extractResponseText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const candidates = (payload as { candidates?: unknown }).candidates;
  const first = Array.isArray(candidates) ? candidates[0] : undefined;
  if (typeof first !== "object" || first === null) {
    return null;
  }
  const content = (first as { content?: unknown }).content;
  if (typeof content !== "object" || content === null) {
    return null;
  }
  const parts = (content as { parts?: unknown }).parts;
  const firstPart = Array.isArray(parts) ? parts[0] : undefined;
  if (typeof firstPart !== "object" || firstPart === null) {
    return null;
  }
  const text = (firstPart as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}

function aiUnavailable(): ApiErrorException {
  return new ApiErrorException("AI_UNAVAILABLE");
}

/**
 * 🔵 Intent: Gemini呼び出しはすべてCloudflare AI Gateway経由にする(AI-1)。
 * BYOK構成のGoogle AI Studioプロバイダへプロキシするため、Workers AIバインディングは使わない。
 * 🔵 Intent: `cf-aig-collect-log-payload: false` を既定値に頼らず明示付与し、
 * 帳票の元画像を含む本文がAI Gatewayへ保存されないようにする(AI-7a・NF-2-42)。
 */
export function createGeminiClient(options: GeminiClientOptions): GeminiClient {
  const requestFetch = options.requestFetch ?? fetch;

  return Object.freeze({
    async generateStructured(
      request: GeminiStructuredRequest,
    ): Promise<unknown> {
      return executeOperation(
        request.trace,
        {
          component: "ai",
          completedStage: "ai.completed",
          errorType: "AI_UNAVAILABLE",
          operation: "gemini.generateStructured",
          startedStage: "ai.executing",
        },
        async () => {
          let response: Response;
          try {
            response = await requestFetch(endpointUrl(options), {
              body: JSON.stringify({
                contents: [{ parts: toContentParts(request), role: "user" }],
                generationConfig: {
                  maxOutputTokens: MAX_OUTPUT_TOKENS,
                  responseMimeType: "application/json",
                  responseSchema: request.responseSchema,
                },
                systemInstruction: {
                  parts: [{ text: request.systemInstruction }],
                },
              }),
              headers: {
                "cf-aig-collect-log-payload": "false",
                "content-type": "application/json",
                "x-goog-api-key": options.apiKey,
              },
              method: "POST",
            });
          } catch {
            throw aiUnavailable();
          }

          if (!response.ok) {
            throw aiUnavailable();
          }

          const payload = await response.json().catch(() => null);
          const text = extractResponseText(payload);
          if (text === null) {
            throw aiUnavailable();
          }

          try {
            return JSON.parse(text);
          } catch {
            throw aiUnavailable();
          }
        },
      );
    },
  } satisfies GeminiClient);
}
