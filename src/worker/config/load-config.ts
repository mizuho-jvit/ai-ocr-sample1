import {
  type AppConfig,
  type OcrPipelineMode,
  toTenantId,
  type WorkerEnv,
} from "../types";

const MINIMUM_PASSWORD_LENGTH = 20;
const MINIMUM_PRODUCTION_PBKDF2_ITERATIONS = 100_000;

/**
 * 反復回数の上限。保存済みハッシュのパース側（`services/auth.ts`）と同じ値を使い、
 * 「生成できるが検証できないハッシュ」を作らないようにする。
 * NF-2-8 の移行先（600,000回）に対して余裕があり、NF-2-7 の10ms制約からも
 * これを超える設定値は現実的でない。改ざんされたDB値でCPU時間を消尽させない上限も兼ねる。
 */
export const MAX_PBKDF2_ITERATIONS = 1_000_000;
const PIPELINE_MODES = new Set<OcrPipelineMode>([
  "gemini",
  "document-ai-gemini",
]);
const DOCUMENT_AI_SETTINGS = [
  "GOOGLE_CLOUD_PROJECT_ID",
  "DOCUMENT_AI_LOCATION",
  "DOCUMENT_AI_PROCESSOR_ID",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
] as const;

export class ConfigValidationError extends Error {
  constructor(settingName: string, reason = "is missing or invalid") {
    super(`Required configuration ${settingName} ${reason}.`);
    this.name = "ConfigValidationError";
  }
}

function requireSetting(env: WorkerEnv, settingName: keyof WorkerEnv): string {
  const value = env[settingName];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigValidationError(settingName);
  }
  return value;
}

function requirePositiveInteger(
  env: WorkerEnv,
  settingName: keyof WorkerEnv,
): number {
  const rawValue = requireSetting(env, settingName);
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ConfigValidationError(settingName, "must be a positive integer");
  }
  return value;
}

function loadPipelineMode(env: WorkerEnv): OcrPipelineMode {
  const mode = requireSetting(env, "OCR_PIPELINE_MODE");
  if (!PIPELINE_MODES.has(mode as OcrPipelineMode)) {
    throw new ConfigValidationError(
      "OCR_PIPELINE_MODE",
      "must be a supported mode",
    );
  }
  return mode as OcrPipelineMode;
}

function validateDocumentAiSettings(
  env: WorkerEnv,
  mode: OcrPipelineMode,
): void {
  if (mode !== "document-ai-gemini") {
    return;
  }
  for (const settingName of DOCUMENT_AI_SETTINGS) {
    requireSetting(env, settingName);
  }
}

function validateSecrets(env: WorkerEnv): void {
  requireSetting(env, "BASIC_AUTH_USERNAME");
  const basicAuthPassword = requireSetting(env, "BASIC_AUTH_PASSWORD");
  if (basicAuthPassword.length < MINIMUM_PASSWORD_LENGTH) {
    throw new ConfigValidationError(
      "BASIC_AUTH_PASSWORD",
      `must contain at least ${MINIMUM_PASSWORD_LENGTH} characters`,
    );
  }
  requireSetting(env, "GEMINI_API_KEY");
  requireSetting(env, "R2_S3_ACCESS_KEY_ID");
  requireSetting(env, "R2_S3_SECRET_ACCESS_KEY");
}

/**
 * 🔵 Intent: NF-2-46。AI GatewayのエンドポイントURLを組み立てるアカウントIDと
 * ゲートウェイ名は`R2_ACCOUNT_ID`と用途が異なるため独立して検証する(判断記録 #20)。
 */
function validateAiGatewaySettings(env: WorkerEnv): void {
  requireSetting(env, "AI_GATEWAY_ACCOUNT_ID");
  requireSetting(env, "AI_GATEWAY_ID");
}

function validatePbkdf2Iterations(env: WorkerEnv, iterations: number): void {
  if (
    iterations < MINIMUM_PRODUCTION_PBKDF2_ITERATIONS &&
    env.ALLOW_WEAK_PASSWORD_HASH !== "true"
  ) {
    throw new ConfigValidationError(
      "PBKDF2_ITERATIONS",
      `must be at least ${MINIMUM_PRODUCTION_PBKDF2_ITERATIONS}`,
    );
  }
  // 上限を超える設定は、検証できないハッシュを生成してしまうため起動を失敗させる。
  if (iterations > MAX_PBKDF2_ITERATIONS) {
    throw new ConfigValidationError(
      "PBKDF2_ITERATIONS",
      `must be at most ${MAX_PBKDF2_ITERATIONS}`,
    );
  }
}

/**
 * 🔵 Intent: 必須設定を一元検証し、秘密値を検証済み設定へコピーしない。
 * 未設定や不正値を無制限動作として扱わず、Workerをfail closedにする。
 */
export function loadConfig(env: WorkerEnv): AppConfig {
  const ocrPipelineMode = loadPipelineMode(env);
  const pbkdf2Iterations = requirePositiveInteger(env, "PBKDF2_ITERATIONS");

  validatePbkdf2Iterations(env, pbkdf2Iterations);
  validateSecrets(env);
  validateDocumentAiSettings(env, ocrPipelineMode);
  validateAiGatewaySettings(env);
  requireSetting(env, "R2_ACCOUNT_ID");

  return {
    aiGatewayAccountId: requireSetting(env, "AI_GATEWAY_ACCOUNT_ID"),
    aiGatewayId: requireSetting(env, "AI_GATEWAY_ID"),
    allowDataReset: env.ALLOW_DATA_RESET === "true",
    geminiModel: requireSetting(env, "GEMINI_MODEL"),
    maxCheckRunsPerApplication: requirePositiveInteger(
      env,
      "MAX_CHECK_RUNS_PER_APPLICATION",
    ),
    maxGeminiCallsPerMonth: requirePositiveInteger(
      env,
      "MAX_GEMINI_CALLS_PER_MONTH",
    ),
    maxOcrPagesPerMonth: requirePositiveInteger(env, "MAX_OCR_PAGES_PER_MONTH"),
    ocrPipelineMode,
    pbkdf2Iterations,
    tenantId: toTenantId(requireSetting(env, "TENANT_ID")),
  };
}
