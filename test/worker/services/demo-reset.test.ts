import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createTenantRepository,
  whereFieldEquals,
} from "../../../src/worker/db/repositories";
import type { checkRuns, members } from "../../../src/worker/db/schema";
import { createDemoResetService } from "../../../src/worker/services/demo-reset";
import {
  type ImageStorage,
  PartialImageDeleteError,
} from "../../../src/worker/services/image-storage";
import {
  ApiErrorException,
  type AppConfig,
  type ApplicationField,
  type ApplicationId,
  type MemberId,
  toApplicationId,
  toImageKey,
  toMemberId,
  toSessionId,
  toStaffUserId,
  toTenantId,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-demo-reset");
const STAFF_ID = toStaffUserId("demo-reset-staff");
const APPLICATION_ID = toApplicationId("demo-reset-application");

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
  sessionId: toSessionId("session-demo-reset"),
  user: {
    email: "admin@example.test",
    id: STAFF_ID,
    isActive: true,
    name: "管理 太郎",
    role: "admin" as const,
  },
};

const FIELDS: ApplicationField[] = [
  { confidence: 0.98, edited: false, label: "氏名", value: "山田太郎" },
];

const testEnvironment = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
};

type MemberInsert = typeof members.$inferInsert;
type CheckRunInsert = typeof checkRuns.$inferInsert;

function fakeImageStorage(deletedCount = 0): ImageStorage {
  return {
    createSignedUrl: vi.fn(),
    delete: vi.fn(async () => undefined),
    deleteMany: vi.fn(async () => deletedCount),
    put: vi.fn(),
  } as unknown as ImageStorage;
}

function service(imageStorage: ImageStorage = fakeImageStorage()) {
  return createDemoResetService({
    config: CONFIG,
    imageStorage,
    repository: createTenantRepository(env.DB),
  });
}

async function insertApplication(
  overrides: Partial<{ id: ApplicationId; imageKey: string | null }> = {},
) {
  const id = overrides.id ?? APPLICATION_ID;
  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .applications.insert({
      appStatus: "received",
      createdById: STAFF_ID,
      docType: "利用者登録申請書",
      editedCount: 0,
      fieldsJson: JSON.stringify(FIELDS),
      id,
      imageKey:
        overrides.imageKey === undefined
          ? toImageKey(`${TENANT_ID}/${id}.jpg`)
          : (overrides.imageKey as never),
      latestCheckRunId: null,
      memberId: null,
      processingSec: 1.5,
      updatedById: null,
    });
  return id;
}

async function insertCheckRun(applicationId: ApplicationId) {
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
      triage: "approval_candidate",
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

async function insertAppStatusHistory(applicationId: ApplicationId) {
  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .appStatusHistory.insert({
      applicationId,
      createdById: STAFF_ID,
      fromStatus: null,
      id: `app-status-history-${crypto.randomUUID()}`,
      note: null,
      toStatus: "received",
    } as never);
}

let memberSequence = 0;

async function insertMember(
  overrides: Partial<{ isSeed: boolean }> = {},
): Promise<MemberId> {
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
      isSeed: overrides.isSeed ?? false,
      kanaNormalized: "ヤマダ",
      memberNumber: String(memberSequence),
      name: "山田太郎",
      nameKana: "ヤマダ",
      nameNormalized: "山田太郎",
      phone: `0000000${String(memberSequence).padStart(4, "0")}`,
      postalCode: null,
      status: "active",
      updatedById: null,
    } as unknown as MemberInsert);
  return id;
}

async function insertStatusHistory(memberId: MemberId) {
  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .statusHistory.insert({
      createdById: STAFF_ID,
      fromStatus: null,
      id: `status-history-${crypto.randomUUID()}`,
      memberId,
      reason: null,
      toStatus: "active",
    } as never);
}

async function insertSession() {
  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .sessions.insert({
      expiresAt: "2099-01-01T00:00:00.000Z",
      id: "demo-reset-session" as never,
      staffUserId: STAFF_ID,
    } as never);
}

async function insertUsageCounter() {
  await env.DB.prepare(
    "INSERT INTO usage_counter (period, ocr_pages, gemini_calls) VALUES (?, ?, ?)",
  )
    .bind("2026-09", 42, 7)
    .run();
}

async function countRows(table: string): Promise<number> {
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM ${table}`,
  ).first<{ count: number }>();
  return result?.count ?? 0;
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
  await env.DB.prepare("DELETE FROM sessions").run();
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
  await env.DB.prepare("DELETE FROM usage_counter").run();

  await createTenantRepository(env.DB).forTenant(TENANT_ID).staffUsers.insert({
    createdById: null,
    email: "admin@example.test",
    failedLoginCount: 0,
    id: STAFF_ID,
    isActive: true,
    lockedUntil: null,
    name: "管理 太郎",
    passwordHash: "unused",
    role: "admin",
    updatedById: null,
  });
});

describe("preview (F-9-7)", () => {
  it("counts applications, images, non-seed members, and returns the fixed confirmation word", async () => {
    await insertApplication({ id: APPLICATION_ID });
    await insertApplication({
      id: toApplicationId("demo-reset-application-no-image"),
      imageKey: null,
    });
    await insertMember({ isSeed: true });
    await insertMember({ isSeed: false });
    await insertMember({ isSeed: false });

    const preview = await service().preview();

    expect(preview).toEqual({
      applications: 2,
      confirmationWord: "RESET",
      images: 1,
      members: 2,
      snapshotToken: expect.any(String),
    });
  });

  it("returns zeros when there is nothing to delete", async () => {
    const preview = await service().preview();

    expect(preview).toEqual({
      applications: 0,
      confirmationWord: "RESET",
      images: 0,
      members: 0,
      snapshotToken: expect.any(String),
    });
  });

  // コードレビュー指摘・P2・決定#51: previewとreset実行時で対象集合が違えば
  // ダイジェストも変わることを確認する（同じ状態なら再現性がある）。
  it("changes the snapshot token when the target set changes, and stays stable otherwise", async () => {
    await insertApplication();
    const first = await service().preview();
    const second = await service().preview();
    expect(second.snapshotToken).toBe(first.snapshotToken);

    await insertApplication({
      id: toApplicationId("demo-reset-application-2"),
    });
    const third = await service().preview();
    expect(third.snapshotToken).not.toBe(first.snapshotToken);
  });
});

describe("reset (F-9-1〜F-9-13)", () => {
  it("rejects a mismatched confirmation word and deletes nothing", async () => {
    await insertApplication();
    const imageStorage = fakeImageStorage();
    const preview = await service(imageStorage).preview();

    await expect(
      service(imageStorage).reset(
        { confirmation: "wrong", snapshotToken: preview.snapshotToken },
        ACTOR,
      ),
    ).rejects.toThrow(ApiErrorException);
    await expect(
      service(imageStorage).reset(
        { confirmation: "wrong", snapshotToken: preview.snapshotToken },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(await countRows("applications")).toBe(1);
    expect(imageStorage.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes applications, their history, and non-seed members while preserving seed members, staff, sessions, and the usage counter", async () => {
    await insertApplication();
    await insertCheckRun(APPLICATION_ID);
    await insertAppStatusHistory(APPLICATION_ID);
    const seedMemberId = await insertMember({ isSeed: true });
    const otherMemberId = await insertMember({ isSeed: false });
    await insertStatusHistory(seedMemberId);
    await insertStatusHistory(otherMemberId);
    await insertSession();
    await insertUsageCounter();
    const imageStorage = fakeImageStorage(1);
    const preview = await service(imageStorage).preview();

    const result = await service(imageStorage).reset(
      { confirmation: "RESET", snapshotToken: preview.snapshotToken },
      ACTOR,
    );

    expect(result).toEqual({
      deleted: { applications: 1, images: 1, members: 1 },
      usageCounterReset: false,
    });
    // 決定#50: 削除対象はD1削除より前に確定したimageKeyの集合そのもの。
    expect(imageStorage.deleteMany).toHaveBeenCalledWith([
      toImageKey(`${TENANT_ID}/${APPLICATION_ID}.jpg`),
    ]);

    // F-9-1: 削除される。
    expect(await countRows("applications")).toBe(0);
    expect(await countRows("check_runs")).toBe(0);
    expect(await countRows("app_status_history")).toBe(0);
    // F-9-4: シード会員の分も含めてStatusHistoryは全削除する。
    expect(await countRows("status_history")).toBe(0);
    // F-9-2・F-9-3: シード会員だけが残る。
    const remainingMembers = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .members.all();
    expect(remainingMembers.map((member) => member.id)).toEqual([seedMemberId]);
    // F-9-5: StaffUser・Session・UsageCounterは削除しない。
    expect(await countRows("staff_users")).toBe(1);
    expect(await countRows("sessions")).toBe(1);
    const usageCounterRow = await env.DB.prepare(
      "SELECT ocr_pages, gemini_calls FROM usage_counter WHERE period = ?",
    )
      .bind("2026-09")
      .first<{ ocr_pages: number; gemini_calls: number }>();
    expect(usageCounterRow).toEqual({ gemini_calls: 7, ocr_pages: 42 });
  });

  it("reports the storage layer's own return value as the deleted image count", async () => {
    await insertApplication();
    const imageStorage = fakeImageStorage(3);
    const preview = await service(imageStorage).preview();

    const result = await service(imageStorage).reset(
      { confirmation: "RESET", snapshotToken: preview.snapshotToken },
      ACTOR,
    );

    expect(result.deleted.images).toBe(3);
  });

  // コードレビュー指摘・P1・決定#50: D1削除後にR2のprefixを再列挙すると、その間に
  // 完了した別リクエスト(OCR登録等)の新規アップロードまで削除してしまい、D1側には
  // imageKey付きの申請が残るのに対応するR2オブジェクトが存在しないという不整合が生じる。
  it("collects the R2 deletion key set from D1 rows before deleting them, not from a live re-listing", async () => {
    const firstId = await insertApplication({
      id: toApplicationId("demo-reset-application-1"),
    });
    const secondId = await insertApplication({
      id: toApplicationId("demo-reset-application-2"),
    });
    await insertApplication({
      id: toApplicationId("demo-reset-application-no-image"),
      imageKey: null,
    });
    const imageStorage = fakeImageStorage(2);
    const preview = await service(imageStorage).preview();

    await service(imageStorage).reset(
      { confirmation: "RESET", snapshotToken: preview.snapshotToken },
      ACTOR,
    );

    const deleteManyMock = imageStorage.deleteMany as ReturnType<typeof vi.fn>;
    expect(deleteManyMock).toHaveBeenCalledOnce();
    const deletedKeys = deleteManyMock.mock.calls[0]?.[0] as string[];
    expect(new Set(deletedKeys)).toEqual(
      new Set([
        toImageKey(`${TENANT_ID}/${firstId}.jpg`),
        toImageKey(`${TENANT_ID}/${secondId}.jpg`),
      ]),
    );
  });

  it("does not touch match candidates for members outside the tenant scope", async () => {
    await insertApplication();
    const memberId = await insertMember({ isSeed: false });
    await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .matchCandidates.insert({
        aiLikelihood: "medium",
        aiReason: "テスト理由",
        applicationId: APPLICATION_ID,
        decidedAt: null,
        decidedById: null,
        id: `match-candidate-${crypto.randomUUID()}`,
        memberId,
        ruleScore: 30,
        status: "pending",
      } as never);
    const preview = await service().preview();

    await service().reset(
      { confirmation: "RESET", snapshotToken: preview.snapshotToken },
      ACTOR,
    );

    expect(await countRows("match_candidates")).toBe(0);
  });

  // コードレビュー指摘・P2・決定#51: preview表示後に対象集合が変化した場合、
  // 確認画面で提示した件数より多く(または少なく)削除してはならない。
  describe("snapshotToken(F-9-7の対象集合固定・決定#51)", () => {
    it("rejects and deletes nothing when an application was added after the preview was taken", async () => {
      await insertApplication();
      const imageStorage = fakeImageStorage();
      const staleToken = (await service(imageStorage).preview()).snapshotToken;

      await insertApplication({
        id: toApplicationId("demo-reset-application-added-later"),
      });

      await expect(
        service(imageStorage).reset(
          { confirmation: "RESET", snapshotToken: staleToken },
          ACTOR,
        ),
      ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
      expect(await countRows("applications")).toBe(2);
      expect(imageStorage.deleteMany).not.toHaveBeenCalled();
    });

    it("rejects and deletes nothing when a non-seed member was added after the preview was taken", async () => {
      await insertApplication();
      const imageStorage = fakeImageStorage();
      const staleToken = (await service(imageStorage).preview()).snapshotToken;

      await insertMember({ isSeed: false });

      await expect(
        service(imageStorage).reset(
          { confirmation: "RESET", snapshotToken: staleToken },
          ACTOR,
        ),
      ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
      expect(await countRows("applications")).toBe(1);
      expect(await countRows("members")).toBe(1);
      expect(imageStorage.deleteMany).not.toHaveBeenCalled();
    });

    it("resets successfully when the target set has not changed since the preview", async () => {
      await insertApplication();
      const imageStorage = fakeImageStorage(1);
      const freshToken = (await service(imageStorage).preview()).snapshotToken;

      const result = await service(imageStorage).reset(
        { confirmation: "RESET", snapshotToken: freshToken },
        ACTOR,
      );

      expect(result.deleted.applications).toBe(1);
      expect(await countRows("applications")).toBe(0);
    });
  });

  // コードレビュー指摘・P2・決定#52: R2削除が途中で失敗しても、D1を削除した事実
  // （実行者・D1側の削除件数）を監査ログへ残す。
  describe("R2削除の部分失敗時の監査ログ(F-9-10・決定#52)", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let infoSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    });

    afterEach(() => {
      errorSpy.mockRestore();
      infoSpy.mockRestore();
    });

    it("logs the D1-confirmed counts and rethrows when R2 deletion fails partway", async () => {
      await insertApplication();
      const seedMemberId = await insertMember({ isSeed: true });
      await insertMember({ isSeed: false });
      const r2Error = new PartialImageDeleteError(0, new Error("R2 down"));
      const imageStorage = fakeImageStorage();
      (imageStorage.deleteMany as ReturnType<typeof vi.fn>).mockRejectedValue(
        r2Error,
      );
      const preview = await service(imageStorage).preview();

      await expect(
        service(imageStorage).reset(
          { confirmation: "RESET", snapshotToken: preview.snapshotToken },
          ACTOR,
        ),
      ).rejects.toBe(r2Error);

      // D1側は既に確定している(F-9-11②)。
      expect(await countRows("applications")).toBe(0);
      const remainingMembers = await createTenantRepository(env.DB)
        .forTenant(TENANT_ID)
        .members.all();
      expect(remainingMembers.map((member) => member.id)).toEqual([
        seedMemberId,
      ]);

      expect(errorSpy).toHaveBeenCalledOnce();
      expect(infoSpy).not.toHaveBeenCalled();
      const event = errorSpy.mock.calls[0]?.[0];
      expect(event).toMatchObject({
        deletedApplications: 1,
        deletedImages: 0,
        deletedMembers: 1,
        event: "demo_reset.failed",
        executedById: STAFF_ID,
      });
    });

    it("records the partial R2 count when only some batches succeeded before failing", async () => {
      await insertApplication();
      const r2Error = new PartialImageDeleteError(1000, new Error("R2 down"));
      const imageStorage = fakeImageStorage();
      (imageStorage.deleteMany as ReturnType<typeof vi.fn>).mockRejectedValue(
        r2Error,
      );
      const preview = await service(imageStorage).preview();

      await expect(
        service(imageStorage).reset(
          { confirmation: "RESET", snapshotToken: preview.snapshotToken },
          ACTOR,
        ),
      ).rejects.toBe(r2Error);

      const event = errorSpy.mock.calls[0]?.[0];
      expect(event).toMatchObject({ deletedImages: 1000 });
    });

    it("logs a success event when the reset completes without error", async () => {
      await insertApplication();
      const imageStorage = fakeImageStorage(1);
      const preview = await service(imageStorage).preview();

      await service(imageStorage).reset(
        { confirmation: "RESET", snapshotToken: preview.snapshotToken },
        ACTOR,
      );

      expect(infoSpy).toHaveBeenCalledOnce();
      expect(errorSpy).not.toHaveBeenCalled();
      const event = infoSpy.mock.calls[0]?.[0];
      expect(event).toMatchObject({
        deletedApplications: 1,
        deletedImages: 1,
        event: "demo_reset.completed",
        executedById: STAFF_ID,
      });
    });

    it("does not let a logging failure change the API result", async () => {
      await insertApplication();
      const r2Error = new PartialImageDeleteError(0, new Error("R2 down"));
      const imageStorage = fakeImageStorage();
      (imageStorage.deleteMany as ReturnType<typeof vi.fn>).mockRejectedValue(
        r2Error,
      );
      errorSpy.mockImplementation(() => {
        throw new Error("logging unavailable");
      });
      const preview = await service(imageStorage).preview();

      await expect(
        service(imageStorage).reset(
          { confirmation: "RESET", snapshotToken: preview.snapshotToken },
          ACTOR,
        ),
      ).rejects.toBe(r2Error);
    });
  });
});
