import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantRepository } from "../../../src/worker/db/repositories";
import { createApp } from "../../../src/worker/index";
import type { ApplicationService } from "../../../src/worker/services/application-service";
import { hashPassword } from "../../../src/worker/services/auth";
import {
  ApiErrorException,
  type ApplicationDetail,
  type CheckRunView,
  toApplicationId,
  toStaffUserId,
  toTenantId,
  type WorkerEnv,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-applications-query-route");
const STAFF_ID = toStaffUserId("applications-query-route-staff");
const APPLICATION_ID = toApplicationId("applications-query-route-application");
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

function sessionCookieFrom(response: Response): string {
  return (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
}

async function loginCookie(): Promise<string> {
  const response = await createApp(createTestEnv()).fetch(
    request("/api/auth/login", {
      body: JSON.stringify({ email: "staff@example.test", password: PASSWORD }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
    createTestEnv(),
  );
  return sessionCookieFrom(response);
}

function fakeApplicationService(
  overrides: Partial<ApplicationService> = {},
): ApplicationService {
  return {
    changeStatus: vi.fn(),
    decideMatch: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    listCheckRuns: vi.fn(),
    updateFields: vi.fn(),
    ...overrides,
  };
}

function appWith(service: ApplicationService, environment: WorkerEnv) {
  return createApp(
    environment,
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

describe("GET /api/applications (api.md #7・F-4-10・F-4-11)", () => {
  it("requires an authenticated session", async () => {
    const environment = createTestEnv();
    const app = appWith(fakeApplicationService(), environment);

    const response = await app.fetch(request("/api/applications"), environment);

    expect(response.status).toBe(401);
  });

  it("parses filters/pagination from the query string and returns the service result", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const fakeResult = { items: [], page: 2, perPage: 10, total: 0 };
    const list = vi.fn(async () => fakeResult);
    const app = appWith(fakeApplicationService({ list }), environment);

    const response = await app.fetch(
      request(
        "/api/applications?appStatus=under_review&triage=needs_review&linked=true&needsReviewOnly=true&page=2&perPage=10",
        { cookie },
      ),
      environment,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(fakeResult);
    expect(list).toHaveBeenCalledWith({
      appStatus: "under_review",
      linked: true,
      needsReviewOnly: true,
      page: 2,
      perPage: 10,
      triage: "needs_review",
    });
  });

  it("ignores unknown/invalid filter values instead of returning 422", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const list = vi.fn(async () => ({
      items: [],
      page: 1,
      perPage: 20,
      total: 0,
    }));
    const app = appWith(fakeApplicationService({ list }), environment);

    const response = await app.fetch(
      request("/api/applications?appStatus=not-a-status&page=abc", { cookie }),
      environment,
    );

    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith({});
  });
});

describe("GET /api/applications/:id (api.md #9・F-4-5)", () => {
  it("requires an authenticated session", async () => {
    const environment = createTestEnv();
    const app = appWith(fakeApplicationService(), environment);

    const response = await app.fetch(
      request(`/api/applications/${APPLICATION_ID}`),
      environment,
    );

    expect(response.status).toBe(401);
  });

  it("returns the service result", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const fakeApplication = { id: APPLICATION_ID } as ApplicationDetail;
    const get = vi.fn(async () => fakeApplication);
    const app = appWith(fakeApplicationService({ get }), environment);

    const response = await app.fetch(
      request(`/api/applications/${APPLICATION_ID}`, { cookie }),
      environment,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(fakeApplication);
    expect(get).toHaveBeenCalledWith(APPLICATION_ID);
  });

  it("maps NOT_FOUND from the service to HTTP 404", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const get = vi.fn(async () => {
      throw new ApiErrorException("NOT_FOUND");
    });
    const app = appWith(fakeApplicationService({ get }), environment);

    const response = await app.fetch(
      request(`/api/applications/${APPLICATION_ID}`, { cookie }),
      environment,
    );

    expect(response.status).toBe(404);
  });
});

describe("GET /api/applications/:id/check-runs (api.md #12・F-3-7)", () => {
  it("requires an authenticated session", async () => {
    const environment = createTestEnv();
    const app = appWith(fakeApplicationService(), environment);

    const response = await app.fetch(
      request(`/api/applications/${APPLICATION_ID}/check-runs`),
      environment,
    );

    expect(response.status).toBe(401);
  });

  it("returns the service result", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const fakeHistory = [{ id: "check-run-1" }] as CheckRunView[];
    const listCheckRuns = vi.fn(async () => fakeHistory);
    const app = appWith(fakeApplicationService({ listCheckRuns }), environment);

    const response = await app.fetch(
      request(`/api/applications/${APPLICATION_ID}/check-runs`, { cookie }),
      environment,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(fakeHistory);
    expect(listCheckRuns).toHaveBeenCalledWith(APPLICATION_ID);
  });
});
