import { describe, expect, it, vi } from "vitest";

import worker, { createApp, type WorkerEnv } from "../../src/worker/index";

const BASIC_AUTHORIZATION = `Basic ${btoa(
  "test-user:test-password-at-least-20-characters",
)}`;

function createTestEnv(): WorkerEnv {
  return {
    ALLOW_DATA_RESET: "true",
    ALLOW_WEAK_PASSWORD_HASH: "true",
    ASSETS: {
      fetch: vi.fn(() => new Response("asset response")),
    } as unknown as Fetcher,
    BASIC_AUTH_PASSWORD: "test-password-at-least-20-characters",
    BASIC_AUTH_USERNAME: "test-user",
    BUCKET: {} as R2Bucket,
    DB: {} as D1Database,
    GEMINI_API_KEY: "test-gemini-secret",
    GEMINI_MODEL: "gemini-3.1-flash-lite",
    MAX_CHECK_RUNS_PER_APPLICATION: "5",
    MAX_GEMINI_CALLS_PER_MONTH: "720",
    MAX_OCR_PAGES_PER_MONTH: "120",
    OCR_PIPELINE_MODE: "gemini",
    PBKDF2_ITERATIONS: "20000",
    R2_ACCOUNT_ID: "test-r2-account",
    R2_S3_ACCESS_KEY_ID: "test-r2-access-key",
    R2_S3_SECRET_ACCESS_KEY: "test-r2-secret-key",
    TENANT_ID: "test-tenant",
  };
}

describe("Worker entry point", () => {
  it("requires Basic authentication before returning an asset", async () => {
    const env = createTestEnv();
    const app = createApp(env);

    const response = await app.fetch(new Request("https://example.test/"), env);

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
  });

  it("delegates an authenticated request to the assets binding", async () => {
    const env = createTestEnv();
    const app = createApp(env);

    const response = await app.fetch(
      new Request("https://example.test/", {
        headers: { Authorization: BASIC_AUTHORIZATION },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("asset response");
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("returns and logs a safe error when startup validation fails", async () => {
    const env = createTestEnv();
    env.TENANT_ID = "";
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    const request = new Request("https://example.test/") as Parameters<
      typeof worker.fetch
    >[0];
    const response = await worker.fetch(request, env, {} as ExecutionContext);

    expect(response.status).toBe(500);
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL",
        message: "予期しないエラーが発生しました。",
      },
    });
    expect(logError).toHaveBeenCalledOnce();
    expect(JSON.stringify(logError.mock.calls[0]?.[0])).toContain(
      "CONFIG_INVALID",
    );
    expect(JSON.stringify(logError.mock.calls[0]?.[0])).not.toContain(
      "TENANT_ID",
    );
    logError.mockRestore();
  });

  it("logs an unexpected Hono error once without exposing its message", async () => {
    const env = createTestEnv();
    const secret = "asset-provider-super-secret";
    env.ASSETS.fetch = vi.fn(() => {
      throw new Error(secret);
    }) as unknown as Fetcher["fetch"];
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp(env);

    const response = await app.fetch(
      new Request("https://example.test/", {
        headers: { Authorization: BASIC_AUTHORIZATION },
      }),
      env,
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    expect(await response.text()).not.toContain(secret);
    expect(logError).toHaveBeenCalledOnce();
    expect(JSON.stringify(logError.mock.calls[0]?.[0])).not.toContain(secret);
    logError.mockRestore();
  });
});
