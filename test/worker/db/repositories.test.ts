import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import {
  createTenantRepository,
  initializeTenantRepository,
  whereFieldEquals,
} from "../../../src/worker/db/repositories";
import {
  type AppConfig,
  type MemberId,
  toMemberId,
  toTenantId,
} from "../../../src/worker/types";

const TENANT_A = toTenantId("tenant-a");
const TENANT_B = toTenantId("tenant-b");

const CONFIG: AppConfig = {
  aiGatewayAccountId: "test-ai-gateway-account",
  aiGatewayId: "test-ai-gateway-id",
  r2AccountId: "test-r2-account",
  allowDataReset: true,
  geminiModel: "gemini-3.1-flash-lite",
  maxCheckRunsPerApplication: 5,
  maxGeminiCallsPerMonth: 720,
  maxOcrPagesPerMonth: 120,
  ocrPipelineMode: "gemini",
  pbkdf2Iterations: 20_000,
  tenantId: TENANT_A,
};

const testEnvironment = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
};

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnvironment.TEST_MIGRATIONS);
});

describe("tenant startup validation", () => {
  it("accepts one configured tenant and rejects zero or multiple tenants", async () => {
    await expect(
      initializeTenantRepository(env.DB, CONFIG),
    ).rejects.toThrowError("TENANT_ID");

    await env.DB.prepare(
      "INSERT INTO tenants (id, code, name) VALUES (?, ?, ?)",
    )
      .bind("tenant-a", "tenant-a", "Tenant A")
      .run();
    await expect(initializeTenantRepository(env.DB, CONFIG)).resolves.toEqual(
      expect.objectContaining({ forTenant: expect.any(Function) }),
    );

    await env.DB.prepare(
      "INSERT INTO tenants (id, code, name) VALUES (?, ?, ?)",
    )
      .bind("tenant-b", "tenant-b", "Tenant B")
      .run();
    await expect(
      initializeTenantRepository(env.DB, CONFIG),
    ).rejects.toThrowError("exactly one Tenant");
  });
});

describe("TenantRepository", () => {
  it("keeps select, update, and delete inside the selected tenant", async () => {
    const repository = createTenantRepository(env.DB);
    const tenantA = repository.forTenant(TENANT_A);
    const tenantB = repository.forTenant(TENANT_B);

    const memberA = toMemberId("member-a");
    const memberB = toMemberId("member-b");

    await tenantA.members.insert(memberValues(memberA, "A-1", "Member A"));
    await tenantB.members.insert(memberValues(memberB, "B-1", "Member B"));

    expect((await tenantA.members.all()).map((member) => member.id)).toEqual([
      memberA,
    ]);
    expect((await tenantB.members.all()).map((member) => member.id)).toEqual([
      memberB,
    ]);

    const sameName = whereFieldEquals("members", "name", "Member B");
    await tenantA.members.update({ status: "inactive" }, sameName);
    await tenantA.members.delete(sameName);

    const tenantBMember = await tenantB.members.findOne(
      whereFieldEquals("members", "id", memberB),
    );
    expect(tenantBMember?.status).toBe("active");
  });

  it("find() returns every matching row within the tenant, unlike findOne()", async () => {
    const repository = createTenantRepository(env.DB);
    const tenantA = repository.forTenant(TENANT_A);
    const tenantB = repository.forTenant(TENANT_B);

    const memberA1 = toMemberId("member-a-shared-1");
    const memberA2 = toMemberId("member-a-shared-2");
    const memberB = toMemberId("member-b-shared");

    await tenantA.members.insert(
      memberValues(memberA1, "A-shared-1", "共有氏名"),
    );
    await tenantA.members.insert(
      memberValues(memberA2, "A-shared-2", "共有氏名"),
    );
    await tenantB.members.insert(memberValues(memberB, "B-shared", "共有氏名"));

    const sharedName = whereFieldEquals(
      "members",
      "nameNormalized",
      "共有氏名",
    );

    expect(
      (await tenantA.members.find(sharedName))
        .map((member) => member.id)
        .sort(),
    ).toEqual([memberA1, memberA2].sort());

    const single = await tenantA.members.findOne(sharedName);
    expect(single).not.toBeNull();
  });

  it("does not expose the global usage counter as a tenant repository", () => {
    type Repositories = ReturnType<
      ReturnType<typeof createTenantRepository>["forTenant"]
    >;

    expectTypeOf<Repositories>().not.toHaveProperty("usageCounter");
  });
});

function memberValues(id: MemberId, memberNumber: string, name: string) {
  return {
    address: null,
    birthDate: null,
    createdById: null,
    email: null,
    id,
    isSeed: false,
    kanaNormalized: "",
    memberNumber,
    name,
    nameKana: null,
    nameNormalized: name,
    phone: "0000000000",
    postalCode: null,
    status: "active" as const,
    updatedById: null,
  };
}
