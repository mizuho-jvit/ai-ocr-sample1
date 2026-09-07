import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTenantRepository,
  whereFieldEquals,
} from "../../../src/worker/db/repositories";
import {
  createAuthService,
  hashPassword,
} from "../../../src/worker/services/auth";
import { createStaffService } from "../../../src/worker/services/staff-service";
import {
  ApiErrorException,
  type AppConfig,
  type SessionId,
  type StaffUserId,
  toSessionId,
  toStaffUserId,
  toTenantId,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-staff-service");
const ADMIN_ID = toStaffUserId("staff-service-admin");

const CONFIG: AppConfig = {
  aiGatewayAccountId: "test-ai-gateway-account",
  aiGatewayId: "test-ai-gateway-id",
  allowDataReset: true,
  geminiModel: "gemini-3.1-flash-lite",
  maxCheckRunsPerApplication: 5,
  maxGeminiCallsPerMonth: 720,
  maxOcrPagesPerMonth: 120,
  ocrPipelineMode: "gemini",
  pbkdf2Iterations: 1_000,
  r2AccountId: "test-r2-account",
  tenantId: TENANT_ID,
};

const ACTOR = {
  sessionId: toSessionId("session-staff-service"),
  user: {
    email: "admin@example.test",
    id: ADMIN_ID,
    isActive: true,
    name: "管理 太郎",
    role: "admin" as const,
  },
};

const testEnvironment = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
};

function service() {
  return createStaffService({
    config: CONFIG,
    repository: createTenantRepository(env.DB),
  });
}

async function insertStaff(
  overrides: Partial<{
    id: StaffUserId;
    email: string;
    name: string;
    role: string;
    isActive: boolean;
    passwordHash: string;
  }> = {},
) {
  const id = overrides.id ?? ADMIN_ID;
  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .staffUsers.insert({
      createdById: null,
      email: overrides.email ?? `${id}@example.test`,
      failedLoginCount: 0,
      id,
      isActive: overrides.isActive ?? true,
      lockedUntil: null,
      name: overrides.name ?? "窓口 花子",
      passwordHash: overrides.passwordHash ?? "unused",
      role: overrides.role ?? "staff",
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
  await env.DB.prepare("DELETE FROM staff_users").run();
  await insertStaff();
});

describe("create (api.md #25・F-7-1)", () => {
  it("hashes the password and stores the new staff account", async () => {
    const result = await service().create(
      {
        email: "new-staff@example.test",
        name: "新人 職員",
        password: "correct horse battery staple",
        role: "staff",
      },
      ACTOR,
    );

    expect(result).toEqual({
      email: "new-staff@example.test",
      id: result.id,
      isActive: true,
      name: "新人 職員",
      role: "staff",
    });

    const row = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .staffUsers.findOne(whereFieldEquals("staff_users", "id", result.id));
    expect(row?.passwordHash).not.toBe("correct horse battery staple");
    expect(row?.passwordHash.startsWith("pbkdf2-sha256$1000$")).toBe(true);
  });

  it("rejects a duplicate email within the same tenant with VALIDATION_ERROR", async () => {
    await expect(
      service().create(
        {
          email: `${ADMIN_ID}@example.test`,
          name: "重複 職員",
          password: "correct horse battery staple",
          role: "staff",
        },
        ACTOR,
      ),
    ).rejects.toEqual(new ApiErrorException("VALIDATION_ERROR"));
  });

  it("同一メールで2件を並行作成すると、1件だけ成功しもう1件は422になる(コードレビュー指摘P2)", async () => {
    const input = (name: string) => ({
      email: "concurrent-dup@example.test",
      name,
      password: "correct horse battery staple",
      role: "staff" as const,
    });

    const results = await Promise.allSettled([
      service().create(input("並行1"), ACTOR),
      service().create(input("並行2"), ACTOR),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toEqual(
      new ApiErrorException("VALIDATION_ERROR"),
    );

    const rows = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .staffUsers.find(
        whereFieldEquals("staff_users", "email", "concurrent-dup@example.test"),
      );
    expect(rows).toHaveLength(1);
  });
});

describe("list (api.md #24・F-7-1)", () => {
  it("returns every staff account in the tenant as a summary", async () => {
    await insertStaff({
      email: "second@example.test",
      id: toStaffUserId("staff-service-second"),
      name: "二番目 職員",
    });

    const result = await service().list();

    expect(result.map((item) => item.email).sort()).toEqual(
      [`${ADMIN_ID}@example.test`, "second@example.test"].sort(),
    );
  });
});

describe("update (api.md #26・F-7-1)", () => {
  it("applies only the provided fields and records the updater", async () => {
    const result = await service().update(ADMIN_ID, ACTOR, {
      name: "改名 太郎",
    });

    expect(result.name).toBe("改名 太郎");
    expect(result.role).toBe("staff");
    expect(result.isActive).toBe(true);
  });

  it("disables the account via isActive:false (F-7-1)", async () => {
    const result = await service().update(ADMIN_ID, ACTOR, {
      isActive: false,
    });

    expect(result.isActive).toBe(false);
  });

  it("rehashes the password when a new password is provided", async () => {
    await service().update(ADMIN_ID, ACTOR, {
      password: "a brand new password",
    });

    const row = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .staffUsers.findOne(whereFieldEquals("staff_users", "id", ADMIN_ID));
    expect(row?.passwordHash.startsWith("pbkdf2-sha256$1000$")).toBe(true);
  });

  it("throws NOT_FOUND for a staff id outside the tenant", async () => {
    await expect(
      service().update(toStaffUserId("does-not-exist"), ACTOR, {
        name: "存在しない",
      }),
    ).rejects.toEqual(new ApiErrorException("NOT_FOUND"));
  });
});

describe("update: 最後の有効なadminを保護する(コードレビュー指摘P1)", () => {
  const LAST_ADMIN_ID = toStaffUserId("staff-service-last-admin");

  beforeEach(async () => {
    await insertStaff({
      email: "last-admin@example.test",
      id: LAST_ADMIN_ID,
      role: "admin",
    });
  });

  it("最後の有効なadminを無効化できない", async () => {
    await expect(
      service().update(LAST_ADMIN_ID, ACTOR, { isActive: false }),
    ).rejects.toEqual(new ApiErrorException("INVALID_TRANSITION"));

    const row = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .staffUsers.findOne(whereFieldEquals("staff_users", "id", LAST_ADMIN_ID));
    expect(row?.isActive).toBe(true);
  });

  it("最後の有効なadminをstaffへ降格できない", async () => {
    await expect(
      service().update(LAST_ADMIN_ID, ACTOR, { role: "staff" }),
    ).rejects.toEqual(new ApiErrorException("INVALID_TRANSITION"));

    const row = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .staffUsers.findOne(whereFieldEquals("staff_users", "id", LAST_ADMIN_ID));
    expect(row?.role).toBe("admin");
  });

  it("他に有効なadminがいれば無効化できる", async () => {
    await insertStaff({
      email: "other-admin@example.test",
      id: toStaffUserId("staff-service-other-admin"),
      role: "admin",
    });

    await expect(
      service().update(LAST_ADMIN_ID, ACTOR, { isActive: false }),
    ).resolves.toMatchObject({ isActive: false });
  });

  it("他に有効なadminがいれば降格できる", async () => {
    await insertStaff({
      email: "other-admin@example.test",
      id: toStaffUserId("staff-service-other-admin"),
      role: "admin",
    });

    await expect(
      service().update(LAST_ADMIN_ID, ACTOR, { role: "staff" }),
    ).resolves.toMatchObject({ role: "staff" });
  });

  it("自分自身を対象にした場合も、他人を対象にした場合と同じ不変条件が成立する", async () => {
    const selfActor = {
      ...ACTOR,
      user: { ...ACTOR.user, id: LAST_ADMIN_ID, role: "admin" as const },
    };

    await expect(
      service().update(LAST_ADMIN_ID, selfActor, { isActive: false }),
    ).rejects.toEqual(new ApiErrorException("INVALID_TRANSITION"));
  });

  it("ちょうど2人の有効なadminを同時に降格しても、片方は必ず拒否される(並行更新)", async () => {
    const otherAdminId = toStaffUserId("staff-service-other-admin");
    await insertStaff({
      email: "other-admin@example.test",
      id: otherAdminId,
      role: "admin",
    });

    const results = await Promise.allSettled([
      service().update(LAST_ADMIN_ID, ACTOR, { role: "staff" }),
      service().update(otherAdminId, ACTOR, { role: "staff" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toEqual(
      new ApiErrorException("INVALID_TRANSITION"),
    );

    const remainingAdmins = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .staffUsers.find(whereFieldEquals("staff_users", "role", "admin"));
    expect(remainingAdmins.filter((row) => row.isActive)).toHaveLength(1);
  });
});

describe("F-7-1: 無効化職員は以後ログインできない", () => {
  it("blocks login once isActive is turned off via update", async () => {
    const password = "correct horse battery staple";
    const auth = createAuthService({
      config: CONFIG,
      repository: createTenantRepository(env.DB),
    });
    await insertStaff({
      email: "login-target@example.test",
      id: toStaffUserId("staff-service-login-target"),
      passwordHash: await hashPassword(password, CONFIG.pbkdf2Iterations),
    });

    await expect(
      auth.login({ email: "login-target@example.test", password }),
    ).resolves.toBeTruthy();

    await service().update(toStaffUserId("staff-service-login-target"), ACTOR, {
      isActive: false,
    });

    await expect(
      auth.login({ email: "login-target@example.test", password }),
    ).rejects.toEqual(new ApiErrorException("INVALID_CREDENTIALS"));
  });
});

describe("update: 無効化時に既存セッションを削除する(コードレビュー指摘P1)", () => {
  const TARGET_ID = toStaffUserId("staff-service-session-target");
  const EMAIL = "session-target@example.test";
  const PASSWORD = "correct horse battery staple";
  let auth: ReturnType<typeof createAuthService>;
  let sessionId: SessionId;

  beforeEach(async () => {
    await insertStaff({
      email: EMAIL,
      id: TARGET_ID,
      passwordHash: await hashPassword(PASSWORD, CONFIG.pbkdf2Iterations),
      role: "staff",
    });
    auth = createAuthService({
      config: CONFIG,
      repository: createTenantRepository(env.DB),
    });
    const login = await auth.login({ email: EMAIL, password: PASSWORD });
    sessionId = login.sessionId;
    await expect(auth.resolveSession(sessionId)).resolves.toBeTruthy();
  });

  it("ログイン済み職員を無効化すると既存セッションが削除される", async () => {
    await service().update(TARGET_ID, ACTOR, { isActive: false });

    const row = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .staffUsers.findOne(whereFieldEquals("staff_users", "id", TARGET_ID));
    expect(row?.isActive).toBe(false);
    await expect(auth.resolveSession(sessionId)).resolves.toBeNull();

    const remaining = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .sessions.find(whereFieldEquals("sessions", "staffUserId", TARGET_ID));
    expect(remaining).toHaveLength(0);
  });

  it("再有効化しても、無効化前に発行された古いCookie(セッション)では認証できない", async () => {
    await service().update(TARGET_ID, ACTOR, { isActive: false });
    await service().update(TARGET_ID, ACTOR, { isActive: true });

    await expect(auth.resolveSession(sessionId)).resolves.toBeNull();
  });

  it("再有効化後に新しくログインすれば利用できる", async () => {
    await service().update(TARGET_ID, ACTOR, { isActive: false });
    await service().update(TARGET_ID, ACTOR, { isActive: true });

    const relogin = await auth.login({ email: EMAIL, password: PASSWORD });
    expect(relogin.sessionId).not.toBe(sessionId);
    await expect(auth.resolveSession(relogin.sessionId)).resolves.toBeTruthy();
  });

  it("無効化以外の更新(氏名変更)では既存セッションを削除しない", async () => {
    await service().update(TARGET_ID, ACTOR, { name: "改名済み" });

    await expect(auth.resolveSession(sessionId)).resolves.toBeTruthy();
  });
});
