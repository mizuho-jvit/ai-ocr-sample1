import { describe, expect, it } from "vitest";
import {
  loadConfig,
  MAX_PBKDF2_ITERATIONS,
} from "../../../src/worker/config/load-config";
import type { WorkerEnv } from "../../../src/worker/types/env";

function createValidEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    ALLOW_DATA_RESET: "true",
    ALLOW_WEAK_PASSWORD_HASH: "true",
    ASSETS: {} as Fetcher,
    BASIC_AUTH_PASSWORD: "basic-password-at-least-20-characters",
    BASIC_AUTH_USERNAME: "basic-user",
    BUCKET: {} as R2Bucket,
    DB: {} as D1Database,
    GEMINI_API_KEY: "gemini-secret",
    GEMINI_MODEL: "gemini-3.1-flash-lite",
    MAX_CHECK_RUNS_PER_APPLICATION: "5",
    MAX_GEMINI_CALLS_PER_MONTH: "720",
    MAX_OCR_PAGES_PER_MONTH: "120",
    OCR_PIPELINE_MODE: "gemini",
    PBKDF2_ITERATIONS: "20000",
    R2_ACCOUNT_ID: "r2-account",
    R2_S3_ACCESS_KEY_ID: "r2-access-key",
    R2_S3_SECRET_ACCESS_KEY: "r2-secret-key",
    TENANT_ID: "tenant-demo",
    ...overrides,
  };
}

describe("loadConfig", () => {
  it.each([
    "TENANT_ID",
    "PBKDF2_ITERATIONS",
    "MAX_OCR_PAGES_PER_MONTH",
    "MAX_GEMINI_CALLS_PER_MONTH",
    "MAX_CHECK_RUNS_PER_APPLICATION",
    "BASIC_AUTH_USERNAME",
    "BASIC_AUTH_PASSWORD",
    "OCR_PIPELINE_MODE",
    "GEMINI_MODEL",
    "GEMINI_API_KEY",
    "R2_ACCOUNT_ID",
    "R2_S3_ACCESS_KEY_ID",
    "R2_S3_SECRET_ACCESS_KEY",
  ] as const)("rejects missing required setting %s", (settingName) => {
    expect(() =>
      loadConfig(createValidEnv({ [settingName]: "" })),
    ).toThrowError(settingName);
  });

  it("rejects a missing required setting without exposing another setting", () => {
    const env = createValidEnv({ TENANT_ID: "" });

    expect(() => loadConfig(env)).toThrowError("TENANT_ID");

    try {
      loadConfig(env);
    } catch (error) {
      expect(String(error)).not.toContain(env.GEMINI_API_KEY);
    }
  });

  it("rejects an unknown OCR pipeline mode", () => {
    const env = createValidEnv({ OCR_PIPELINE_MODE: "unknown" });

    expect(() => loadConfig(env)).toThrowError("OCR_PIPELINE_MODE");
  });

  it.each([
    "MAX_OCR_PAGES_PER_MONTH",
    "MAX_GEMINI_CALLS_PER_MONTH",
    "MAX_CHECK_RUNS_PER_APPLICATION",
  ] as const)("rejects non-positive and non-integer %s", (settingName) => {
    for (const invalidValue of ["0", "-1", "1.5", "not-a-number"]) {
      const env = createValidEnv({ [settingName]: invalidValue });

      expect(() => loadConfig(env)).toThrowError(settingName);
    }
  });

  it("requires production-strength PBKDF2 unless the demo override is explicit", () => {
    const env = createValidEnv({ ALLOW_WEAK_PASSWORD_HASH: undefined });

    expect(() => loadConfig(env)).toThrowError("PBKDF2_ITERATIONS");
    expect(() =>
      loadConfig({
        ...env,
        PBKDF2_ITERATIONS: "100000",
      }),
    ).not.toThrow();
  });

  it("rejects PBKDF2 iterations above the supported maximum", () => {
    // 上限を超える設定は、生成できても検証できないハッシュを作ってしまうため
    // 起動時に拒否する。services/auth.ts のパース側と同じ上限を共有している。
    expect(() =>
      loadConfig(
        createValidEnv({ PBKDF2_ITERATIONS: String(MAX_PBKDF2_ITERATIONS) }),
      ),
    ).not.toThrow();

    expect(() =>
      loadConfig(
        createValidEnv({
          PBKDF2_ITERATIONS: String(MAX_PBKDF2_ITERATIONS + 1),
        }),
      ),
    ).toThrowError("PBKDF2_ITERATIONS");
  });

  it("requires all Document AI settings only in document-ai-gemini mode", () => {
    const documentAiEnv = createValidEnv({
      DOCUMENT_AI_LOCATION: "asia-northeast1",
      DOCUMENT_AI_PROCESSOR_ID: "processor-id",
      GEMINI_API_KEY: "gemini-secret",
      GOOGLE_CLOUD_PROJECT_ID: "project-id",
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "service@example.test",
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "private-key",
      OCR_PIPELINE_MODE: "document-ai-gemini",
    });

    expect(() => loadConfig(documentAiEnv)).not.toThrow();
    expect(() =>
      loadConfig({ ...documentAiEnv, DOCUMENT_AI_PROCESSOR_ID: "" }),
    ).toThrowError("DOCUMENT_AI_PROCESSOR_ID");
    expect(() =>
      loadConfig(
        createValidEnv({
          GOOGLE_CLOUD_PROJECT_ID: "",
          OCR_PIPELINE_MODE: "gemini",
        }),
      ),
    ).not.toThrow();
  });

  it("keeps credentials out of the validated configuration", () => {
    const env = createValidEnv();

    const config = loadConfig(env);

    expect(config).toEqual({
      allowDataReset: true,
      geminiModel: "gemini-3.1-flash-lite",
      maxCheckRunsPerApplication: 5,
      maxGeminiCallsPerMonth: 720,
      maxOcrPagesPerMonth: 120,
      ocrPipelineMode: "gemini",
      pbkdf2Iterations: 20_000,
      tenantId: "tenant-demo",
    });
    expect(JSON.stringify(config)).not.toContain(env.GEMINI_API_KEY);
    expect(JSON.stringify(config)).not.toContain(env.R2_S3_SECRET_ACCESS_KEY);
  });
});
