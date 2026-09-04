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
  type ChangeAppStatusResponse,
  type DecideMatchResponse,
  toApplicationId,
  toMatchCandidateId,
  toStaffUserId,
  toTenantId,
  type WorkerEnv,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-applications-mutation-route");
const STAFF_ID = toStaffUserId("applications-mutation-route-staff");
const APPLICATION_ID = toApplicationId(
  "applications-mutation-route-application",
);
const CANDIDATE_ID = toMatchCandidateId(
  "applications-mutation-route-candidate",
);
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

async function loginCookie(): Promise<string> {
  const response = await createApp(createTestEnv()).fetch(
    jsonRequest("POST", "/api/auth/login", {
      email: "staff@example.test",
      password: PASSWORD,
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

describe("PATCH /api/applications/:id/fields (api.md #10・F-4-5)", () => {
  it("requires an authenticated session", async () => {
    const environment = createTestEnv();
    const app = appWith(fakeApplicationService(), environment);

    const response = await app.fetch(
      jsonRequest("PATCH", `/api/applications/${APPLICATION_ID}/fields`, {
        fields: [],
      }),
      environment,
    );

    expect(response.status).toBe(401);
  });

  it("rejects a body without a fields array with 422 and never calls the service", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const updateFields = vi.fn();
    const app = appWith(fakeApplicationService({ updateFields }), environment);

    const response = await app.fetch(
      jsonRequest(
        "PATCH",
        `/api/applications/${APPLICATION_ID}/fields`,
        {},
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(422);
    expect(updateFields).not.toHaveBeenCalled();
  });

  it("passes the actor and parsed fields through, returning the service result", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const fakeApplication = { id: APPLICATION_ID } as ApplicationDetail;
    const updateFields = vi.fn(async () => fakeApplication);
    const app = appWith(fakeApplicationService({ updateFields }), environment);

    const response = await app.fetch(
      jsonRequest(
        "PATCH",
        `/api/applications/${APPLICATION_ID}/fields`,
        { fields: [{ label: "氏名", value: "山田太郎" }] },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(fakeApplication);
    expect(updateFields).toHaveBeenCalledOnce();
    const [applicationId, actor, input] = updateFields.mock
      .calls[0] as unknown as [string, { user: { id: string } }, unknown];
    expect(applicationId).toBe(APPLICATION_ID);
    expect(actor.user.id).toBe(STAFF_ID);
    expect(input).toEqual({ fields: [{ label: "氏名", value: "山田太郎" }] });
  });
});

describe("POST /api/applications/:id/status (api.md #11・F-4-1〜4)", () => {
  it("rejects an invalid toStatus with 422 and never calls the service", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const changeStatus = vi.fn();
    const app = appWith(fakeApplicationService({ changeStatus }), environment);

    const response = await app.fetch(
      jsonRequest(
        "POST",
        `/api/applications/${APPLICATION_ID}/status`,
        { toStatus: "not-a-status" },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(422);
    expect(changeStatus).not.toHaveBeenCalled();
  });

  it("passes the actor and toStatus through, returning the service result", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const fakeResult = {
      application: { id: APPLICATION_ID },
      promotedMember: null,
    } as ChangeAppStatusResponse;
    const changeStatus = vi.fn(async () => fakeResult);
    const app = appWith(fakeApplicationService({ changeStatus }), environment);

    const response = await app.fetch(
      jsonRequest(
        "POST",
        `/api/applications/${APPLICATION_ID}/status`,
        { toStatus: "under_review" },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(fakeResult);
    const [applicationId, actor, input] = changeStatus.mock
      .calls[0] as unknown as [string, { user: { id: string } }, unknown];
    expect(applicationId).toBe(APPLICATION_ID);
    expect(actor.user.id).toBe(STAFF_ID);
    expect(input).toEqual({ note: undefined, toStatus: "under_review" });
  });

  it.each([
    ["NOT_FOUND", 404],
    ["INVALID_TRANSITION", 409],
  ] as const)("maps %s from the service to HTTP %i", async (code, status) => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const changeStatus = vi.fn(async () => {
      throw new ApiErrorException(code);
    });
    const app = appWith(fakeApplicationService({ changeStatus }), environment);

    const response = await app.fetch(
      jsonRequest(
        "POST",
        `/api/applications/${APPLICATION_ID}/status`,
        { toStatus: "under_review" },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(status);
  });
});

describe("PATCH /api/applications/:id/match-candidates/:candidateId (api.md #13・F-6-8・F-6-9)", () => {
  it("rejects a decision outside merged/rejected/hold with 422 and never calls the service", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const decideMatch = vi.fn();
    const app = appWith(fakeApplicationService({ decideMatch }), environment);

    const response = await app.fetch(
      jsonRequest(
        "PATCH",
        `/api/applications/${APPLICATION_ID}/match-candidates/${CANDIDATE_ID}`,
        { decision: "stale" },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(422);
    expect(decideMatch).not.toHaveBeenCalled();
  });

  it("passes the actor, applicationId, candidateId and decision through", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const fakeResult = {
      application: { id: APPLICATION_ID },
      candidate: { id: CANDIDATE_ID },
    } as DecideMatchResponse;
    const decideMatch = vi.fn(async () => fakeResult);
    const app = appWith(fakeApplicationService({ decideMatch }), environment);

    const response = await app.fetch(
      jsonRequest(
        "PATCH",
        `/api/applications/${APPLICATION_ID}/match-candidates/${CANDIDATE_ID}`,
        { decision: "merged" },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(fakeResult);
    const [applicationId, candidateId, actor, input] = decideMatch.mock
      .calls[0] as unknown as [
      string,
      string,
      { user: { id: string } },
      unknown,
    ];
    expect(applicationId).toBe(APPLICATION_ID);
    expect(candidateId).toBe(CANDIDATE_ID);
    expect(actor.user.id).toBe(STAFF_ID);
    expect(input).toEqual({ decision: "merged" });
  });
});
