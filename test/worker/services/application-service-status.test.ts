import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTenantRepository,
  whereFieldEquals,
} from "../../../src/worker/db/repositories";
import type { members } from "../../../src/worker/db/schema";
import { createApplicationService } from "../../../src/worker/services/application-service";
import {
  type AppConfig,
  type ApplicationField,
  type ApplicationId,
  type MemberId,
  toApplicationId,
  toMemberId,
  toSessionId,
  toStaffUserId,
  toTenantId,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-application-service-status");
const STAFF_ID = toStaffUserId("application-service-status-staff");
const APPLICATION_ID = toApplicationId(
  "application-service-status-application",
);

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
  sessionId: toSessionId("session-application-service-status"),
  user: {
    email: "staff@example.test",
    id: STAFF_ID,
    isActive: true,
    name: "窓口 花子",
    role: "staff" as const,
  },
};

const FIELDS: ApplicationField[] = [
  { confidence: 0.98, edited: false, label: "氏名", value: "山田太郎" },
];

const testEnvironment = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
};

type MemberInsert = typeof members.$inferInsert;

function service(config: AppConfig = CONFIG) {
  return createApplicationService({
    config,
    repository: createTenantRepository(env.DB),
  });
}

async function insertApplication(
  overrides: Partial<{
    appStatus: "received" | "under_review" | "approved" | "returned";
    id: ApplicationId;
    memberId: MemberId | null;
  }> = {},
) {
  const id = overrides.id ?? APPLICATION_ID;
  // 既定IDを再利用するテストが状態を差し替えられるよう、事前に同じIDの行を消す
  // （business-check.test.tsのinsertApplicationと同じ方針）。
  await env.DB.prepare(
    "UPDATE applications SET latest_check_run_id = NULL WHERE id = ?",
  )
    .bind(id)
    .run();
  await env.DB.prepare("DELETE FROM check_runs WHERE application_id = ?")
    .bind(id)
    .run();
  await env.DB.prepare("DELETE FROM applications WHERE id = ?").bind(id).run();
  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .applications.insert({
      appStatus: overrides.appStatus ?? "received",
      createdById: STAFF_ID,
      docType: "利用者登録申請書",
      editedCount: 0,
      fieldsJson: JSON.stringify(FIELDS),
      id,
      imageKey: null,
      latestCheckRunId: null,
      memberId: overrides.memberId ?? null,
      processingSec: 1.5,
      updatedById: null,
    });
  return id;
}

let memberSequence = 0;

async function insertMember(
  overrides: Partial<{ status: "pending" | "active" }> = {},
) {
  memberSequence += 1;
  const id = toMemberId(`member-${memberSequence}`);
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
      memberNumber: String(memberSequence),
      name: "山田太郎",
      nameKana: "ヤマダ",
      nameNormalized: "山田太郎",
      phone: `0000000${String(memberSequence).padStart(4, "0")}`,
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
  memberSequence = 0;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO tenants (id, code, name) VALUES (?, ?, ?)",
  )
    .bind(TENANT_ID, TENANT_ID, TENANT_ID)
    .run();
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
  await insertApplication();
});

describe("changeStatus (api.md #11・F-4-1〜4)", () => {
  it.each([
    ["received", "under_review"],
    ["under_review", "approved"],
    ["under_review", "returned"],
    ["returned", "under_review"],
  ] as const)("allows %s → %s and records history", async (from, to) => {
    await insertApplication({ appStatus: from });

    const result = await service().changeStatus(APPLICATION_ID, ACTOR, {
      toStatus: to,
    });

    expect(result.application.appStatus).toBe(to);
    const history = await env.DB.prepare(
      "SELECT from_status, to_status FROM app_status_history WHERE application_id = ?",
    )
      .bind(APPLICATION_ID)
      .all();
    expect(history.results).toEqual([{ from_status: from, to_status: to }]);
  });

  it.each([
    ["received", "approved"],
    ["received", "returned"],
    ["approved", "under_review"],
    ["approved", "returned"],
    ["returned", "approved"],
  ] as const)("rejects %s → %s with INVALID_TRANSITION", async (from, to) => {
    await insertApplication({ appStatus: from });

    await expect(
      service().changeStatus(APPLICATION_ID, ACTOR, { toStatus: to }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("promotes a pending linked member to active on approval and reports promotedMember (F-4-3)", async () => {
    const memberId = await insertMember({ status: "pending" });
    await insertApplication({ appStatus: "under_review", memberId });

    const result = await service().changeStatus(APPLICATION_ID, ACTOR, {
      toStatus: "approved",
    });

    expect(result.promotedMember).toMatchObject({
      id: memberId,
      status: "active",
    });
    const memberRow = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .members.findOne(whereFieldEquals("members", "id", memberId));
    expect(memberRow?.status).toBe("active");
    const statusHistory = await env.DB.prepare(
      "SELECT from_status, to_status FROM status_history WHERE member_id = ?",
    )
      .bind(memberId)
      .all();
    expect(statusHistory.results).toEqual([
      { from_status: "pending", to_status: "active" },
    ]);
  });

  it("does not report promotedMember when the linked member is already active", async () => {
    const memberId = await insertMember({ status: "active" });
    await insertApplication({ appStatus: "under_review", memberId });

    const result = await service().changeStatus(APPLICATION_ID, ACTOR, {
      toStatus: "approved",
    });

    expect(result.promotedMember).toBeNull();
  });

  it("does not report promotedMember when no member is linked", async () => {
    await insertApplication({ appStatus: "under_review" });

    const result = await service().changeStatus(APPLICATION_ID, ACTOR, {
      toStatus: "approved",
    });

    expect(result.promotedMember).toBeNull();
  });

  it("throws NOT_FOUND for a missing application", async () => {
    await expect(
      service().changeStatus(toApplicationId("missing"), ACTOR, {
        toStatus: "under_review",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
