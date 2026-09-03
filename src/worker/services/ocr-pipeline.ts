import type { OperationTrace } from "../observability/operation-trace";
import {
  ApiErrorException,
  type ExtractedApplication,
  type ExtractedField,
  type OcrPipeline,
  type OcrPipelineMode,
  type PreparedImage,
} from "../types";
import {
  OCR_EXTRACT_RESPONSE_SCHEMA,
  OCR_EXTRACT_SYSTEM_INSTRUCTION,
} from "./ai-prompts";
import { createGeminiClient } from "./gemini-client";

export interface OcrPipelineConfig {
  readonly ocrPipelineMode: OcrPipelineMode;
  readonly geminiModel: string;
  readonly aiGatewayAccountId: string;
  readonly aiGatewayId: string;
}

export interface OcrPipelineOptions {
  readonly config: OcrPipelineConfig;
  readonly apiKey: string;
  readonly requestFetch?: typeof fetch;
  readonly trace?: OperationTrace;
}

function aiUnavailable(): ApiErrorException {
  return new ApiErrorException("AI_UNAVAILABLE");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 🔵 Intent: F-2-6の確信度範囲(0〜1)とF-2-5の空欄許容(valueは空文字列を許す)を検証する。
 * Structured Outputsで型は保証されても、AI出力の意味的な妥当性まではスキーマが保証しないため
 * 呼び出し側で検証し、不正な出力は再試行可能なAI_UNAVAILABLEとして扱う(AI-7b)。
 */
function validateField(raw: unknown): ExtractedField {
  if (!isRecord(raw)) {
    throw aiUnavailable();
  }
  const { confidence, label, value } = raw;
  if (typeof label !== "string" || label.trim().length === 0) {
    throw aiUnavailable();
  }
  if (typeof value !== "string") {
    throw aiUnavailable();
  }
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) {
    throw aiUnavailable();
  }
  return { confidence, label, value };
}

function validateExtractedApplication(raw: unknown): ExtractedApplication {
  if (!isRecord(raw)) {
    throw aiUnavailable();
  }
  const { docType, fields } = raw;
  if (typeof docType !== "string" || docType.trim().length === 0) {
    throw aiUnavailable();
  }
  if (!Array.isArray(fields) || fields.length === 0) {
    throw aiUnavailable();
  }
  return { docType, fields: fields.map(validateField) };
}

function createGeminiPipeline(options: OcrPipelineOptions): OcrPipeline {
  const client = createGeminiClient({
    aiGatewayAccountId: options.config.aiGatewayAccountId,
    aiGatewayId: options.config.aiGatewayId,
    apiKey: options.apiKey,
    model: options.config.geminiModel,
    requestFetch: options.requestFetch,
  });

  return Object.freeze({
    async extract(image: PreparedImage): Promise<ExtractedApplication> {
      const raw = await client.generateStructured({
        image: { base64: image.base64, mimeType: image.mimeType },
        responseSchema: OCR_EXTRACT_RESPONSE_SCHEMA,
        systemInstruction: OCR_EXTRACT_SYSTEM_INSTRUCTION,
        trace: options.trace,
      });
      return validateExtractedApplication(raw);
    },
  } satisfies OcrPipeline);
}

/**
 * 🔵 Intent: NF-4-5・AI-3・AI-8bに従い、OCR_PIPELINE_MODEに応じたPipeline実装を選択する。
 * `document-ai-gemini` はTask 018で実装するため、このタスクでは未対応として拒否する
 * (起動時にモードを検証し対応するPipelineを生成する、というAI-8bの構成要素をここで満たす)。
 */
export function createOcrPipeline(options: OcrPipelineOptions): OcrPipeline {
  switch (options.config.ocrPipelineMode) {
    case "gemini":
      return createGeminiPipeline(options);
    default:
      throw new Error(
        `OCR pipeline mode "${options.config.ocrPipelineMode}" is not implemented yet`,
      );
  }
}
