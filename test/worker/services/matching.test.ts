import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTenantRepository,
  type TableRepository,
} from "../../../src/worker/db/repositories";
import type {
  applications,
  matchCandidates,
  members,
} from "../../../src/worker/db/schema";
import {
  findMatchCandidates,
  type TenantScope,
} from "../../../src/worker/services/matching";
import { normalizeMemberInput } from "../../../src/worker/services/member-normalizer";
import {
  toApplicationId,
  toMatchCandidateId,
  toMemberId,
  toStaffUserId,
  toTenantId,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-matching");
const OTHER_TENANT_ID = toTenantId("tenant-matching-other");
const STAFF_ID = toStaffUserId("matching-staff");
const APPLICATION_ID = toApplicationId("matching-application");
const OTHER_APPLICATION_ID = toApplicationId("matching-application-other");

const testEnvironment = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
};

type MemberInsert = typeof members.$inferInsert;
type ApplicationInsert = typeof applications.$inferInsert;
type MatchCandidateInsert = typeof matchCandidates.$inferInsert;

let memberSequence = 0;

function memberRepo(tenantId = TENANT_ID) {
  return createTenantRepository(env.DB).forTenant(tenantId)
    .members as unknown as TableRepository<MemberInsert, MemberInsert>;
}

async function insertMember(
  overrides: Partial<{
    name: string;
    nameKana: string | null;
    birthDate: string | null;
    address: string | null;
    phone: string;
  }>,
  tenantId = TENANT_ID,
) {
  memberSequence += 1;
  const raw = {
    address: overrides.address ?? null,
    birthDate: overrides.birthDate ?? null,
    name: overrides.name ?? "無関係 太郎",
    nameKana: overrides.nameKana ?? null,
    phone:
      overrides.phone ?? `0000000${String(memberSequence).padStart(4, "0")}`,
  };
  const normalized = normalizeMemberInput(raw);
  const id = toMemberId(`member-${memberSequence}`);

  await memberRepo(tenantId).insert({
    address: raw.address,
    birthDate: normalized.birthDateNormalized,
    createdById: null,
    email: null,
    id,
    isSeed: false,
    kanaNormalized: normalized.kanaNormalized,
    memberNumber: String(memberSequence),
    name: raw.name,
    nameKana: raw.nameKana,
    nameNormalized: normalized.nameNormalized,
    phone: normalized.phoneNormalized ?? raw.phone,
    postalCode: null,
    status: "active",
    updatedById: null,
  } as unknown as MemberInsert);

  return id;
}

async function insertMatchCandidate(
  memberId: ReturnType<typeof toMemberId>,
  status: "pending" | "merged" | "rejected" | "hold",
  applicationId: ReturnType<typeof toApplicationId> = APPLICATION_ID,
) {
  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .matchCandidates.insert({
      aiLikelihood: null,
      aiReason: null,
      applicationId,
      decidedAt: null,
      decidedById: null,
      id: toMatchCandidateId(`candidate-${memberId}-${applicationId}`),
      memberId,
      ruleScore: 0,
      status,
    } as unknown as MatchCandidateInsert);
}

async function insertApplication(id: ReturnType<typeof toApplicationId>) {
  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .applications.insert({
      appStatus: "received",
      createdById: STAFF_ID,
      docType: "利用者登録申請書",
      editedCount: 0,
      fieldsJson: "[]",
      id,
      imageKey: null,
      latestCheckRunId: null,
      memberId: null,
      processingSec: 1.5,
      updatedById: null,
    } as unknown as ApplicationInsert);
}

function scope(applicationId = APPLICATION_ID): TenantScope {
  return {
    applicationId,
    repositories: createTenantRepository(env.DB).forTenant(TENANT_ID),
  };
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnvironment.TEST_MIGRATIONS);
});

beforeEach(async () => {
  memberSequence = 0;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO tenants (id, code, name) VALUES (?, ?, ?)",
  )
    .bind(TENANT_ID, TENANT_ID, TENANT_ID)
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO tenants (id, code, name) VALUES (?, ?, ?)",
  )
    .bind(OTHER_TENANT_ID, OTHER_TENANT_ID, OTHER_TENANT_ID)
    .run();
  await env.DB.prepare("DELETE FROM match_candidates").run();
  await env.DB.prepare("DELETE FROM applications").run();
  await env.DB.prepare("DELETE FROM members").run();
  await env.DB.prepare("DELETE FROM staff_users").run();

  await createTenantRepository(env.DB).forTenant(TENANT_ID).staffUsers.insert({
    createdById: null,
    email: "staff@example.test",
    failedLoginCount: 0,
    id: STAFF_ID,
    isActive: true,
    lockedUntil: null,
    name: "窓口 花子",
    passwordHash: "unused",
    role: "staff",
    updatedById: null,
  });

  await insertApplication(APPLICATION_ID);
});

describe("findMatchCandidates — scoring (F-6-3・F-6-4)", () => {
  it("scores kana + birth date match as a candidate", async () => {
    const memberId = await insertMember({
      birthDate: "1980-01-01",
      name: "仙台 一郎",
      nameKana: "センダイ イチロウ",
    });

    const input = normalizeMemberInput({
      birthDate: "1980-01-01",
      name: "別人 太郎",
      nameKana: "せんだい いちろう",
      phone: null,
    });

    const result = await findMatchCandidates(scope(), input);

    expect(result).toHaveLength(1);
    expect(result[0]?.member.id).toBe(memberId);
    expect(result[0]?.breakdown).toEqual({
      kanaAndBirthDate: true,
      name: false,
      phone: false,
      total: 60,
    });
  });

  it("scores a phone match as a candidate", async () => {
    const memberId = await insertMember({
      name: "無関係",
      phone: "0300002222",
    });

    const input = normalizeMemberInput({
      birthDate: null,
      name: "別の名前",
      nameKana: null,
      phone: "03-0000-2222",
    });

    const result = await findMatchCandidates(scope(), input);

    expect(result).toHaveLength(1);
    expect(result[0]?.member.id).toBe(memberId);
    expect(result[0]?.breakdown.phone).toBe(true);
    expect(result[0]?.ruleScore).toBe(60);
  });

  it("scores a normalized name match as a candidate regardless of address", async () => {
    const memberId = await insertMember({
      address: "宮城県仙台市青葉区中央1丁目",
      name: "青葉 花子",
    });

    const input = normalizeMemberInput({
      birthDate: null,
      name: "青葉 花子",
      nameKana: null,
      phone: null,
    });

    const result = await findMatchCandidates(scope(), input);

    expect(result).toHaveLength(1);
    expect(result[0]?.member.id).toBe(memberId);
    expect(result[0]?.breakdown).toEqual({
      kanaAndBirthDate: false,
      name: true,
      phone: false,
      total: 30,
    });
  });

  it("excludes a member that matches none of the three conditions", async () => {
    await insertMember({
      birthDate: "1980-01-01",
      name: "無関係 花子",
      nameKana: "ムカンケイ ハナコ",
      phone: "0300009999",
    });

    const input = normalizeMemberInput({
      birthDate: "1992-11-03",
      name: "別人 太郎",
      nameKana: "ベツジン タロウ",
      phone: "0450001111",
    });

    const result = await findMatchCandidates(scope(), input);

    expect(result).toHaveLength(0);
  });

  it("orders candidates by descending total score", async () => {
    const low = await insertMember({ name: "低スコア", phone: "0300000002" });
    const high = await insertMember({
      birthDate: "1980-01-01",
      name: "高スコア",
      nameKana: "コウスコア",
      phone: "0300000002",
    });

    const input = normalizeMemberInput({
      birthDate: "1980-01-01",
      name: "高スコア",
      nameKana: "コウスコア",
      phone: "0300000002",
    });

    const result = await findMatchCandidates(scope(), input);

    expect(result.map((candidate) => candidate.member.id)).toEqual([high, low]);
    expect(result[0]?.ruleScore).toBeGreaterThan(result[1]?.ruleScore ?? 0);
  });
});

describe("findMatchCandidates — top 5 cap (F-6-4)", () => {
  it("returns at most 5 candidates even when more members match", async () => {
    const sharedPhone = "0300005555";
    for (let index = 0; index < 7; index += 1) {
      await insertMember({ name: `重複会員${index}`, phone: sharedPhone });
    }

    const input = normalizeMemberInput({
      birthDate: null,
      name: "問い合わせ",
      nameKana: null,
      phone: sharedPhone,
    });

    const result = await findMatchCandidates(scope(), input);

    expect(result).toHaveLength(5);
  });

  it("breaks ties deterministically by member id when 6+ candidates share the same score", async () => {
    const sharedPhone = "0300005556";
    const memberIds = [];
    for (let index = 0; index < 6; index += 1) {
      memberIds.push(
        await insertMember({ name: `同点会員${index}`, phone: sharedPhone }),
      );
    }
    const sortedIds = [...memberIds].sort((a, b) => a.localeCompare(b));

    const input = normalizeMemberInput({
      birthDate: null,
      name: "問い合わせ",
      nameKana: null,
      phone: sharedPhone,
    });

    const first = await findMatchCandidates(scope(), input);
    const second = await findMatchCandidates(scope(), input);

    expect(first.map((candidate) => candidate.member.id)).toEqual(
      sortedIds.slice(0, 5),
    );
    expect(second.map((candidate) => candidate.member.id)).toEqual(
      first.map((candidate) => candidate.member.id),
    );
  });
});

describe("findMatchCandidates — tenant isolation (NF-5)", () => {
  it("does not return members belonging to another tenant", async () => {
    await insertMember(
      { name: "他テナント", phone: "0300007777" },
      OTHER_TENANT_ID,
    );

    const input = normalizeMemberInput({
      birthDate: null,
      name: "無関係",
      nameKana: null,
      phone: "0300007777",
    });

    const result = await findMatchCandidates(scope(), input);

    expect(result).toHaveLength(0);
  });
});

describe("findMatchCandidates — rejected candidates (F-6-10)", () => {
  it("does not return a member already rejected for this application", async () => {
    const memberId = await insertMember({
      name: "却下済み",
      phone: "0300008888",
    });
    await insertMatchCandidate(memberId, "rejected");

    const input = normalizeMemberInput({
      birthDate: null,
      name: "無関係",
      nameKana: null,
      phone: "0300008888",
    });

    const result = await findMatchCandidates(scope(), input);

    expect(result).toHaveLength(0);
  });

  it("still returns a member whose existing candidate is only pending", async () => {
    const memberId = await insertMember({
      name: "保留中",
      phone: "0300006666",
    });
    await insertMatchCandidate(memberId, "pending");

    const input = normalizeMemberInput({
      birthDate: null,
      name: "無関係",
      nameKana: null,
      phone: "0300006666",
    });

    const result = await findMatchCandidates(scope(), input);

    expect(result).toHaveLength(1);
    expect(result[0]?.member.id).toBe(memberId);
  });

  it("returns a member rejected for a different application", async () => {
    await insertApplication(OTHER_APPLICATION_ID);
    const memberId = await insertMember({
      name: "他申請却下済み",
      phone: "0300004444",
    });
    await insertMatchCandidate(memberId, "rejected", OTHER_APPLICATION_ID);

    const input = normalizeMemberInput({
      birthDate: null,
      name: "無関係",
      nameKana: null,
      phone: "0300004444",
    });

    const result = await findMatchCandidates(scope(), input);

    expect(result).toHaveLength(1);
    expect(result[0]?.member.id).toBe(memberId);
  });
});
