import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantRepository } from "../../../src/worker/db/repositories";
import { createApp } from "../../../src/worker/index";
import { hashPassword } from "../../../src/worker/services/auth";
import type { DemoResetService } from "../../../src/worker/services/demo-reset";
import {
  ApiErrorException,
  type ResetPreviewResponse,
  type ResetResponse,
  toStaffUserId,
  toTenantId,
  type WorkerEnv,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-demo-route");
const ADMIN_ID = toStaffUserId("demo-route-admin");
const STAFF_ID = toStaffUserId("demo-route-staff");
const PASSWORD = "correct horse battery staple";
const TEST_ITERATIONS = 1_000;
const BASIC_PASSWORD = "test-password-at-least-20-characters";
const BASIC_AUTHORIZATION = `Basic ${btoa(`test-user:${BASIC_PASSWORD}`)}`;

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

function jsonRequest(
  method: string,
  path: string,
  body: unknown,
  cookie?: string,
): Request {
  return request(path, {
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(cookie ? { cookie } : {}),
    headers: { "Content-Type": "application/json" },
    method,
  });
}

function sessionCookieFrom(response: Response): string {
  return (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
}

async function loginCookieFor(
  email: string,
  environment: WorkerEnv,
): Promise<string> {
  const response = await createApp(environment).fetch(
    jsonRequest("POST", "/api/auth/login", { email, password: PASSWORD }),
    environment,
  );
  return sessionCookieFrom(response);
}

function fakeDemoResetService(
  overrides: Partial<DemoResetService> = {},
): DemoResetService {
  return {
    preview: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

function appWith(service: DemoResetService, environment: WorkerEnv) {
  return createApp(
    environment,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    service,
  );
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
  await env.DB.prepare("DELETE FROM staff_users").run();

  const repositories = createTenantRepository(env.DB).forTenant(TENANT_ID);
  await repositories.staffUsers.insert({
    createdById: null,
    email: "admin@example.test",
    failedLoginCount: 0,
    id: ADMIN_ID,
    isActive: true,
    lockedUntil: null,
    name: "管理 太郎",
    passwordHash: await hashPassword(PASSWORD, TEST_ITERATIONS),
    role: "admin",
    updatedById: null,
  });
  await repositories.staffUsers.insert({
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

describe("F-9-8: ALLOW_DATA_RESETが無効な環境では機能の存在を露出させない", () => {
  it.each([
    ["GET", "/api/demo/reset/preview", undefined],
    ["POST", "/api/demo/reset", { confirmation: "RESET" }],
  ] as const)(
    "%s %s returns 404 for an admin actor when the flag is unset",
    async (method, path, body) => {
      const environment = createTestEnv({ ALLOW_DATA_RESET: undefined });
      const cookie = await loginCookieFor("admin@example.test", environment);
      const app = appWith(fakeDemoResetService(), environment);

      const response = await app.fetch(
        body === undefined
          ? request(path, { cookie })
          : jsonRequest(method, path, body, cookie),
        environment,
      );

      expect(response.status).toBe(404);
    },
  );

  it("returns 404 (not 403) for a staff actor when the flag is unset, matching the FLAG-before-ROLE order", async () => {
    const environment = createTestEnv({ ALLOW_DATA_RESET: undefined });
    const cookie = await loginCookieFor("staff@example.test", environment);
    const app = appWith(fakeDemoResetService(), environment);

    const response = await app.fetch(
      request("/api/demo/reset/preview", { cookie }),
      environment,
    );

    expect(response.status).toBe(404);
  });
});

describe("F-9-6: adminのみ実行できる", () => {
  it.each([
    ["GET", "/api/demo/reset/preview", undefined],
    ["POST", "/api/demo/reset", { confirmation: "RESET" }],
  ] as const)(
    "%s %s returns 403 for a staff-role actor when the flag is enabled",
    async (method, path, body) => {
      const environment = createTestEnv();
      const cookie = await loginCookieFor("staff@example.test", environment);
      const app = appWith(fakeDemoResetService(), environment);

      const response = await app.fetch(
        body === undefined
          ? request(path, { cookie })
          : jsonRequest(method, path, body, cookie),
        environment,
      );

      expect(response.status).toBe(403);
    },
  );

  it("returns 401 without a session cookie", async () => {
    const environment = createTestEnv();
    const app = appWith(fakeDemoResetService(), environment);

    const response = await app.fetch(
      request("/api/demo/reset/preview"),
      environment,
    );

    expect(response.status).toBe(401);
  });
});

describe("GET /api/demo/reset/preview (api.md #27)", () => {
  it("returns the service result for an admin actor", async () => {
    const environment = createTestEnv();
    const cookie = await loginCookieFor("admin@example.test", environment);
    const preview: ResetPreviewResponse = {
      applications: 3,
      confirmationWord: "RESET",
      images: 2,
      members: 1,
      snapshotToken: "snapshot-token-abc",
    };
    const app = appWith(
      fakeDemoResetService({ preview: vi.fn(async () => preview) }),
      environment,
    );

    const response = await app.fetch(
      request("/api/demo/reset/preview", { cookie }),
      environment,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(preview);
  });
});

describe("POST /api/demo/reset (api.md #28・F-9-7)", () => {
  it("passes the parsed confirmation and actor through to the service", async () => {
    const environment = createTestEnv();
    const cookie = await loginCookieFor("admin@example.test", environment);
    const result: ResetResponse = {
      deleted: { applications: 1, images: 1, members: 1 },
      usageCounterReset: false,
    };
    const reset = vi.fn(async () => result);
    const app = appWith(fakeDemoResetService({ reset }), environment);

    const response = await app.fetch(
      jsonRequest(
        "POST",
        "/api/demo/reset",
        { confirmation: "RESET", snapshotToken: "snapshot-token-abc" },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(reset).toHaveBeenCalledWith(
      { confirmation: "RESET", snapshotToken: "snapshot-token-abc" },
      expect.objectContaining({
        user: expect.objectContaining({ id: ADMIN_ID }),
      }),
    );
  });

  it("returns 422 without calling the service when confirmation is missing", async () => {
    const environment = createTestEnv();
    const cookie = await loginCookieFor("admin@example.test", environment);
    const reset = vi.fn();
    const app = appWith(fakeDemoResetService({ reset }), environment);

    const response = await app.fetch(
      jsonRequest(
        "POST",
        "/api/demo/reset",
        { snapshotToken: "snapshot-token-abc" },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(422);
    expect(reset).not.toHaveBeenCalled();
  });

  it("returns 422 without calling the service when snapshotToken is missing", async () => {
    const environment = createTestEnv();
    const cookie = await loginCookieFor("admin@example.test", environment);
    const reset = vi.fn();
    const app = appWith(fakeDemoResetService({ reset }), environment);

    const response = await app.fetch(
      jsonRequest("POST", "/api/demo/reset", { confirmation: "RESET" }, cookie),
      environment,
    );

    expect(response.status).toBe(422);
    expect(reset).not.toHaveBeenCalled();
  });

  it("propagates the service's 422 when the confirmation word does not match", async () => {
    const environment = createTestEnv();
    const cookie = await loginCookieFor("admin@example.test", environment);
    const app = appWith(
      fakeDemoResetService({
        reset: vi.fn(async () => {
          throw new ApiErrorException("VALIDATION_ERROR");
        }),
      }),
      environment,
    );

    const response = await app.fetch(
      jsonRequest(
        "POST",
        "/api/demo/reset",
        { confirmation: "wrong", snapshotToken: "snapshot-token-abc" },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(422);
  });

  // コードレビュー指摘・P2・決定#51: previewの表示後に対象集合が変わっていた場合、
  // サービスが返す409をそのままクライアントへ伝える。
  it("propagates the service's 409 when the snapshot token is stale", async () => {
    const environment = createTestEnv();
    const cookie = await loginCookieFor("admin@example.test", environment);
    const app = appWith(
      fakeDemoResetService({
        reset: vi.fn(async () => {
          throw new ApiErrorException("INVALID_TRANSITION");
        }),
      }),
      environment,
    );

    const response = await app.fetch(
      jsonRequest(
        "POST",
        "/api/demo/reset",
        { confirmation: "RESET", snapshotToken: "stale-token" },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(409);
  });
});
