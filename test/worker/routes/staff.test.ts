import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantRepository } from "../../../src/worker/db/repositories";
import { createApp } from "../../../src/worker/index";
import { hashPassword } from "../../../src/worker/services/auth";
import type { StaffService } from "../../../src/worker/services/staff-service";
import {
  ApiErrorException,
  type StaffUserSummary,
  toStaffUserId,
  toTenantId,
  type WorkerEnv,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-staff-route");
const ADMIN_ID = toStaffUserId("staff-route-admin");
const STAFF_ID = toStaffUserId("staff-route-staff");
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

async function loginCookieFor(email: string): Promise<string> {
  const response = await createApp(createTestEnv()).fetch(
    jsonRequest("POST", "/api/auth/login", { email, password: PASSWORD }),
    createTestEnv(),
  );
  return sessionCookieFrom(response);
}

function fakeStaffService(overrides: Partial<StaffService> = {}): StaffService {
  return {
    create: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
}

function appWith(service: StaffService, environment: WorkerEnv) {
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

describe("F-7-2: staffロールは全スタッフAPIで403となる", () => {
  it.each([
    ["GET", "/api/staff", undefined],
    [
      "POST",
      "/api/staff",
      {
        email: "x@example.test",
        name: "x",
        password: "x",
        role: "staff",
      },
    ],
    ["PATCH", `/api/staff/${ADMIN_ID}`, { name: "x" }],
  ] as const)(
    "%s %s returns 403 for a staff-role actor",
    async (method, path, body) => {
      const cookie = await loginCookieFor("staff@example.test");
      const environment = createTestEnv();
      const app = appWith(fakeStaffService(), environment);

      const response = await app.fetch(
        body === undefined
          ? request(path, { cookie })
          : jsonRequest(method, path, body, cookie),
        environment,
      );

      expect(response.status).toBe(403);
    },
  );
});

describe("GET /api/staff (api.md #24)", () => {
  it("returns the service result for an admin actor", async () => {
    const cookie = await loginCookieFor("admin@example.test");
    const environment = createTestEnv();
    const summaries: StaffUserSummary[] = [
      {
        email: "admin@example.test",
        id: ADMIN_ID,
        isActive: true,
        name: "管理 太郎",
        role: "admin",
      },
    ];
    const list = vi.fn(async () => summaries);
    const app = appWith(fakeStaffService({ list }), environment);

    const response = await app.fetch(
      request("/api/staff", { cookie }),
      environment,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(summaries);
    expect(list).toHaveBeenCalledOnce();
  });
});

describe("POST /api/staff (api.md #25・F-7-1)", () => {
  const VALID_PASSWORD = "correct horse battery staple";

  it.each([
    [
      "missing name",
      { email: "a@example.test", password: VALID_PASSWORD, role: "staff" },
    ],
    ["missing email", { name: "a", password: VALID_PASSWORD, role: "staff" }],
    ["missing password", { email: "a@example.test", name: "a", role: "staff" }],
    [
      "invalid role",
      {
        email: "a@example.test",
        name: "a",
        password: VALID_PASSWORD,
        role: "owner",
      },
    ],
    [
      "whitespace-only name",
      {
        email: "a@example.test",
        name: "   ",
        password: VALID_PASSWORD,
        role: "staff",
      },
    ],
  ])(
    "rejects a body with %s with 422 and never calls the service",
    async (_label, body) => {
      const cookie = await loginCookieFor("admin@example.test");
      const environment = createTestEnv();
      const create = vi.fn();
      const app = appWith(fakeStaffService({ create }), environment);

      const response = await app.fetch(
        jsonRequest("POST", "/api/staff", body, cookie),
        environment,
      );

      expect(response.status).toBe(422);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["missing @", "invalid"],
    ["missing domain TLD", "a@localhost"],
    ["leading whitespace", " a@example.test"],
    ["trailing whitespace", "a@example.test "],
    ["embedded whitespace", "a @example.test"],
    ["too long (255 chars)", `${"a".repeat(242)}@example.test`],
  ])(
    "rejects an email that is %s with 422 and never calls the service (コードレビュー指摘P2)",
    async (_label, email) => {
      const cookie = await loginCookieFor("admin@example.test");
      const environment = createTestEnv();
      const create = vi.fn();
      const app = appWith(fakeStaffService({ create }), environment);

      const response = await app.fetch(
        jsonRequest(
          "POST",
          "/api/staff",
          { email, name: "新人", password: VALID_PASSWORD, role: "staff" },
          cookie,
        ),
        environment,
      );

      expect(response.status).toBe(422);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["11文字(最小長未満)", "a".repeat(11)],
    ["51文字(最大長超過)", "a".repeat(51)],
  ])(
    "rejects a password that is %s with 422 and never calls the service (コードレビュー指摘P2)",
    async (_label, password) => {
      const cookie = await loginCookieFor("admin@example.test");
      const environment = createTestEnv();
      const create = vi.fn();
      const app = appWith(fakeStaffService({ create }), environment);

      const response = await app.fetch(
        jsonRequest(
          "POST",
          "/api/staff",
          { email: "a@example.test", name: "新人", password, role: "staff" },
          cookie,
        ),
        environment,
      );

      expect(response.status).toBe(422);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("accepts an email and password at exactly the boundary lengths (コードレビュー指摘P2)", async () => {
    const cookie = await loginCookieFor("admin@example.test");
    const environment = createTestEnv();
    const fakeStaff = {
      id: toStaffUserId("boundary-staff"),
    } as StaffUserSummary;
    const create = vi.fn(async () => fakeStaff);
    const app = appWith(fakeStaffService({ create }), environment);

    const response = await app.fetch(
      jsonRequest(
        "POST",
        "/api/staff",
        {
          email: `${"a".repeat(241)}@example.test`,
          name: "新人",
          password: "a".repeat(50),
          role: "staff",
        },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledOnce();
  });

  it("passes the actor and parsed input through, returning 201 with the service result", async () => {
    const cookie = await loginCookieFor("admin@example.test");
    const environment = createTestEnv();
    const fakeStaff = {
      email: "new@example.test",
      id: toStaffUserId("new-staff"),
      isActive: true,
      name: "新人",
      role: "staff",
    } as StaffUserSummary;
    const create = vi.fn(async () => fakeStaff);
    const app = appWith(fakeStaffService({ create }), environment);

    const response = await app.fetch(
      jsonRequest(
        "POST",
        "/api/staff",
        {
          email: "new@example.test",
          name: "新人",
          password: "correct horse battery staple",
          role: "staff",
        },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(fakeStaff);
    const [input, actor] = create.mock.calls[0] as unknown as [
      unknown,
      { user: { id: string } },
    ];
    expect(input).toEqual({
      email: "new@example.test",
      name: "新人",
      password: "correct horse battery staple",
      role: "staff",
    });
    expect(actor.user.id).toBe(ADMIN_ID);
  });
});

describe("PATCH /api/staff/:id (api.md #26・F-7-1)", () => {
  it.each([
    ["invalid role", { role: "owner" }],
    ["whitespace-only name", { name: "   " }],
    ["non-boolean isActive", { isActive: "false" }],
    ["empty password", { password: "" }],
    ["password too short (11 chars)", { password: "a".repeat(11) }],
    ["password too long (51 chars)", { password: "a".repeat(51) }],
  ])(
    "rejects a body with %s with 422 and never calls the service (コードレビュー指摘P2)",
    async (_label, body) => {
      const cookie = await loginCookieFor("admin@example.test");
      const environment = createTestEnv();
      const update = vi.fn();
      const app = appWith(fakeStaffService({ update }), environment);

      const response = await app.fetch(
        jsonRequest("PATCH", `/api/staff/${STAFF_ID}`, body, cookie),
        environment,
      );

      expect(response.status).toBe(422);
      expect(update).not.toHaveBeenCalled();
    },
  );

  it("passes the actor, staff id and parsed partial input through", async () => {
    const cookie = await loginCookieFor("admin@example.test");
    const environment = createTestEnv();
    const fakeStaff = {
      email: "staff@example.test",
      id: STAFF_ID,
      isActive: false,
      name: "窓口 花子",
      role: "staff",
    } as StaffUserSummary;
    const update = vi.fn(async () => fakeStaff);
    const app = appWith(fakeStaffService({ update }), environment);

    const response = await app.fetch(
      jsonRequest(
        "PATCH",
        `/api/staff/${STAFF_ID}`,
        { isActive: false },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(fakeStaff);
    const [staffId, actor, input] = update.mock.calls[0] as unknown as [
      string,
      { user: { id: string } },
      unknown,
    ];
    expect(staffId).toBe(STAFF_ID);
    expect(actor.user.id).toBe(ADMIN_ID);
    expect(input).toEqual({ isActive: false });
  });

  it("accepts a password at exactly the boundary lengths (コードレビュー指摘P2)", async () => {
    const cookie = await loginCookieFor("admin@example.test");
    const environment = createTestEnv();
    const fakeStaff = { id: STAFF_ID } as StaffUserSummary;
    const update = vi.fn(async () => fakeStaff);
    const app = appWith(fakeStaffService({ update }), environment);

    const response = await app.fetch(
      jsonRequest(
        "PATCH",
        `/api/staff/${STAFF_ID}`,
        { password: "a".repeat(12) },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledOnce();
  });

  it.each([
    ["NOT_FOUND", 404],
    ["INVALID_TRANSITION", 409],
  ] as const)("maps %s from the service to HTTP %i", async (code, status) => {
    const cookie = await loginCookieFor("admin@example.test");
    const environment = createTestEnv();
    const update = vi.fn(async () => {
      throw new ApiErrorException(code);
    });
    const app = appWith(fakeStaffService({ update }), environment);

    const response = await app.fetch(
      jsonRequest("PATCH", `/api/staff/${STAFF_ID}`, { name: "x" }, cookie),
      environment,
    );

    expect(response.status).toBe(status);
  });
});
