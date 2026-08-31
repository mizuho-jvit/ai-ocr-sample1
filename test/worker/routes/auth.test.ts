import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTenantRepository,
  whereFieldEquals,
} from "../../../src/worker/db/repositories";
import { createApp } from "../../../src/worker/index";
import { SESSION_COOKIE_NAME } from "../../../src/worker/middleware/auth";
import { hashPassword } from "../../../src/worker/services/auth";
import {
  toSessionId,
  toStaffUserId,
  toTenantId,
  type WorkerEnv,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-routes");
const ADMIN_ID = toStaffUserId("routes-admin");
const STAFF_ID = toStaffUserId("routes-staff");
const PASSWORD = "correct horse battery staple";
const TEST_ITERATIONS = 1_000;
const BASIC_PASSWORD = "test-password-at-least-20-characters";
const BASIC_AUTHORIZATION = `Basic ${btoa(`test-user:${BASIC_PASSWORD}`)}`;

const testEnvironment = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
};

function createTestEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
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
  const setCookie = response.headers.get("Set-Cookie") ?? "";
  const value = setCookie.split(";")[0] ?? "";
  return value;
}

async function login(
  email = "admin@example.test",
  password = PASSWORD,
): Promise<Response> {
  return createApp(createTestEnv()).fetch(
    jsonRequest("/api/auth/login", { email, password }),
    createTestEnv(),
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
  const passwordHash = await hashPassword(PASSWORD, TEST_ITERATIONS);
  for (const staff of [
    {
      email: "admin@example.test",
      id: ADMIN_ID,
      name: "管理 太郎",
      role: "admin",
    },
    {
      email: "staff@example.test",
      id: STAFF_ID,
      name: "窓口 花子",
      role: "staff",
    },
  ]) {
    await repositories.staffUsers.insert({
      createdById: null,
      failedLoginCount: 0,
      isActive: true,
      lockedUntil: null,
      passwordHash,
      updatedById: null,
      ...staff,
    });
  }
});

describe("POST /api/auth/login (F-1-1・F-1-3・F-1-7)", () => {
  it("sets an HttpOnly, Secure, SameSite=Lax session cookie on success", async () => {
    const response = await login();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: {
        email: "admin@example.test",
        id: ADMIN_ID,
        isActive: true,
        name: "管理 太郎",
        role: "admin",
      },
    });

    const setCookie = response.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
  });

  it("never exposes the password hash in the response", async () => {
    const response = await login();

    expect(await response.text()).not.toContain("pbkdf2");
  });

  it("returns the unified 401 without a cookie for bad credentials", async () => {
    const response = await login("admin@example.test", "wrong-password");

    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "メールまたはパスワードが違います。",
      },
    });
  });

  it("returns the same 401 body for an unknown account", async () => {
    const known = await login("admin@example.test", "wrong-password");
    const unknown = await login("nobody@example.test", PASSWORD);

    expect(unknown.status).toBe(known.status);
    expect(await unknown.text()).toBe(await known.text());
  });

  it("rejects a malformed body with 422 VALIDATION_ERROR", async () => {
    const application = createApp(createTestEnv());
    const environment = createTestEnv();

    for (const body of [
      "not json",
      {},
      { email: "admin@example.test" },
      { email: "", password: PASSWORD },
      { email: 42, password: PASSWORD },
    ]) {
      const response = await application.fetch(
        jsonRequest("/api/auth/login", body),
        environment,
      );
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }
  });

  it("still requires Basic authentication in front of the login route (F-1-13)", async () => {
    const response = await createApp(createTestEnv()).fetch(
      new Request("https://example.test/api/auth/login", {
        body: JSON.stringify({
          email: "admin@example.test",
          password: PASSWORD,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      createTestEnv(),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
  });
});

describe("GET /api/auth/session (F-1-8・F-9-8)", () => {
  it("returns the actor and the dataReset feature flag", async () => {
    const cookie = sessionCookieFrom(await login());

    const response = await createApp(createTestEnv()).fetch(
      request("/api/auth/session", { cookie }),
      createTestEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      features: { dataReset: true },
      user: expect.objectContaining({ id: ADMIN_ID, role: "admin" }),
    });
  });

  it("mirrors ALLOW_DATA_RESET being disabled", async () => {
    const cookie = sessionCookieFrom(await login());
    const disabled = createTestEnv({ ALLOW_DATA_RESET: "false" });

    const response = await createApp(disabled).fetch(
      request("/api/auth/session", { cookie }),
      disabled,
    );

    await expect(response.json()).resolves.toMatchObject({
      features: { dataReset: false },
    });
  });

  it("returns 401 UNAUTHENTICATED without a session cookie", async () => {
    const response = await createApp(createTestEnv()).fetch(
      request("/api/auth/session"),
      createTestEnv(),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHENTICATED", message: "ログインが必要です。" },
    });
  });

  it("returns 401 for a forged session id", async () => {
    const response = await createApp(createTestEnv()).fetch(
      request("/api/auth/session", {
        cookie: `${SESSION_COOKIE_NAME}=forged-session-id`,
      }),
      createTestEnv(),
    );

    expect(response.status).toBe(401);
  });
});

describe("POST /api/auth/logout (F-1-10)", () => {
  it("destroys the session, clears the cookie, and makes the session endpoint 401", async () => {
    const cookie = sessionCookieFrom(await login());
    const sessionId = cookie.split("=")[1] ?? "";

    const logout = await createApp(createTestEnv()).fetch(
      request("/api/auth/logout", { cookie, method: "POST" }),
      createTestEnv(),
    );

    expect(logout.status).toBe(204);
    expect(logout.headers.get("Set-Cookie")).toContain(
      `${SESSION_COOKIE_NAME}=`,
    );
    expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");

    const stored = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .sessions.findOne(
        whereFieldEquals("sessions", "id", toSessionId(sessionId)),
      );
    expect(stored).toBeNull();

    const afterLogout = await createApp(createTestEnv()).fetch(
      request("/api/auth/session", { cookie }),
      createTestEnv(),
    );
    expect(afterLogout.status).toBe(401);
  });

  it("returns 401 when logging out without a session", async () => {
    const response = await createApp(createTestEnv()).fetch(
      request("/api/auth/logout", { method: "POST" }),
      createTestEnv(),
    );

    expect(response.status).toBe(401);
  });
});

/**
 * 認証不要で到達してよい `/api` 配下のルート。
 * ここへ追加するのは「Basic認証だけで叩ける口を増やす」判断そのものなので、
 * 意図的な編集を強制する（NF-2-10・NF-2-28）。
 */
const PUBLIC_API_ROUTES = new Set(["POST /api/auth/login"]);

function registeredApiRoutes(): { method: string; path: string }[] {
  const seen = new Set<string>();
  return createApp(createTestEnv())
    .routes.filter(
      // `.use()` は method "ALL" で同じ配列に入るため除外する。
      (route) => route.method !== "ALL" && route.path.startsWith("/api"),
    )
    .flatMap((route) => {
      const key = `${route.method} ${route.path}`;
      if (seen.has(key)) {
        return [];
      }
      seen.add(key);
      return [{ method: route.method, path: route.path }];
    });
}

describe("API 認証の網羅性 (NF-2-10・NF-2-28)", () => {
  it("requires an application session for every /api route except the allowlist", async () => {
    const routes = registeredApiRoutes();
    // 列挙が空でも通ってしまう罠を潰す。
    expect(routes.length).toBeGreaterThan(0);

    const application = createApp(createTestEnv());
    const environment = createTestEnv();
    const guarded = routes.filter(
      ({ method, path }) => !PUBLIC_API_ROUTES.has(`${method} ${path}`),
    );
    expect(guarded.length).toBeGreaterThan(0);

    for (const { method, path } of guarded) {
      // パスパラメータはダミー値へ置換する（Task 007 以降で `:id` が現れる）。
      const concretePath = path.replace(/:[^/]+/g, "test-id");
      const response = await application.fetch(
        request(concretePath, { method }),
        environment,
      );

      expect(
        { path: concretePath, status: response.status },
        `${method} ${path} must reject a request without a session cookie`,
      ).toEqual({ path: concretePath, status: 401 });
    }
  });

  it("keeps the public allowlist limited to the login endpoint", () => {
    const paths = registeredApiRoutes().map(
      ({ method, path }) => `${method} ${path}`,
    );

    // 許可リストに実在しないルートが残り続けないようにする。
    for (const allowed of PUBLIC_API_ROUTES) {
      expect(paths).toContain(allowed);
    }
    expect([...PUBLIC_API_ROUTES]).toEqual(["POST /api/auth/login"]);
  });
});

describe("失敗ログの routePattern (LOG-8)", () => {
  it("records the failing endpoint pattern, not the middleware wildcard", async () => {
    // D1 を壊して 500 を起こす。401/422 は shouldEmit の対象外でログが出ない。
    const broken = createTestEnv({ DB: {} as D1Database });
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await createApp(broken).fetch(
      jsonRequest("/api/auth/login", {
        email: "admin@example.test",
        password: PASSWORD,
      }),
      broken,
    );

    expect(response.status).toBe(500);
    expect(logError).toHaveBeenCalledOnce();
    expect(logError.mock.calls[0]?.[0]).toMatchObject({
      httpMethod: "POST",
      httpStatus: 500,
      routePattern: "/api/auth/login",
    });
    logError.mockRestore();
  });
});

describe("role separation (NF-2-11)", () => {
  it("gives staff a session whose role is staff", async () => {
    const cookie = sessionCookieFrom(
      await login("staff@example.test", PASSWORD),
    );

    const response = await createApp(createTestEnv()).fetch(
      request("/api/auth/session", { cookie }),
      createTestEnv(),
    );

    await expect(response.json()).resolves.toMatchObject({
      user: { id: STAFF_ID, role: "staff" },
    });
  });
});
