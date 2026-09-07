import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTenantRepository } from "../../../src/worker/db/repositories";
import type { members } from "../../../src/worker/db/schema";
import { createMemberService } from "../../../src/worker/services/member-service";
import {
  type AppConfig,
  type MemberId,
  type MemberStatus,
  type StaffUserId,
  toMemberId,
  toSessionId,
  toStaffUserId,
  toTenantId,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-member-service-write");
const STAFF_ID = toStaffUserId("member-service-write-staff");
const MEMBER_ID = toMemberId("member-service-write-member");

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
  sessionId: toSessionId("session-member-service-write"),
  user: {
    email: "staff@example.test",
    id: STAFF_ID,
    isActive: true,
    name: "窓口 花子",
    role: "staff" as const,
  },
};

const testEnvironment = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
};

type MemberInsert = typeof members.$inferInsert;

function service(config: AppConfig = CONFIG) {
  return createMemberService({
    config,
    repository: createTenantRepository(env.DB),
  });
}

async function insertStaff(id: StaffUserId, name = "窓口 花子") {
  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .staffUsers.insert({
      createdById: null,
      email: `${id}@example.test`,
      failedLoginCount: 0,
      id,
      isActive: true,
      lockedUntil: null,
      name,
      passwordHash: "unused",
      role: "staff",
      updatedById: null,
    });
}

async function insertMember(
  overrides: Partial<{
    id: MemberId;
    name: string;
    nameNormalized: string;
    phone: string;
    status: MemberStatus;
    memberNumber: string;
  }> = {},
) {
  const id = overrides.id ?? MEMBER_ID;
  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .members.insert({
      address: null,
      birthDate: null,
      createdById: null,
      email: null,
      id,
      isSeed: false,
      kanaNormalized: "ヤマダ",
      memberNumber: overrides.memberNumber ?? "1",
      name: overrides.name ?? "山田太郎",
      nameKana: "ヤマダ",
      nameNormalized: overrides.nameNormalized ?? overrides.name ?? "山田太郎",
      phone: overrides.phone ?? "09012345678",
      postalCode: null,
      status: overrides.status ?? "active",
      updatedById: null,
    } as unknown as MemberInsert);
  return id;
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
  await env.DB.prepare("DELETE FROM match_candidates").run();
  await env.DB.prepare("DELETE FROM status_history").run();
  await env.DB.prepare("DELETE FROM applications").run();
  await env.DB.prepare("DELETE FROM members").run();
  await env.DB.prepare("DELETE FROM staff_users").run();

  await insertStaff(STAFF_ID);
});

describe("create (api.md #20・F-5-1・NF-5-20)", () => {
  it("assigns a sequential memberNumber starting at 1 and recomputes normalized keys", async () => {
    const detail = await service().create(
      {
        name: "仙臺 一郎",
        nameKana: "せんだい いちろう",
        phone: "090-1234-5678",
        status: "pending",
      },
      ACTOR,
    );

    expect(detail.memberNumber).toBe("1");
    expect(detail.name).toBe("仙臺 一郎");
    expect(detail.phone).toBe("09012345678");

    const second = await service().create(
      { name: "会員2", phone: "08000000000", status: "pending" },
      ACTOR,
    );
    expect(second.memberNumber).toBe("2");
  });

  it("converts wareki birthDate to seireki before storing", async () => {
    const detail = await service().create(
      {
        birthDate: "昭和55年3月10日",
        name: "会員",
        phone: "09000000000",
        status: "pending",
      },
      ACTOR,
    );

    expect(detail.birthDate).toBe("1980-03-10");
  });

  it("throws VALIDATION_ERROR when phone has no digits after normalization", async () => {
    await expect(
      service().create(
        { name: "会員", phone: "電話なし", status: "pending" },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it(
    "assigns distinct sequential memberNumbers under concurrent creation " +
      "(NF-5-20・実装メモ: MAX+1採番の同時実行性)",
    async () => {
      const [first, second, third] = await Promise.all([
        service().create(
          { name: "並行1", phone: "09011110001", status: "pending" },
          ACTOR,
        ),
        service().create(
          { name: "並行2", phone: "09011110002", status: "pending" },
          ACTOR,
        ),
        service().create(
          { name: "並行3", phone: "09011110003", status: "pending" },
          ACTOR,
        ),
      ]);

      const numbers = [first, second, third]
        .map((detail) => detail.memberNumber)
        .sort();
      expect(numbers).toEqual(["1", "2", "3"]);
    },
  );
});

describe("update (api.md #22・F-5-1・F-6-2)", () => {
  it("updates a single field while leaving others unchanged", async () => {
    await insertMember({ name: "山田太郎", phone: "09012345678" });

    const detail = await service().update(MEMBER_ID, ACTOR, {
      address: "仙台市青葉区1-1-1",
    });

    expect(detail.address).toBe("仙台市青葉区1-1-1");
    expect(detail.name).toBe("山田太郎");
    expect(detail.phone).toBe("09012345678");
  });

  it("clears an optional field to null when updated with an empty string (コードレビュー指摘)", async () => {
    await insertMember();
    await service().update(MEMBER_ID, ACTOR, {
      address: "仙台市青葉区1-1-1",
    });

    const detail = await service().update(MEMBER_ID, ACTOR, { address: "" });

    expect(detail.address).toBeNull();
  });

  it("recomputes nameNormalized/kanaNormalized when name/nameKana change (F-6-2)", async () => {
    await insertMember({ name: "髙橋", nameNormalized: "髙橋" });

    const detail = await service().update(MEMBER_ID, ACTOR, {
      name: "髙橋一郎",
    });

    expect(detail.name).toBe("髙橋一郎");

    const raw = await env.DB.prepare(
      "SELECT name_normalized FROM members WHERE id = ?",
    )
      .bind(MEMBER_ID)
      .first<{ name_normalized: string }>();
    expect(raw?.name_normalized).toBe("高橋一郎");
  });

  it("throws NOT_FOUND for a missing member", async () => {
    await expect(
      service().update(toMemberId("missing"), ACTOR, { name: "会員" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws VALIDATION_ERROR when phone is updated to a value with no digits", async () => {
    await insertMember();

    await expect(
      service().update(MEMBER_ID, ACTOR, { phone: "なし" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("changeStatus (api.md #23・F-5-7・F-5-8)", () => {
  it("updates status and records reason/actor/timestamp in StatusHistory", async () => {
    await insertMember({ status: "active" });

    const detail = await service().changeStatus(MEMBER_ID, ACTOR, {
      reason: "退会申し出のため",
      toStatus: "inactive",
    });

    expect(detail.status).toBe("inactive");
    expect(detail.statusHistory).toHaveLength(1);
    expect(detail.statusHistory[0]).toMatchObject({
      fromStatus: "active",
      reason: "退会申し出のため",
      toStatus: "inactive",
    });
    expect(detail.statusHistory[0]?.createdBy.id).toBe(STAFF_ID);
  });

  it("does not physically delete the member when deactivating (F-5-8)", async () => {
    await insertMember({ status: "active" });

    await service().changeStatus(MEMBER_ID, ACTOR, {
      reason: "退会",
      toStatus: "inactive",
    });

    const raw = await env.DB.prepare("SELECT id FROM members WHERE id = ?")
      .bind(MEMBER_ID)
      .first();
    expect(raw).not.toBeNull();
  });

  it("throws NOT_FOUND for a missing member", async () => {
    await expect(
      service().changeStatus(toMemberId("missing"), ACTOR, {
        reason: "理由",
        toStatus: "inactive",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
