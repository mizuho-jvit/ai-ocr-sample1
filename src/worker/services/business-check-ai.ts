import type { OperationTrace } from "../observability/operation-trace";
import {
  ApiErrorException,
  type ConsistencyIssue,
  type Deficiency,
  type Severity,
  type Triage,
} from "../types";
import {
  BUSINESS_CHECK_RESPONSE_SCHEMA,
  BUSINESS_CHECK_SYSTEM_INSTRUCTION,
} from "./ai-prompts";
import type { GeminiClient } from "./gemini-client";

/** F-3-5: 差戻し文面は敬体・200字以内。 */
const LETTER_DRAFT_MAX_LENGTH = 200;

const TRIAGE_VALUES: ReadonlySet<Triage> = new Set([
  "approval_candidate",
  "needs_review",
  "return_candidate",
]);
const SEVERITY_VALUES: ReadonlySet<Severity> = new Set(["error", "warning"]);

export interface BusinessCheckAiResult {
  triage: Triage;
  triageReason: string;
  consistency: ConsistencyIssue[];
  deficiencies: Deficiency[];
  letterDraft: string | null;
}

function aiUnavailable(): ApiErrorException {
  return new ApiErrorException("AI_UNAVAILABLE");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateConsistencyIssue(raw: unknown): ConsistencyIssue {
  if (!isRecord(raw)) {
    throw aiUnavailable();
  }
  const { labels, severity, message } = raw;
  if (
    !Array.isArray(labels) ||
    labels.some((label) => typeof label !== "string")
  ) {
    throw aiUnavailable();
  }
  if (
    typeof severity !== "string" ||
    !SEVERITY_VALUES.has(severity as Severity)
  ) {
    throw aiUnavailable();
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    throw aiUnavailable();
  }
  return {
    labels: labels as string[],
    message,
    severity: severity as Severity,
  };
}

function validateDeficiency(raw: unknown): Deficiency {
  if (!isRecord(raw)) {
    throw aiUnavailable();
  }
  const { label, message } = raw;
  if (typeof label !== "string" || label.trim().length === 0) {
    throw aiUnavailable();
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    throw aiUnavailable();
  }
  return { label, message };
}

/**
 * 🟡 Intent: letterDraftの200字上限（F-3-5）はAIへの指示だけに委ねず、
 * ocr-pipeline.tsのconfidence範囲チェックと同じ方針で出力側でも検証する。
 * 🔵 Intent: コードレビュー指摘#4。「不備・矛盾がある場合のみletterDraftを生成する」
 * （ai-prompts.tsのBUSINESS_CHECK_SYSTEM_INSTRUCTION）は、
 * consistency.length + deficiencies.length と letterDraftのnull/非nullが
 * 決定的に一致するはずの制約であり、判定の余地が無いため検証できる。
 * 不整合はAIが指示に従っていない異常な出力とみなし、他の意味検証（triage列挙値・
 * 200字上限等）と同じくAI_UNAVAILABLEとして拒否する（自動補正はしない。
 * AIの誤りを握りつぶさず、DB書き込み前に検知して再試行を促す）。
 */
function validateBusinessCheckResult(raw: unknown): BusinessCheckAiResult {
  if (!isRecord(raw)) {
    throw aiUnavailable();
  }
  const { triage, triageReason, consistency, deficiencies, letterDraft } = raw;

  if (typeof triage !== "string" || !TRIAGE_VALUES.has(triage as Triage)) {
    throw aiUnavailable();
  }
  if (typeof triageReason !== "string" || triageReason.trim().length === 0) {
    throw aiUnavailable();
  }
  if (!Array.isArray(consistency) || !Array.isArray(deficiencies)) {
    throw aiUnavailable();
  }
  if (letterDraft !== null && typeof letterDraft !== "string") {
    throw aiUnavailable();
  }
  if (typeof letterDraft === "string") {
    if (letterDraft.trim().length === 0) {
      throw aiUnavailable();
    }
    if (letterDraft.length > LETTER_DRAFT_MAX_LENGTH) {
      throw aiUnavailable();
    }
  }
  const hasIssues = consistency.length + deficiencies.length > 0;
  if (hasIssues !== (letterDraft !== null)) {
    throw aiUnavailable();
  }

  return {
    consistency: consistency.map(validateConsistencyIssue),
    deficiencies: deficiencies.map(validateDeficiency),
    letterDraft,
    triage: triage as Triage,
    triageReason,
  };
}

export interface RunBusinessCheckAiInput {
  docType: string;
  fields: Array<{ label: string; value: string }>;
}

/**
 * 🔵 Intent: AI-4に従いPass②は画像を必要とせず、OcrPipelineとは独立したGemini呼び出しにする。
 * F-3（整合性・不備・トリアージ・差戻し文面）だけを対象とし、申請者自身のOCR抽出項目のみを
 * 送信する。名寄せ候補（既存会員の氏名・カナ・生年月日・電話番号）はここへ渡さない（決定#27）。
 */
export async function runBusinessCheckAi(
  client: GeminiClient,
  input: RunBusinessCheckAiInput,
  trace?: OperationTrace,
): Promise<BusinessCheckAiResult> {
  const raw = await client.generateStructured({
    responseSchema: BUSINESS_CHECK_RESPONSE_SCHEMA,
    systemInstruction: BUSINESS_CHECK_SYSTEM_INSTRUCTION,
    trace,
    userText: JSON.stringify({
      docType: input.docType,
      fields: input.fields,
    }),
  });
  return validateBusinessCheckResult(raw);
}
