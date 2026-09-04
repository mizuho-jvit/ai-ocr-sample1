import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTenantRepository,
  whereFieldEquals,
} from "../../../src/worker/db/repositories";
import type { checkRuns, members } from "../../../src/worker/db/schema";
import { createApplicationService } from "../../../src/worker/services/application-service";
import {
  type AppConfig,
  type ApplicationField,
  type ApplicationId,
  type MemberId,
  type StaffUserId,
  toApplicationId,
  toMemberId,
  toSessionId,
  toStaffUserId,
  toTenantId,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-application-service-read");
const OTHER_TENANT_ID = toTenantId("tenant-application-service-read-other");
const STAFF_ID = toStaffUserId("application-service-read-staff");
const APPLICATION_ID = toApplicationId("application-service-read-application");

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
  sessionId: toSessionId("session-application-service-read"),
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
  { confidence: 0.6, edited: false, label: "電話番号", value: "0300001111" },
];

const testEnvironment = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
};

type MemberInsert = typeof members.$inferInsert;
type CheckRunInsert = typeof checkRuns.$inferInsert;

function service(config: AppConfig = CONFIG) {
  return createApplicationService({
    config,
    repository: createTenantRepository(env.DB),
  });
}

async function insertApplication(
  overrides: Partial<{
    appStatus: "received" | "under_review" | "approved" | "returned";
    createdById: StaffUserId;
    fields: ApplicationField[];
    id: ApplicationId;
    memberId: MemberId | null;
    tenantId: ReturnType<typeof toTenantId>;
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
    .forTenant(overrides.tenantId ?? TENANT_ID)
    .applications.insert({
      appStatus: overrides.appStatus ?? "received",
      createdById: overrides.createdById ?? STAFF_ID,
      docType: "利用者登録申請書",
      editedCount: 0,
      fieldsJson: JSON.stringify(overrides.fields ?? FIELDS),
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

async function insertCheckRun(
  applicationId: ApplicationId,
  overrides: Partial<{
    triage: "approval_candidate" | "needs_review" | "return_candidate";
  }> = {},
) {
  const id = `check-run-${crypto.randomUUID()}`;
  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .checkRuns.insert({
      applicationId,
      consistencyJson: "[]",
      createdById: STAFF_ID,
      deficienciesJson: "[]",
      id,
      letterDraft: null,
      triage: overrides.triage ?? "approval_candidate",
      triageReason: "テスト",
    } as unknown as CheckRunInsert);
  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .applications.update(
      { latestCheckRunId: id as never },
      whereFieldEquals("applications", "id", applicationId),
    );
  return id;
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

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnvironment.TEST_MIGRATIONS);
});

beforeEach(async () => {
  memberSequence = 0;
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
  await insertApplication();
});

describe("get (api.md #9・F-4-5)", () => {
  it("returns the ApplicationDetail for an existing application", async () => {
    const detail = await service().get(APPLICATION_ID);
    expect(detail.id).toBe(APPLICATION_ID);
    expect(detail.fields).toEqual(FIELDS);
  });

  it("throws NOT_FOUND for a missing application", async () => {
    await expect(
      service().get(toApplicationId("missing")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND for another tenant's application (NF-5-16)", async () => {
    const otherId = toApplicationId("other-tenant-application");
    await insertApplication({ id: otherId, tenantId: OTHER_TENANT_ID });

    await expect(service().get(otherId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("list (api.md #7・F-4-10・F-4-11)", () => {
  it("returns items sorted newest-first with total/page/perPage", async () => {
    const older = toApplicationId("application-older");
    await insertApplication({ id: older });
    await env.DB.prepare(
      "UPDATE applications SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?",
    )
      .bind(older)
      .run();
    await env.DB.prepare(
      "UPDATE applications SET created_at = '2030-01-01T00:00:00.000Z' WHERE id = ?",
    )
      .bind(APPLICATION_ID)
      .run();

    const result = await service().list({});

    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.perPage).toBe(20);
    expect(result.items.map((item) => item.id)).toEqual([
      APPLICATION_ID,
      older,
    ]);
    expect(result.items[0]?.createdBy.id).toBe(STAFF_ID);
  });

  it("filters by appStatus", async () => {
    const approved = toApplicationId("application-approved");
    await insertApplication({ appStatus: "approved", id: approved });

    const result = await service().list({ appStatus: "approved" });

    expect(result.items.map((item) => item.id)).toEqual([approved]);
  });

  it("filters by triage using the latest check run", async () => {
    await insertCheckRun(APPLICATION_ID, { triage: "return_candidate" });
    const other = toApplicationId("application-needs-review");
    await insertApplication({ id: other });
    await insertCheckRun(other, { triage: "needs_review" });

    const result = await service().list({ triage: "needs_review" });

    expect(result.items.map((item) => item.id)).toEqual([other]);
    expect(result.items[0]?.triage).toBe("needs_review");
  });

  it("filters by needsReviewOnly (決定: needs_reviewトリアージのみを対象とする)", async () => {
    await insertCheckRun(APPLICATION_ID, { triage: "approval_candidate" });
    const other = toApplicationId("application-needs-review-2");
    await insertApplication({ id: other });
    await insertCheckRun(other, { triage: "needs_review" });

    const result = await service().list({ needsReviewOnly: true });

    expect(result.items.map((item) => item.id)).toEqual([other]);
  });

  it("filters by createdById", async () => {
    const otherStaff = toStaffUserId("application-service-read-staff-2");
    await insertStaff(otherStaff, "受付 次郎");
    const other = toApplicationId("application-other-staff");
    await insertApplication({ createdById: otherStaff, id: other });

    const result = await service().list({ createdById: otherStaff });

    expect(result.items.map((item) => item.id)).toEqual([other]);
  });

  it("filters by linked (会員紐付けの有無)", async () => {
    const memberId = await insertMember();
    const linked = toApplicationId("application-linked");
    await insertApplication({ id: linked, memberId });

    const linkedResult = await service().list({ linked: true });
    const unlinkedResult = await service().list({ linked: false });

    expect(linkedResult.items.map((item) => item.id)).toEqual([linked]);
    expect(unlinkedResult.items.map((item) => item.id)).toEqual([
      APPLICATION_ID,
    ]);
  });

  it("paginates with page/perPage", async () => {
    for (let index = 0; index < 3; index += 1) {
      await insertApplication({
        id: toApplicationId(`application-page-${index}`),
      });
    }

    const result = await service().list({ page: 2, perPage: 2 });

    expect(result.total).toBe(4);
    expect(result.items).toHaveLength(2);
    expect(result.page).toBe(2);
    expect(result.perPage).toBe(2);
  });

  it("only returns the current tenant's applications (NF-5-16)", async () => {
    await insertApplication({
      id: toApplicationId("other-tenant-list-application"),
      tenantId: OTHER_TENANT_ID,
    });

    const result = await service().list({});

    expect(result.items.map((item) => item.id)).toEqual([APPLICATION_ID]);
  });
});

describe("updateFields (api.md #10・F-4-5)", () => {
  it("updates values, marks edited fields, recomputes editedCount, and leaves confidence untouched", async () => {
    const detail = await service().updateFields(APPLICATION_ID, ACTOR, {
      fields: [
        { label: "氏名", value: "山田次郎" },
        { label: "電話番号", value: "0300001111" },
      ],
    });

    expect(detail.fields).toEqual([
      { confidence: 0.98, edited: true, label: "氏名", value: "山田次郎" },
      {
        confidence: 0.6,
        edited: false,
        label: "電話番号",
        value: "0300001111",
      },
    ]);
    expect(detail.editedCount).toBe(1);
    expect(detail.updatedBy?.id).toBe(STAFF_ID);
  });

  it("keeps a field's edited flag true even if a later request restores the original value", async () => {
    await service().updateFields(APPLICATION_ID, ACTOR, {
      fields: [{ label: "氏名", value: "山田次郎" }],
    });

    const detail = await service().updateFields(APPLICATION_ID, ACTOR, {
      fields: [{ label: "氏名", value: "山田太郎" }],
    });

    expect(detail.fields[0]).toMatchObject({
      edited: true,
      value: "山田太郎",
    });
    expect(detail.editedCount).toBe(1);
  });

  it("throws NOT_FOUND for a missing application", async () => {
    await expect(
      service().updateFields(toApplicationId("missing"), ACTOR, {
        fields: [],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
