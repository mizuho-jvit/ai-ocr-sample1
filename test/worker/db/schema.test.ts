import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTenantRepository } from "../../../src/worker/db/repositories";
import type { members } from "../../../src/worker/db/schema";
import { toMemberId, toTenantId } from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-schema");

type MemberInsert = typeof members.$inferInsert;

const testEnvironment = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
};

let memberSequence = 0;

function baseMember(
  overrides: Partial<{ phone: string; birthDate: string | null }>,
): Omit<MemberInsert, "tenantId"> {
  memberSequence += 1;
  return {
    address: null,
    birthDate: overrides.birthDate ?? null,
    createdById: null,
    email: null,
    id: toMemberId(`schema-member-${memberSequence}`),
    isSeed: false,
    kanaNormalized: "",
    memberNumber: String(memberSequence),
    name: "スキーマ検証",
    nameKana: null,
    nameNormalized: "スキーマ検証",
    phone: overrides.phone ?? "09000000000",
    postalCode: null,
    status: "active",
    updatedById: null,
  } as unknown as Omit<MemberInsert, "tenantId">;
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
  await env.DB.prepare("DELETE FROM members").run();
});

/**
 * 🔵 Intent: matching.tsのscoreMemberはphone/birthDateがnormalizeMemberInputの出力形式で
 * あることを前提に生の値のまま比較する。この前提をDB側のCHECK制約でも強制しておくことで、
 * 将来normalizeMemberInputを経由しない書き込み経路（Task 011の登録・編集やTask 013の
 * CSVインポート）が追加されても、不正な形式は書き込み自体が失敗して即座に気づける。
 */
describe("members schema — phone/birthDate format constraints", () => {
  it("rejects a phone number that still has hyphens", async () => {
    const members = createTenantRepository(env.DB).forTenant(TENANT_ID).members;

    await expect(
      members.insert(baseMember({ phone: "090-0000-0000" })),
    ).rejects.toThrow();
  });

  it("rejects an empty phone number", async () => {
    const members = createTenantRepository(env.DB).forTenant(TENANT_ID).members;

    await expect(members.insert(baseMember({ phone: "" }))).rejects.toThrow();
  });

  it("accepts a digits-only phone number", async () => {
    const members = createTenantRepository(env.DB).forTenant(TENANT_ID).members;

    await expect(
      members.insert(baseMember({ phone: "09000000000" })),
    ).resolves.toEqual(expect.objectContaining({ phone: "09000000000" }));
  });

  it("rejects a birth date that is not YYYY-MM-DD", async () => {
    const members = createTenantRepository(env.DB).forTenant(TENANT_ID).members;

    await expect(
      members.insert(baseMember({ birthDate: "1980/01/01" })),
    ).rejects.toThrow();
  });

  it("rejects a birth date with unpadded month/day", async () => {
    const members = createTenantRepository(env.DB).forTenant(TENANT_ID).members;

    await expect(
      members.insert(baseMember({ birthDate: "1980-1-1" })),
    ).rejects.toThrow();
  });

  it("accepts a null birth date and a YYYY-MM-DD birth date", async () => {
    const members = createTenantRepository(env.DB).forTenant(TENANT_ID).members;

    await expect(
      members.insert(baseMember({ birthDate: null })),
    ).resolves.toEqual(expect.objectContaining({ birthDate: null }));
    await expect(
      members.insert(baseMember({ birthDate: "1980-01-01" })),
    ).resolves.toEqual(expect.objectContaining({ birthDate: "1980-01-01" }));
  });
});
