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
  type ExtractedApplication,
  type OcrPipeline,
  toApplicationId,
  toImageKey,
  toStaffUserId,
  toTenantId,
  type WorkerEnv,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-ocr-images");
const STAFF_ID = toStaffUserId("ocr-images-staff");
const PASSWORD = "correct horse battery staple";
const TEST_ITERATIONS = 1_000;
const BASIC_PASSWORD = "test-password-at-least-20-characters";
const BASIC_AUTHORIZATION = `Basic ${btoa(`test-user:${BASIC_PASSWORD}`)}`;

const EXTRACTED: ExtractedApplication = {
  docType: "利用者登録申請書",
  fields: [{ confidence: 0.98, label: "氏名", value: "山田太郎" }],
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

async function insertApplication(
  id: string,
  imageKey: string | null,
): Promise<void> {
  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .applications.insert({
      appStatus: "received",
      createdAt: new Date().toISOString(),
      createdById: STAFF_ID,
      docType: "利用者登録申請書",
      editedCount: 0,
      fieldsJson: "[]",
      id: toApplicationId(id),
      imageKey: imageKey === null ? null : toImageKey(imageKey),
      latestCheckRunId: null,
      memberId: null,
      processingSec: 1.2,
      updatedAt: new Date().toISOString(),
      updatedById: null,
    });
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

describe("GET /api/images/:applicationId (NF-2-14・NF-5-19)", () => {
  it("returns a signed url for an application with an image", async () => {
    const cookie = await loginCookie();
    await insertApplication(
      "app-with-image",
      `${TENANT_ID}/app-with-image.jpg`,
    );
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
      request("/api/images/app-with-image", { cookie }),
      environment,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      expiresAt: "2026-09-01T00:15:00.000Z",
      url: "https://signed.example.test/tenant/app.jpg",
    });
    expect(imageStorage.createSignedUrl).toHaveBeenCalledWith(
      TENANT_ID,
      `${TENANT_ID}/app-with-image.jpg`,
      900,
      expect.anything(),
    );
  });

  it("returns 404 when the application has no image", async () => {
    const cookie = await loginCookie();
    await insertApplication("app-with-image", null);
    const environment = createTestEnv();

    const response = await createApp(
      environment,
      undefined,
      undefined,
      undefined,
      fakeOcrPipeline(),
      fakeImageStorage(),
    ).fetch(request("/api/images/app-with-image", { cookie }), environment);

    expect(response.status).toBe(404);
  });

  it("returns 404 for an unknown application id", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();

    const response = await createApp(
      environment,
      undefined,
      undefined,
      undefined,
      fakeOcrPipeline(),
      fakeImageStorage(),
    ).fetch(request("/api/images/does-not-exist", { cookie }), environment);

    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/applications/:id/image (NF-3-2)", () => {
  it("deletes the R2 object and clears imageKey", async () => {
    const cookie = await loginCookie();
    await insertApplication("app-to-clear", `${TENANT_ID}/app-to-clear.jpg`);
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
      request("/api/applications/app-to-clear/image", {
        cookie,
        method: "DELETE",
      }),
      environment,
    );

    expect(response.status).toBe(204);
    expect(imageStorage.delete).toHaveBeenCalledWith(
      `${TENANT_ID}/app-to-clear.jpg`,
      expect.anything(),
    );

    const stored = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .applications.findOne(
        whereFieldEquals("applications", "id", toApplicationId("app-to-clear")),
      );
    expect(stored?.imageKey).toBeNull();
  });

  it("returns 404 for an unknown application id", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();

    const response = await createApp(
      environment,
      undefined,
      undefined,
      undefined,
      fakeOcrPipeline(),
      fakeImageStorage(),
    ).fetch(
      request("/api/applications/does-not-exist/image", {
        cookie,
        method: "DELETE",
      }),
      environment,
    );

    expect(response.status).toBe(404);
  });
});
