import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantRepository } from "../../../src/worker/db/repositories";
import { createApp } from "../../../src/worker/index";
import { hashPassword } from "../../../src/worker/services/auth";
import type { BusinessCheckService } from "../../../src/worker/services/business-check";
import {
  ApiErrorException,
  toApplicationId,
  toStaffUserId,
  toTenantId,
  type WorkerEnv,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-checks-route");
const STAFF_ID = toStaffUserId("checks-route-staff");
const APPLICATION_ID = toApplicationId("checks-route-application");
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

function fakeBusinessCheck(
  run: BusinessCheckService["run"] = vi.fn(),
): BusinessCheckService {
  return { run };
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

describe("POST /api/checks/run (api.md #6・F-3・F-4-6)", () => {
  it("requires an authenticated session", async () => {
    const environment = createTestEnv();
    const app = createApp(
      environment,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fakeBusinessCheck(),
    );

    const response = await app.fetch(
      jsonRequest("/api/checks/run", { applicationId: APPLICATION_ID }),
      environment,
    );

    expect(response.status).toBe(401);
  });

  it("rejects a body without applicationId with 422 and never calls the service", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const run = vi.fn();
    const app = createApp(
      environment,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fakeBusinessCheck(run),
    );

    const response = await app.fetch(
      jsonRequest("/api/checks/run", {}, cookie),
      environment,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("passes the session actor and applicationId through, returning the service result", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const fakeResult = {
      application: { id: APPLICATION_ID },
      checkRun: { id: "check-run-1" },
      matchCandidates: [],
      remainingRuns: 4,
      usage: { geminiCalls: 1 },
    };
    const run = vi.fn(async () => fakeResult);
    const app = createApp(
      environment,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fakeBusinessCheck(run as unknown as BusinessCheckService["run"]),
    );

    const response = await app.fetch(
      jsonRequest("/api/checks/run", { applicationId: APPLICATION_ID }, cookie),
      environment,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(fakeResult);
    expect(run).toHaveBeenCalledOnce();
    const [actor, applicationId] = run.mock.calls[0] as unknown as [
      { user: { id: string } },
      string,
    ];
    expect(actor.user.id).toBe(STAFF_ID);
    expect(applicationId).toBe(APPLICATION_ID);
  });

  it.each([
    ["NOT_FOUND", 404],
    ["INVALID_TRANSITION", 409],
    ["CHECK_RUN_LIMIT", 409],
    ["USAGE_LIMIT_EXCEEDED", 429],
    ["AI_UNAVAILABLE", 503],
  ] as const)("maps %s from the service to HTTP %i", async (code, status) => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const run = vi.fn(async () => {
      throw new ApiErrorException(code);
    });
    const app = createApp(
      environment,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fakeBusinessCheck(run as unknown as BusinessCheckService["run"]),
    );

    const response = await app.fetch(
      jsonRequest("/api/checks/run", { applicationId: APPLICATION_ID }, cookie),
      environment,
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      error: { code },
    });
  });
});
