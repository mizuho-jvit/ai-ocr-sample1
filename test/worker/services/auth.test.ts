import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MAX_PBKDF2_ITERATIONS } from "../../../src/worker/config/load-config";
import {
  createTenantRepository,
  whereFieldEquals,
} from "../../../src/worker/db/repositories";
import type { staffUsers } from "../../../src/worker/db/schema";
import {
  createAuthService,
  hashPassword,
  LOGIN_LOCK_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  SESSION_TTL_MS,
  verifyPassword,
} from "../../../src/worker/services/auth";
import {
  type AppConfig,
  type SessionId,
  type StaffUserId,
  toSessionId,
  toStaffUserId,
  toTenantId,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-auth");
const OTHER_TENANT_ID = toTenantId("tenant-other");
const ADMIN_ID = toStaffUserId("staff-admin");
const STAFF_ID = toStaffUserId("staff-member");
const TEST_ITERATIONS = 1_000;
const PASSWORD = "correct horse battery staple";

const CONFIG: AppConfig = {
  allowDataReset: true,
  geminiModel: "gemini-3.1-flash-lite",
  maxCheckRunsPerApplication: 5,
  maxGeminiCallsPerMonth: 720,
  maxOcrPagesPerMonth: 120,
  ocrPipelineMode: "gemini",
  pbkdf2Iterations: TEST_ITERATIONS,
  tenantId: TENANT_ID,
};

const testEnvironment = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
};

let currentTime = new Date("2026-08-31T09:00:00.000Z");

function clock(): Date {
  return currentTime;
}

function authService(config: AppConfig = CONFIG) {
  return createAuthService({
    clock,
    config,
    repository: createTenantRepository(env.DB),
  });
}

function scopedRepositories(tenantId = TENANT_ID) {
  return createTenantRepository(env.DB).forTenant(tenantId);
}

async function insertStaff(
  overrides: Partial<Omit<typeof staffUsers.$inferInsert, "tenantId">> & {
    id: StaffUserId;
  },
  tenantId = TENANT_ID,
): Promise<void> {
  await scopedRepositories(tenantId).staffUsers.insert({
    createdById: null,
    email: "admin@example.test",
    failedLoginCount: 0,
    isActive: true,
    lockedUntil: null,
    name: "管理 太郎",
    passwordHash: await hashPassword(PASSWORD, TEST_ITERATIONS),
    role: "admin",
    updatedById: null,
    ...overrides,
  });
}

async function readStaff(id: StaffUserId, tenantId = TENANT_ID) {
  return scopedRepositories(tenantId).staffUsers.findOne(
    whereFieldEquals("staff_users", "id", id),
  );
}

async function readSession(id: SessionId) {
  return scopedRepositories().sessions.findOne(
    whereFieldEquals("sessions", "id", id),
  );
}

async function failLogin(times: number, email = "admin@example.test") {
  const service = authService();
  for (let attempt = 0; attempt < times; attempt += 1) {
    await expect(
      service.login({ email, password: "wrong-password" }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnvironment.TEST_MIGRATIONS);
});

beforeEach(async () => {
  currentTime = new Date("2026-08-31T09:00:00.000Z");
  for (const tenantId of [TENANT_ID, OTHER_TENANT_ID]) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO tenants (id, code, name) VALUES (?, ?, ?)",
    )
      .bind(tenantId, tenantId, tenantId)
      .run();
  }
  await env.DB.prepare("DELETE FROM sessions").run();
  await env.DB.prepare("DELETE FROM staff_users").run();
});

describe("password hashing (NF-2-1〜4)", () => {
  it("produces the self-describing pbkdf2-sha256 format and verifies it", async () => {
    const stored = await hashPassword(PASSWORD, TEST_ITERATIONS);
    const [algorithm, iterations, salt, digest] = stored.split("$");

    expect(algorithm).toBe("pbkdf2-sha256");
    expect(iterations).toBe(String(TEST_ITERATIONS));
    expect(atob(salt ?? "")).toHaveLength(16);
    expect(atob(digest ?? "")).toHaveLength(32);
    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(true);
    await expect(verifyPassword("other", stored)).resolves.toBe(false);
  });

  it("generates a distinct salt per account", async () => {
    const first = await hashPassword(PASSWORD, TEST_ITERATIONS);
    const second = await hashPassword(PASSWORD, TEST_ITERATIONS);

    expect(first).not.toBe(second);
  });

  it("verifies a hash generated at the configuration's upper bound", async () => {
    // 設定側の上限（load-config.ts）とパース側の上限が一致していないと、
    // 生成はできるが検証は必ず失敗するハッシュを作ってしまう。
    const stored = await hashPassword("demo-password", MAX_PBKDF2_ITERATIONS);

    expect(stored.split("$")[1]).toBe(String(MAX_PBKDF2_ITERATIONS));
    await expect(verifyPassword("demo-password", stored)).resolves.toBe(true);
  });

  it("rejects a stored hash whose iterations exceed the supported bound", async () => {
    const [, , salt, digest] = (
      await hashPassword(PASSWORD, TEST_ITERATIONS)
    ).split("$");
    const tampered = `pbkdf2-sha256$${MAX_PBKDF2_ITERATIONS + 1}$${salt}$${digest}`;

    await expect(verifyPassword(PASSWORD, tampered)).resolves.toBe(false);
  });

  it("rejects a malformed stored hash instead of throwing", async () => {
    for (const malformed of [
      "",
      "plain-text",
      "bcrypt$10$salt$hash",
      "pbkdf2-sha256$notanumber$c2FsdA==$aGFzaA==",
      "pbkdf2-sha256$0$c2FsdA==$aGFzaA==",
      "pbkdf2-sha256$1000$$aGFzaA==",
    ]) {
      await expect(verifyPassword(PASSWORD, malformed)).resolves.toBe(false);
    }
  });
});

describe("login (F-1-1・F-1-6・F-1-7・NF-2-3・NF-2-9)", () => {
  beforeEach(async () => {
    await insertStaff({ id: ADMIN_ID });
  });

  it("creates a D1 session and returns the staff summary without secrets", async () => {
    const result = await authService().login({
      email: "admin@example.test",
      password: PASSWORD,
    });

    expect(result.user).toEqual({
      email: "admin@example.test",
      id: ADMIN_ID,
      isActive: true,
      name: "管理 太郎",
      role: "admin",
    });
    expect(JSON.stringify(result.user)).not.toContain("pbkdf2");

    const session = await readSession(result.sessionId);
    expect(session?.staffUserId).toBe(ADMIN_ID);
    expect(session?.tenantId).toBe(TENANT_ID);
    expect(Date.parse(session?.expiresAt ?? "")).toBe(
      currentTime.getTime() + SESSION_TTL_MS,
    );
  });

  it("issues an unpredictable session id per login", async () => {
    const first = await authService().login({
      email: "admin@example.test",
      password: PASSWORD,
    });
    const second = await authService().login({
      email: "admin@example.test",
      password: PASSWORD,
    });

    expect(first.sessionId).not.toBe(second.sessionId);
    expect(first.sessionId.length).toBeGreaterThanOrEqual(32);
  });

  it("returns the same INVALID_CREDENTIALS error for unknown, wrong, inactive and locked", async () => {
    await insertStaff({
      email: "inactive@example.test",
      id: toStaffUserId("staff-inactive"),
      isActive: false,
    });
    await insertStaff({
      email: "locked@example.test",
      failedLoginCount: MAX_FAILED_LOGIN_ATTEMPTS,
      id: toStaffUserId("staff-locked"),
      lockedUntil: new Date(
        currentTime.getTime() + LOGIN_LOCK_DURATION_MS,
      ).toISOString(),
    });
    const service = authService();

    const attempts = [
      { email: "missing@example.test", password: PASSWORD },
      { email: "admin@example.test", password: "wrong-password" },
      { email: "inactive@example.test", password: PASSWORD },
      { email: "locked@example.test", password: PASSWORD },
    ];

    for (const attempt of attempts) {
      await expect(service.login(attempt)).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
        message: "メールまたはパスワードが違います。",
      });
    }

    const sessions = await scopedRepositories().sessions.all();
    expect(sessions).toHaveLength(0);
  });

  it("does not authenticate a staff user that belongs to another tenant", async () => {
    await insertStaff(
      { email: "outsider@example.test", id: toStaffUserId("staff-outsider") },
      OTHER_TENANT_ID,
    );

    await expect(
      authService().login({
        email: "outsider@example.test",
        password: PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("locks the account on the fifth consecutive failure only", async () => {
    await failLogin(MAX_FAILED_LOGIN_ATTEMPTS - 1);

    const beforeLock = await readStaff(ADMIN_ID);
    expect(beforeLock?.failedLoginCount).toBe(MAX_FAILED_LOGIN_ATTEMPTS - 1);
    expect(beforeLock?.lockedUntil).toBeNull();

    await failLogin(1);

    const locked = await readStaff(ADMIN_ID);
    expect(locked?.failedLoginCount).toBe(MAX_FAILED_LOGIN_ATTEMPTS);
    expect(Date.parse(locked?.lockedUntil ?? "")).toBe(
      currentTime.getTime() + LOGIN_LOCK_DURATION_MS,
    );
  });

  it("cannot be evaded by sending the failing attempts concurrently", async () => {
    const service = authService();

    const results = await Promise.allSettled(
      Array.from({ length: MAX_FAILED_LOGIN_ATTEMPTS }, () =>
        service.login({
          email: "admin@example.test",
          password: "wrong-password",
        }),
      ),
    );
    expect(results.every((result) => result.status === "rejected")).toBe(true);

    const locked = await readStaff(ADMIN_ID);
    expect(locked?.failedLoginCount).toBe(MAX_FAILED_LOGIN_ATTEMPTS);
    expect(Date.parse(locked?.lockedUntil ?? "")).toBe(
      currentTime.getTime() + LOGIN_LOCK_DURATION_MS,
    );
  });

  it("locks the account when the last two failures arrive concurrently", async () => {
    await failLogin(MAX_FAILED_LOGIN_ATTEMPTS - 2);
    const service = authService();

    await Promise.allSettled([
      service.login({
        email: "admin@example.test",
        password: "wrong-password",
      }),
      service.login({
        email: "admin@example.test",
        password: "wrong-password",
      }),
    ]);

    const locked = await readStaff(ADMIN_ID);
    expect(locked?.failedLoginCount).toBeGreaterThanOrEqual(
      MAX_FAILED_LOGIN_ATTEMPTS,
    );
    expect(locked?.lockedUntil).not.toBeNull();
  });

  it("keeps rejecting the correct password while locked without extending the lock", async () => {
    await failLogin(MAX_FAILED_LOGIN_ATTEMPTS);
    const lockedUntil = (await readStaff(ADMIN_ID))?.lockedUntil;

    currentTime = new Date(currentTime.getTime() + 60_000);
    await expect(
      authService().login({ email: "admin@example.test", password: PASSWORD }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    const stillLocked = await readStaff(ADMIN_ID);
    expect(stillLocked?.lockedUntil).toBe(lockedUntil);
    expect(stillLocked?.failedLoginCount).toBe(MAX_FAILED_LOGIN_ATTEMPTS);
  });

  it("accepts the correct password once the 15 minute lock expires and resets the counter", async () => {
    await failLogin(MAX_FAILED_LOGIN_ATTEMPTS);

    currentTime = new Date(currentTime.getTime() + LOGIN_LOCK_DURATION_MS + 1);
    await expect(
      authService().login({ email: "admin@example.test", password: PASSWORD }),
    ).resolves.toMatchObject({ user: { id: ADMIN_ID } });

    const unlocked = await readStaff(ADMIN_ID);
    expect(unlocked?.failedLoginCount).toBe(0);
    expect(unlocked?.lockedUntil).toBeNull();
  });

  it("starts a fresh attempt budget after the lock expires", async () => {
    await failLogin(MAX_FAILED_LOGIN_ATTEMPTS);
    currentTime = new Date(currentTime.getTime() + LOGIN_LOCK_DURATION_MS + 1);

    await failLogin(1);

    const afterExpiry = await readStaff(ADMIN_ID);
    expect(afterExpiry?.failedLoginCount).toBe(1);
    expect(afterExpiry?.lockedUntil).toBeNull();
  });

  it("verifies with the stored iteration count, not the configured default (NF-2-3)", async () => {
    const strongerHash = await hashPassword(PASSWORD, TEST_ITERATIONS * 5);
    await scopedRepositories().staffUsers.update(
      { passwordHash: strongerHash },
      whereFieldEquals("staff_users", "id", ADMIN_ID),
    );

    await expect(
      authService().login({ email: "admin@example.test", password: PASSWORD }),
    ).resolves.toMatchObject({ user: { id: ADMIN_ID } });
    expect((await readStaff(ADMIN_ID))?.passwordHash).toBe(strongerHash);
  });

  it("rehashes opportunistically when the stored iterations are below the default (NF-2-9)", async () => {
    const weakHash = await hashPassword(PASSWORD, TEST_ITERATIONS / 2);
    await scopedRepositories().staffUsers.update(
      { passwordHash: weakHash },
      whereFieldEquals("staff_users", "id", ADMIN_ID),
    );

    await authService().login({
      email: "admin@example.test",
      password: PASSWORD,
    });

    const rehashed = (await readStaff(ADMIN_ID))?.passwordHash ?? "";
    expect(rehashed).not.toBe(weakHash);
    expect(rehashed.split("$")[1]).toBe(String(TEST_ITERATIONS));
    await expect(verifyPassword(PASSWORD, rehashed)).resolves.toBe(true);
  });

  it("clears a stale failure counter on a successful login", async () => {
    await failLogin(2);

    await authService().login({
      email: "admin@example.test",
      password: PASSWORD,
    });

    expect((await readStaff(ADMIN_ID))?.failedLoginCount).toBe(0);
  });
});

describe("session lifecycle (F-1-4・F-1-10)", () => {
  beforeEach(async () => {
    await insertStaff({
      id: STAFF_ID,
      email: "staff@example.test",
      role: "staff",
    });
  });

  it("resolves an active session to its actor", async () => {
    const { sessionId } = await authService().login({
      email: "staff@example.test",
      password: PASSWORD,
    });

    await expect(authService().resolveSession(sessionId)).resolves.toEqual({
      sessionId,
      user: expect.objectContaining({ id: STAFF_ID, role: "staff" }),
    });
  });

  it("returns null for an unknown session id", async () => {
    await expect(
      authService().resolveSession(toSessionId("does-not-exist")),
    ).resolves.toBeNull();
  });

  it("rejects and deletes an expired session", async () => {
    const { sessionId } = await authService().login({
      email: "staff@example.test",
      password: PASSWORD,
    });

    currentTime = new Date(currentTime.getTime() + SESSION_TTL_MS + 1);

    await expect(authService().resolveSession(sessionId)).resolves.toBeNull();
    await expect(readSession(sessionId)).resolves.toBeNull();
  });

  it("rejects a session whose staff user was deactivated mid-session", async () => {
    const { sessionId } = await authService().login({
      email: "staff@example.test",
      password: PASSWORD,
    });

    await scopedRepositories().staffUsers.update(
      { isActive: false },
      whereFieldEquals("staff_users", "id", STAFF_ID),
    );

    await expect(authService().resolveSession(sessionId)).resolves.toBeNull();
  });

  it("destroys the server side session on logout", async () => {
    const { sessionId } = await authService().login({
      email: "staff@example.test",
      password: PASSWORD,
    });

    await authService().logout(sessionId);

    await expect(readSession(sessionId)).resolves.toBeNull();
    await expect(authService().resolveSession(sessionId)).resolves.toBeNull();
  });

  it("treats logging out an unknown session as a no-op", async () => {
    await expect(
      authService().logout(toSessionId("does-not-exist")),
    ).resolves.toBeUndefined();
  });
});
