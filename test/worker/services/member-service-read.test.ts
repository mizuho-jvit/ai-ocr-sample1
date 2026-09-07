import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTenantRepository } from "../../../src/worker/db/repositories";
import type { matchCandidates, members } from "../../../src/worker/db/schema";
import { createMemberService } from "../../../src/worker/services/member-service";
import {
  type AppConfig,
  type ApplicationId,
  type MatchStatus,
  type MemberId,
  type MemberStatus,
  type StaffUserId,
  toApplicationId,
  toMemberId,
  toStaffUserId,
  toTenantId,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-member-service-read");
const OTHER_TENANT_ID = toTenantId("tenant-member-service-read-other");
const STAFF_ID = toStaffUserId("member-service-read-staff");
const MEMBER_ID = toMemberId("member-service-read-member");

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

const testEnvironment = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
};

type MemberInsert = typeof members.$inferInsert;
type MatchCandidateInsert = typeof matchCandidates.$inferInsert;

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
    tenantId: ReturnType<typeof toTenantId>;
    name: string;
    nameKana: string | null;
    nameNormalized: string;
    kanaNormalized: string;
    birthDate: string | null;
    phone: string;
    status: MemberStatus;
    memberNumber: string;
  }> = {},
) {
  const id = overrides.id ?? MEMBER_ID;
  await createTenantRepository(env.DB)
    .forTenant(overrides.tenantId ?? TENANT_ID)
    .members.insert({
      address: null,
      birthDate: overrides.birthDate ?? null,
      createdById: null,
      email: null,
      id,
      isSeed: false,
      kanaNormalized: overrides.kanaNormalized ?? "ヤマダ",
      memberNumber: overrides.memberNumber ?? "1",
      name: overrides.name ?? "山田太郎",
      nameKana: overrides.nameKana ?? "ヤマダ",
      nameNormalized: overrides.nameNormalized ?? overrides.name ?? "山田太郎",
      phone: overrides.phone ?? "09012345678",
      postalCode: null,
      status: overrides.status ?? "active",
      updatedById: null,
    } as unknown as MemberInsert);
  return id;
}

async function insertApplication(
  id: ApplicationId,
  overrides: Partial<{
    memberId: MemberId | null;
    tenantId: ReturnType<typeof toTenantId>;
  }> = {},
) {
  await env.DB.prepare(
    "UPDATE applications SET latest_check_run_id = NULL WHERE id = ?",
  )
    .bind(id)
    .run();
  await env.DB.prepare("DELETE FROM applications WHERE id = ?").bind(id).run();
  await createTenantRepository(env.DB)
    .forTenant(overrides.tenantId ?? TENANT_ID)
    .applications.insert({
      appStatus: "received",
      createdById: STAFF_ID,
      docType: "利用者登録申請書",
      editedCount: 0,
      fieldsJson: "[]",
      id,
      imageKey: null,
      latestCheckRunId: null,
      memberId: overrides.memberId ?? null,
      processingSec: 1.5,
      updatedById: null,
    });
}

async function insertMatchCandidate(
  overrides: Partial<{
    id: string;
    applicationId: ApplicationId;
    memberId: MemberId;
    status: MatchStatus;
    tenantId: ReturnType<typeof toTenantId>;
  }> = {},
) {
  await createTenantRepository(env.DB)
    .forTenant(overrides.tenantId ?? TENANT_ID)
    .matchCandidates.insert({
      aiLikelihood: null,
      aiReason: null,
      applicationId: overrides.applicationId ?? toApplicationId("app-mc"),
      decidedAt: null,
      decidedById: null,
      id: overrides.id ?? crypto.randomUUID(),
      memberId: overrides.memberId ?? MEMBER_ID,
      ruleScore: 30,
      status: overrides.status ?? "pending",
    } as unknown as MatchCandidateInsert);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnvironment.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const tenantId of [TENANT_ID, OTHER_TENANT_ID]) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO tenants (id, code, name) VALUES (?, ?, ?)",
    )
      .bind(tenantId, tenantId, tenantId)
      .run();
  }
  await env.DB.prepare(
    "UPDATE applications SET latest_check_run_id = NULL",
  ).run();
  await env.DB.prepare("DELETE FROM match_candidates").run();
  await env.DB.prepare("DELETE FROM check_runs").run();
  await env.DB.prepare("DELETE FROM app_status_history").run();
  await env.DB.prepare("DELETE FROM status_history").run();
  await env.DB.prepare("DELETE FROM applications").run();
  await env.DB.prepare("DELETE FROM members").run();
  await env.DB.prepare("DELETE FROM staff_users").run();

  await insertStaff(STAFF_ID);
});

describe("get (api.md #21・F-5-6)", () => {
  it("returns MemberDetail with applications and status history", async () => {
    await insertMember();
    const applicationId = toApplicationId("member-service-application");
    await insertApplication(applicationId, { memberId: MEMBER_ID });

    const detail = await service().get(MEMBER_ID);

    expect(detail.id).toBe(MEMBER_ID);
    expect(detail.applications.map((application) => application.id)).toEqual([
      applicationId,
    ]);
    expect(detail.applications[0]?.hasImage).toBe(false);
    expect(detail.statusHistory).toEqual([]);
  });

  it("throws NOT_FOUND for a missing member", async () => {
    await expect(service().get(toMemberId("missing"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws NOT_FOUND for another tenant's member (NF-5-16)", async () => {
    const otherId = toMemberId("other-tenant-member");
    await insertMember({ id: otherId, tenantId: OTHER_TENANT_ID });

    await expect(service().get(otherId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("list (api.md #19・F-5-4・F-5-5)", () => {
  it("returns items sorted by memberNumber with total/page/perPage", async () => {
    await insertMember({ memberNumber: "2", name: "会員2" });
    await insertMember({
      id: toMemberId("member-1"),
      memberNumber: "1",
      name: "会員1",
    });

    const result = await service().list({});

    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.memberNumber)).toEqual(["1", "2"]);
  });

  it("finds a member by an old-form kanji variant via q (表記ゆれ検索・F-5-5)", async () => {
    await insertMember({
      name: "仙臺 一郎",
      nameNormalized: "仙台一郎",
    });

    const result = await service().list({ q: "仙台" });

    expect(result.items).toHaveLength(1);
  });

  it("finds a member by kana via q", async () => {
    await insertMember({ kanaNormalized: "ヤマダタロウ" });

    const result = await service().list({ q: "タロウ" });

    expect(result.items).toHaveLength(1);
  });

  it("filters by exact birthDate, tolerating wareki input", async () => {
    await insertMember({ birthDate: "1980-03-10" });
    const other = toMemberId("member-other-birthdate");
    await insertMember({
      birthDate: "1990-01-01",
      id: other,
      memberNumber: "2",
    });

    const result = await service().list({ birthDate: "昭和55年3月10日" });

    expect(result.items.map((item) => item.id)).toEqual([MEMBER_ID]);
  });

  it("does not throw for an unparsable birthDate filter and returns no matches", async () => {
    await insertMember();

    const result = await service().list({ birthDate: "not-a-date" });

    expect(result.items).toEqual([]);
  });

  it("filters by exact phone, ignoring hyphens", async () => {
    await insertMember({ phone: "09011112222" });
    const other = toMemberId("member-other-phone");
    await insertMember({ id: other, memberNumber: "2", phone: "09033334444" });

    const result = await service().list({ phone: "090-1111-2222" });

    expect(result.items.map((item) => item.id)).toEqual([MEMBER_ID]);
  });

  it("does not throw for an unparsable phone filter and returns no matches", async () => {
    await insertMember();

    const result = await service().list({ phone: "abc" });

    expect(result.items).toEqual([]);
  });

  it("filters by status", async () => {
    await insertMember({ status: "active" });
    const suspended = toMemberId("member-suspended");
    await insertMember({
      id: suspended,
      memberNumber: "2",
      status: "suspended",
    });

    const result = await service().list({ status: "suspended" });

    expect(result.items.map((item) => item.id)).toEqual([suspended]);
  });

  it("paginates with page/perPage", async () => {
    for (let index = 0; index < 4; index += 1) {
      await insertMember({
        id: toMemberId(`member-page-${index}`),
        memberNumber: String(index + 1),
      });
    }

    const result = await service().list({ page: 2, perPage: 2 });

    expect(result.total).toBe(4);
    expect(result.items).toHaveLength(2);
    expect(result.page).toBe(2);
    expect(result.perPage).toBe(2);
  });

  it("only returns the current tenant's members (NF-5-16)", async () => {
    await insertMember();
    await insertMember({
      id: toMemberId("other-tenant-list-member"),
      tenantId: OTHER_TENANT_ID,
    });

    const result = await service().list({});

    expect(result.items.map((item) => item.id)).toEqual([MEMBER_ID]);
  });
});

describe("listMatchCandidates (api.md #16・F-5-9・重複疑いリスト)", () => {
  it("returns only pending/hold candidates across applications", async () => {
    await insertMember();
    const appPending = toApplicationId("app-pending");
    const appHold = toApplicationId("app-hold");
    const appMerged = toApplicationId("app-merged");
    const appRejected = toApplicationId("app-rejected");
    await insertApplication(appPending);
    await insertApplication(appHold);
    await insertApplication(appMerged);
    await insertApplication(appRejected);

    await insertMatchCandidate({
      applicationId: appPending,
      status: "pending",
    });
    await insertMatchCandidate({ applicationId: appHold, status: "hold" });
    await insertMatchCandidate({
      applicationId: appMerged,
      status: "merged",
    });
    await insertMatchCandidate({
      applicationId: appRejected,
      status: "rejected",
    });

    const result = await service().listMatchCandidates();

    expect(result).toHaveLength(2);
    expect(result.map((candidate) => candidate.status).sort()).toEqual([
      "hold",
      "pending",
    ]);
  });

  it("only returns the current tenant's candidates (NF-5-13)", async () => {
    await insertMember();
    const appId = toApplicationId("app-tenant-scope");
    await insertApplication(appId);
    await insertMatchCandidate({ applicationId: appId, status: "pending" });

    const otherMember = toMemberId("other-tenant-mc-member");
    await insertMember({ id: otherMember, tenantId: OTHER_TENANT_ID });
    const otherAppId = toApplicationId("app-tenant-scope-other");
    await insertApplication(otherAppId, { tenantId: OTHER_TENANT_ID });
    await insertMatchCandidate({
      applicationId: otherAppId,
      memberId: otherMember,
      status: "pending",
      tenantId: OTHER_TENANT_ID,
    });

    const result = await service().listMatchCandidates();

    expect(result).toHaveLength(1);
    expect(result[0]?.member.id).toBe(MEMBER_ID);
  });
});
