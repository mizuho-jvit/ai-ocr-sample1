import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTenantRepository,
  whereFieldEquals,
} from "../../../src/worker/db/repositories";
import { createApp } from "../../../src/worker/index";
import { hashPassword } from "../../../src/worker/services/auth";
import type { ImageStorage } from "../../../src/worker/services/image-storage";
import {
  ApiErrorException,
  type ExtractedApplication,
  type OcrPipeline,
  toApplicationId,
  toImageKey,
  toStaffUserId,
  toTenantId,
  type WorkerEnv,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-ocr-extract");
const STAFF_ID = toStaffUserId("ocr-extract-staff");
const PASSWORD = "correct horse battery staple";
const TEST_ITERATIONS = 1_000;
const BASIC_PASSWORD = "test-password-at-least-20-characters";
const BASIC_AUTHORIZATION = `Basic ${btoa(`test-user:${BASIC_PASSWORD}`)}`;

const EXTRACTED: ExtractedApplication = {
  docType: "利用者登録申請書",
  fields: [
    { confidence: 0.98, label: "氏名", value: "山田太郎" },
    { confidence: 0.4, label: "電話番号", value: "" },
  ],
};

const VALID_IMAGE = {
  base64: "ZmFrZS1pbWFnZS1ieXRlcw==",
  mimeType: "image/jpeg",
};

const testEnvironment = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
};

function createTestEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    AI_GATEWAY_ACCOUNT_ID: "test-ai-gateway-account",
    AI_GATEWAY_ID: "test-ai-gateway-id",
    ALLOW_DATA_RESET: "true",
    ALLOW_WEAK_PASSWORD_HASH: "true",
    ASSETS: {
      fetch: vi.fn(() => new Response("asset response")),
    } as unknown as Fetcher,
    BASIC_AUTH_PASSWORD: BASIC_PASSWORD,
    BASIC_AUTH_USERNAME: "test-user",
    BUCKET: {} as R2Bucket,
    DB: env.DB,
    GEMINI_API_KEY: "test-gemini-secret",
    GEMINI_MODEL: "gemini-3.1-flash-lite",
    MAX_CHECK_RUNS_PER_APPLICATION: "5",
    MAX_GEMINI_CALLS_PER_MONTH: "720",
    MAX_OCR_PAGES_PER_MONTH: "120",
    OCR_PIPELINE_MODE: "gemini",
    PBKDF2_ITERATIONS: String(TEST_ITERATIONS),
    R2_ACCOUNT_ID: "test-r2-account",
    R2_S3_ACCESS_KEY_ID: "test-r2-access-key",
    R2_S3_SECRET_ACCESS_KEY: "test-r2-secret-key",
    TENANT_ID,
    ...overrides,
  };
}

function fakeOcrPipeline(
  extract: OcrPipeline["extract"] = vi.fn(async () => EXTRACTED),
): OcrPipeline {
  return { extract };
}

function fakeImageStorage(overrides: Partial<ImageStorage> = {}): ImageStorage {
  return {
    createSignedUrl: vi.fn(async () => ({
      expiresAt: "2026-09-01T00:15:00.000Z",
      url: "https://signed.example.test/tenant/app.jpg",
    })),
    delete: vi.fn(async () => undefined),
    put: vi.fn(async (tenantId, applicationId) =>
      toImageKey(`${tenantId}/${applicationId}.jpg`),
    ),
    ...overrides,
  };
}

function request(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Request {
  const { cookie, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Authorization", BASIC_AUTHORIZATION);
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  return new Request(`https://example.test${path}`, { ...rest, headers });
}

function jsonRequest(path: string, body: unknown, cookie?: string): Request {
  return request(path, {
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(cookie ? { cookie } : {}),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

function sessionCookieFrom(response: Response): string {
  return (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
}

async function loginCookie(): Promise<string> {
  const response = await createApp(createTestEnv()).fetch(
    jsonRequest("/api/auth/login", {
      email: "staff@example.test",
      password: PASSWORD,
    }),
    createTestEnv(),
  );
  return sessionCookieFrom(response);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnvironment.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO tenants (id, code, name) VALUES (?, ?, ?)",
  )
    .bind(TENANT_ID, TENANT_ID, TENANT_ID)
    .run();
  await env.DB.prepare("DELETE FROM sessions").run();
  await env.DB.prepare("DELETE FROM applications").run();
  await env.DB.prepare("DELETE FROM staff_users").run();
  await env.DB.prepare("DELETE FROM usage_counter").run();

  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .staffUsers.insert({
      createdById: null,
      email: "staff@example.test",
      failedLoginCount: 0,
      id: STAFF_ID,
      isActive: true,
      lockedUntil: null,
      name: "窓口 花子",
      passwordHash: await hashPassword(PASSWORD, TEST_ITERATIONS),
      role: "staff",
      updatedById: null,
    });
});

describe("POST /api/ocr/extract (F-2-8・F-2-9・NF-2-39)", () => {
  it("creates a received application, stores the image, and returns updated usage", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const imageStorage = fakeImageStorage();
    const app = createApp(
      environment,
      undefined,
      undefined,
      undefined,
      fakeOcrPipeline(),
      imageStorage,
    );

    const response = await app.fetch(
      jsonRequest("/api/ocr/extract", { image: VALID_IMAGE }, cookie),
      environment,
    );

    expect(response.status).toBe(200);
    const body = await response.json<{
      application: Record<string, unknown>;
      usage: Record<string, unknown>;
    }>();
    expect(body.application).toMatchObject({
      appStatus: "received",
      docType: "利用者登録申請書",
      editedCount: 0,
      fields: [
        { confidence: 0.98, edited: false, label: "氏名", value: "山田太郎" },
        { confidence: 0.4, edited: false, label: "電話番号", value: "" },
      ],
      hasImage: true,
      latestCheckRun: null,
      matchCandidates: [],
      member: null,
      statusHistory: [],
      triage: null,
      updatedBy: null,
    });
    // NF-2-17: 読取(Pass①)はocrPagesとgeminiCallsの両方を合算加算する。
    expect(body.usage).toMatchObject({
      geminiCalls: 1,
      ocrPages: 1,
      ocrPagesRemaining: 119,
    });
    expect(imageStorage.put).toHaveBeenCalledOnce();

    const stored = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .applications.findOne(
        whereFieldEquals(
          "applications",
          "id",
          toApplicationId(body.application.id as string),
        ),
      );
    expect(stored).toMatchObject({
      appStatus: "received",
      docType: "利用者登録申請書",
    });
  });

  it("rejects an unsupported image format with 422 and consumes no usage", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const ocrPipeline = fakeOcrPipeline();
    const imageStorage = fakeImageStorage();
    const app = createApp(
      environment,
      undefined,
      undefined,
      undefined,
      ocrPipeline,
      imageStorage,
    );

    const response = await app.fetch(
      jsonRequest(
        "/api/ocr/extract",
        { image: { base64: "abc", mimeType: "image/gif" } },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(ocrPipeline.extract).not.toHaveBeenCalled();
    expect(imageStorage.put).not.toHaveBeenCalled();

    const usageResponse = await app.fetch(
      request("/api/usage", { cookie }),
      environment,
    );
    await expect(usageResponse.json()).resolves.toMatchObject({ ocrPages: 0 });
  });

  it("returns 429 without calling the pipeline once the monthly OCR page limit is reached (NF-2-18)", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv({ MAX_OCR_PAGES_PER_MONTH: "1" });
    const ocrPipeline = fakeOcrPipeline();

    const first = await createApp(
      environment,
      undefined,
      undefined,
      undefined,
      ocrPipeline,
      fakeImageStorage(),
    ).fetch(
      jsonRequest("/api/ocr/extract", { image: VALID_IMAGE }, cookie),
      environment,
    );
    expect(first.status).toBe(200);

    const secondOcrPipeline = fakeOcrPipeline();
    const secondImageStorage = fakeImageStorage();
    const second = await createApp(
      environment,
      undefined,
      undefined,
      undefined,
      secondOcrPipeline,
      secondImageStorage,
    ).fetch(
      jsonRequest("/api/ocr/extract", { image: VALID_IMAGE }, cookie),
      environment,
    );

    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({
      error: { code: "USAGE_LIMIT_EXCEEDED" },
    });
    expect(secondOcrPipeline.extract).not.toHaveBeenCalled();
    expect(secondImageStorage.put).not.toHaveBeenCalled();

    const applications = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .applications.all();
    expect(applications).toHaveLength(1);
  });

  it("returns 429 without calling the pipeline once the monthly Gemini call limit is reached (NF-2-17・NF-2-34)", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv({ MAX_GEMINI_CALLS_PER_MONTH: "1" });
    const ocrPipeline = fakeOcrPipeline();

    const first = await createApp(
      environment,
      undefined,
      undefined,
      undefined,
      ocrPipeline,
      fakeImageStorage(),
    ).fetch(
      jsonRequest("/api/ocr/extract", { image: VALID_IMAGE }, cookie),
      environment,
    );
    expect(first.status).toBe(200);

    const secondOcrPipeline = fakeOcrPipeline();
    const secondImageStorage = fakeImageStorage();
    const second = await createApp(
      environment,
      undefined,
      undefined,
      undefined,
      secondOcrPipeline,
      secondImageStorage,
    ).fetch(
      jsonRequest("/api/ocr/extract", { image: VALID_IMAGE }, cookie),
      environment,
    );

    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({
      error: { code: "USAGE_LIMIT_EXCEEDED" },
    });
    expect(secondOcrPipeline.extract).not.toHaveBeenCalled();
    expect(secondImageStorage.put).not.toHaveBeenCalled();

    const applications = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .applications.all();
    expect(applications).toHaveLength(1);

    const usageResponse = await createApp(
      environment,
      undefined,
      undefined,
      undefined,
      fakeOcrPipeline(),
      fakeImageStorage(),
    ).fetch(request("/api/usage", { cookie }), environment);
    // NF-2-17: geminiCallsは上限到達で1のまま止まる。ocrPagesは2件目のconsumeOcr()自体は
    // 成功しており(geminiCallsで初めて上限に達した)、NF-2-39の限界どおり枠は戻らないため2。
    await expect(usageResponse.json()).resolves.toMatchObject({
      geminiCalls: 1,
      ocrPages: 2,
    });
  });

  it("returns 503 AI_UNAVAILABLE without creating an application when the pipeline fails", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const imageStorage = fakeImageStorage();
    const app = createApp(
      environment,
      undefined,
      undefined,
      undefined,
      fakeOcrPipeline(
        vi.fn(async () => {
          throw new ApiErrorException("AI_UNAVAILABLE");
        }),
      ),
      imageStorage,
    );

    const response = await app.fetch(
      jsonRequest("/api/ocr/extract", { image: VALID_IMAGE }, cookie),
      environment,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AI_UNAVAILABLE", retryable: true },
    });
    expect(imageStorage.put).not.toHaveBeenCalled();

    const applications = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .applications.all();
    expect(applications).toHaveLength(0);

    // NF-2-39: 加算はAI呼び出しの前であり、失敗しても枠は戻らない。
    const usageResponse = await app.fetch(
      request("/api/usage", { cookie }),
      environment,
    );
    await expect(usageResponse.json()).resolves.toMatchObject({
      geminiCalls: 1,
      ocrPages: 1,
    });
  });
});
