import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTenantRepository,
  whereFieldEquals,
} from "../../../src/worker/db/repositories";
import type { matchCandidates, members } from "../../../src/worker/db/schema";
import { createBusinessCheckService } from "../../../src/worker/services/business-check";
import { normalizeMemberInput } from "../../../src/worker/services/member-normalizer";
import { createUsageService } from "../../../src/worker/services/usage";
import {
  type AppConfig,
  type ApplicationField,
  toApplicationId,
  toMatchCandidateId,
  toMemberId,
  toSessionId,
  toStaffUserId,
  toTenantId,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-business-check");
const STAFF_ID = toStaffUserId("business-check-staff");
const APPLICATION_ID = toApplicationId("business-check-application");

const CONFIG: AppConfig = {
  aiGatewayAccountId: "test-ai-gateway-account",
  aiGatewayId: "test-ai-gateway-id",
  allowDataReset: true,
  geminiModel: "gemini-3.1-flash-lite",
  maxCheckRunsPerApplication: 2,
  maxGeminiCallsPerMonth: 720,
  maxOcrPagesPerMonth: 120,
  ocrPipelineMode: "gemini",
  pbkdf2Iterations: 1_000,
  r2AccountId: "test-r2-account",
  tenantId: TENANT_ID,
};

const ACTOR = {
  sessionId: toSessionId("session-business-check"),
  user: {
    email: "staff@example.test",
    id: STAFF_ID,
    isActive: true,
    name: "窓口 花子",
    role: "staff" as const,
  },
};

const APPLICANT_FIELDS: ApplicationField[] = [
  { confidence: 0.98, edited: false, label: "氏名", value: "山田太郎" },
  { confidence: 0.95, edited: false, label: "氏名カナ", value: "ヤマダタロウ" },
  { confidence: 0.9, edited: false, label: "生年月日", value: "1990-01-01" },
  { confidence: 0.9, edited: false, label: "電話番号", value: "0300001111" },
];

const testEnvironment = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
};

type MemberInsert = typeof members.$inferInsert;
type MatchCandidateInsert = typeof matchCandidates.$inferInsert;

function geminiResponse(body: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }],
    }),
    { status: 200 },
  );
}

function defaultAiBody(overrides: Record<string, unknown> = {}) {
  return {
    consistency: [],
    deficiencies: [],
    letterDraft: null,
    triage: "approval_candidate",
    triageReason: "全項目が整合しているため。",
    ...overrides,
  };
}

function createService(
  requestFetch?: typeof fetch,
  config: AppConfig = CONFIG,
) {
  const repository = createTenantRepository(env.DB);
  const usage = createUsageService({ config, database: env.DB });
  return createBusinessCheckService({
    apiKey: "test-gemini-api-key",
    config,
    repository,
    requestFetch,
    usage,
  });
}

async function insertApplication(
  overrides: Partial<{
    appStatus: "received" | "under_review" | "approved" | "returned";
    fields: ApplicationField[];
    id: ReturnType<typeof toApplicationId>;
  }> = {},
) {
  const id = overrides.id ?? APPLICATION_ID;
  await env.DB.prepare("DELETE FROM applications WHERE id = ?").bind(id).run();
  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .applications.insert({
      appStatus: overrides.appStatus ?? "received",
      createdById: STAFF_ID,
      docType: "利用者登録申請書",
      editedCount: 0,
      fieldsJson: JSON.stringify(overrides.fields ?? APPLICANT_FIELDS),
      id,
      imageKey: null,
      latestCheckRunId: null,
      memberId: null,
      processingSec: 1.5,
      updatedById: null,
    });
  return id;
}

let memberSequence = 0;

async function insertMember(
  overrides: Partial<{
    name: string;
    nameKana: string | null;
    birthDate: string | null;
    phone: string;
  }> = {},
) {
  memberSequence += 1;
  const raw = {
    address: null,
    birthDate: overrides.birthDate ?? null,
    name: overrides.name ?? "無関係 太郎",
    nameKana: overrides.nameKana ?? null,
    phone:
      overrides.phone ?? `0000000${String(memberSequence).padStart(4, "0")}`,
  };
  const normalized = normalizeMemberInput(raw);
  const id = toMemberId(`member-${memberSequence}`);

  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .members.insert({
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
  // applications.latestCheckRunId ↔ checkRuns.applicationId は循環参照のため、
  // check_runsを消す前にapplications側の参照を外す。
  await env.DB.prepare(
    "UPDATE applications SET latest_check_run_id = NULL",
  ).run();
  await env.DB.prepare("DELETE FROM match_candidates").run();
  await env.DB.prepare("DELETE FROM check_runs").run();
  await env.DB.prepare("DELETE FROM app_status_history").run();
  await env.DB.prepare("DELETE FROM applications").run();
  await env.DB.prepare("DELETE FROM members").run();
  await env.DB.prepare("DELETE FROM staff_users").run();
  await env.DB.prepare("DELETE FROM usage_counter").run();

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

describe("run — 状態検証 (F-4-6・NF-2-21)", () => {
  it("throws NOT_FOUND for an unknown application and never calls the AI", async () => {
    const requestFetch = vi.fn();
    const service = createService(requestFetch as unknown as typeof fetch);

    await expect(
      service.run(ACTOR, toApplicationId("missing-application")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it("throws INVALID_TRANSITION for an approved application and never calls the AI", async () => {
    await insertApplication({ appStatus: "approved" });
    const requestFetch = vi.fn();
    const service = createService(requestFetch as unknown as typeof fetch);

    await expect(service.run(ACTOR, APPLICATION_ID)).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it("throws CHECK_RUN_LIMIT once MAX_CHECK_RUNS_PER_APPLICATION is reached and never calls the AI", async () => {
    const requestFetch = vi.fn(async () => geminiResponse(defaultAiBody()));
    const service = createService(requestFetch as unknown as typeof fetch);

    await service.run(ACTOR, APPLICATION_ID);
    await service.run(ACTOR, APPLICATION_ID);
    expect(requestFetch).toHaveBeenCalledTimes(2);

    const limitedRequestFetch = vi.fn();
    const limitedService = createService(
      limitedRequestFetch as unknown as typeof fetch,
    );
    await expect(
      limitedService.run(ACTOR, APPLICATION_ID),
    ).rejects.toMatchObject({ code: "CHECK_RUN_LIMIT" });
    expect(limitedRequestFetch).not.toHaveBeenCalled();
  });

  it("allows only one of two concurrent runs through the limit (コードレビュー指摘#3)", async () => {
    const oneRunConfig: AppConfig = {
      ...CONFIG,
      maxCheckRunsPerApplication: 1,
    };
    const requestFetch = vi.fn(async () => geminiResponse(defaultAiBody()));
    const serviceA = createService(
      requestFetch as unknown as typeof fetch,
      oneRunConfig,
    );
    const serviceB = createService(
      requestFetch as unknown as typeof fetch,
      oneRunConfig,
    );

    const results = await Promise.allSettled([
      serviceA.run(ACTOR, APPLICATION_ID),
      serviceB.run(ACTOR, APPLICATION_ID),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "CHECK_RUN_LIMIT",
    });
    // 上限を通過できたのは1リクエストだけなので、AIも1回しか呼ばれない。
    expect(requestFetch).toHaveBeenCalledTimes(1);

    const checkRuns = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .checkRuns.all();
    expect(checkRuns).toHaveLength(1);
  });
});

describe("run — ステータス遷移 (F-4-7)", () => {
  it("transitions a received application to under_review and records AppStatusHistory", async () => {
    const requestFetch = vi.fn(async () => geminiResponse(defaultAiBody()));
    const service = createService(requestFetch as unknown as typeof fetch);

    const result = await service.run(ACTOR, APPLICATION_ID);

    expect(result.application.appStatus).toBe("under_review");
    expect(result.application.statusHistory).toEqual([
      expect.objectContaining({
        fromStatus: "received",
        toStatus: "under_review",
      }),
    ]);
  });

  it("does not create an AppStatusHistory entry when the application is already under_review", async () => {
    await insertApplication({ appStatus: "under_review" });
    const requestFetch = vi.fn(async () => geminiResponse(defaultAiBody()));
    const service = createService(requestFetch as unknown as typeof fetch);

    const result = await service.run(ACTOR, APPLICATION_ID);

    expect(result.application.appStatus).toBe("under_review");
    expect(result.application.statusHistory).toHaveLength(0);
  });

  it("re-runs a returned application without forcing a status transition (F-4-6)", async () => {
    await insertApplication({ appStatus: "returned" });
    const requestFetch = vi.fn(async () => geminiResponse(defaultAiBody()));
    const service = createService(requestFetch as unknown as typeof fetch);

    const result = await service.run(ACTOR, APPLICATION_ID);

    expect(result.application.appStatus).toBe("returned");
  });
});

describe("run — CheckRun・latestCheckRunId (F-3-7・F-4-8)", () => {
  it("persists a CheckRun and updates Application.latestCheckRunId", async () => {
    const requestFetch = vi.fn(async () =>
      geminiResponse(
        defaultAiBody({
          deficiencies: [{ label: "住所", message: "住所が未記入です。" }],
          letterDraft: "ご提出いただいた申請書に不備がございます。".repeat(1),
          triage: "return_candidate",
          triageReason: "住所が未記入のため。",
        }),
      ),
    );
    const service = createService(requestFetch as unknown as typeof fetch);

    const result = await service.run(ACTOR, APPLICATION_ID);

    expect(result.checkRun).toMatchObject({
      applicationId: APPLICATION_ID,
      deficiencies: [{ label: "住所", message: "住所が未記入です。" }],
      triage: "return_candidate",
      triageReason: "住所が未記入のため。",
    });
    expect(result.application.latestCheckRun?.id).toBe(result.checkRun.id);
    expect(result.application.triage).toBe("return_candidate");
    expect(result.remainingRuns).toBe(1);

    const stored = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .applications.findOne(
        whereFieldEquals("applications", "id", APPLICATION_ID),
      );
    expect(stored?.latestCheckRunId).toBe(result.checkRun.id);
  });

  it("rejects an AI letterDraft exceeding 200 characters (F-3-5)", async () => {
    const requestFetch = vi.fn(async () =>
      geminiResponse(defaultAiBody({ letterDraft: "あ".repeat(201) })),
    );
    const service = createService(requestFetch as unknown as typeof fetch);

    await expect(service.run(ACTOR, APPLICATION_ID)).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
  });

  it("rejects a letterDraft returned with no consistency/deficiency issues (コードレビュー指摘#4)", async () => {
    const requestFetch = vi.fn(async () =>
      geminiResponse(
        defaultAiBody({
          letterDraft: "不備はありませんが念のため下書きです。",
        }),
      ),
    );
    const service = createService(requestFetch as unknown as typeof fetch);

    await expect(service.run(ACTOR, APPLICATION_ID)).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
  });

  it("rejects a null letterDraft when a deficiency was reported (コードレビュー指摘#4)", async () => {
    const requestFetch = vi.fn(async () =>
      geminiResponse(
        defaultAiBody({
          deficiencies: [{ label: "住所", message: "住所が未記入です。" }],
          letterDraft: null,
        }),
      ),
    );
    const service = createService(requestFetch as unknown as typeof fetch);

    await expect(service.run(ACTOR, APPLICATION_ID)).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
  });

  it("rejects a null letterDraft when a consistency issue was reported (コードレビュー指摘#4)", async () => {
    const requestFetch = vi.fn(async () =>
      geminiResponse(
        defaultAiBody({
          consistency: [
            {
              labels: ["氏名", "氏名カナ"],
              message: "氏名とカナが一致しません。",
              severity: "warning",
            },
          ],
          letterDraft: null,
        }),
      ),
    );
    const service = createService(requestFetch as unknown as typeof fetch);

    await expect(service.run(ACTOR, APPLICATION_ID)).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
  });

  it("rejects an empty-string letterDraft even when issues were reported (コードレビュー指摘#4)", async () => {
    const requestFetch = vi.fn(async () =>
      geminiResponse(
        defaultAiBody({
          deficiencies: [{ label: "住所", message: "住所が未記入です。" }],
          letterDraft: "",
        }),
      ),
    );
    const service = createService(requestFetch as unknown as typeof fetch);

    await expect(service.run(ACTOR, APPLICATION_ID)).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
  });
});

describe("run — 名寄せ第1段・第2段 (F-6-3〜5・F-6-10・決定#27)", () => {
  it("persists at most 5 MatchCandidate rows with rule-based likelihood, and never sends member data to the AI", async () => {
    for (let index = 0; index < 7; index += 1) {
      await insertMember({ name: `候補${index}`, phone: "0300001111" });
    }

    const requestFetch = vi.fn(async (_url, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const userText = JSON.parse(body.contents[0].parts[0].text);
      // 決定#27: 既存会員の個人情報はAIへ一切送信しない。
      expect(userText.candidates).toBeUndefined();
      return geminiResponse(defaultAiBody());
    });
    const service = createService(requestFetch as unknown as typeof fetch);

    const result = await service.run(ACTOR, APPLICATION_ID);

    expect(result.matchCandidates).toHaveLength(5);
    // 電話番号のみが一致する候補なので、強い一致条件は1つ→medium(matching.tsのclassifyLikelihood)。
    expect(
      result.matchCandidates.every(
        (candidate) => candidate.aiLikelihood === "medium",
      ),
    ).toBe(true);

    const rows = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .matchCandidates.find(
        whereFieldEquals("match_candidates", "applicationId", APPLICATION_ID),
      );
    expect(rows).toHaveLength(5);
  });

  it("updates ruleScore/aiLikelihood on re-run as the underlying match strengthens, instead of duplicating the row (UNIQUE(applicationId, memberId))", async () => {
    const memberId = await insertMember({
      name: "再実施 太郎",
      phone: "0300001111",
    });

    const firstFetch = vi.fn(async () => geminiResponse(defaultAiBody()));
    await createService(firstFetch as unknown as typeof fetch).run(
      ACTOR,
      APPLICATION_ID,
    );

    const firstRow = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .matchCandidates.findOne(
        whereFieldEquals("match_candidates", "memberId", memberId),
      );
    expect(firstRow).toMatchObject({ aiLikelihood: "medium" });

    // カナ・生年月日も一致するようになり、強い一致条件が2つに増える。
    await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .members.update(
        { birthDate: "1990-01-01", kanaNormalized: "ヤマダタロウ" },
        whereFieldEquals("members", "id", memberId),
      );

    const secondFetch = vi.fn(async () => geminiResponse(defaultAiBody()));
    await createService(secondFetch as unknown as typeof fetch).run(
      ACTOR,
      APPLICATION_ID,
    );

    const rows = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .matchCandidates.find(
        whereFieldEquals("match_candidates", "applicationId", APPLICATION_ID),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ aiLikelihood: "high" });
  });

  it("excludes a member already rejected for this application and leaves its row untouched (F-6-10)", async () => {
    const memberId = await insertMember({
      name: "却下済み",
      phone: "0300001111",
    });
    await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .matchCandidates.insert({
        aiLikelihood: null,
        aiReason: null,
        applicationId: APPLICATION_ID,
        decidedAt: "2026-09-01T00:00:00.000Z",
        decidedById: STAFF_ID,
        id: toMatchCandidateId(`candidate-${memberId}`),
        memberId,
        ruleScore: 60,
        status: "rejected",
      } as unknown as MatchCandidateInsert);

    const requestFetch = vi.fn(async (_url, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const userText = JSON.parse(body.contents[0].parts[0].text);
      expect(userText.candidates).toBeUndefined();
      return geminiResponse(defaultAiBody());
    });
    const service = createService(requestFetch as unknown as typeof fetch);

    const result = await service.run(ACTOR, APPLICATION_ID);

    expect(result.matchCandidates).toHaveLength(0);

    const row = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .matchCandidates.findOne(
        whereFieldEquals("match_candidates", "memberId", memberId),
      );
    expect(row).toMatchObject({ ruleScore: 60, status: "rejected" });
  });

  it("invalidates a pending candidate to 'stale' once it falls out of the top-5, then reactivates it to 'pending' if it re-qualifies later (コードレビュー指摘#5)", async () => {
    const config: AppConfig = { ...CONFIG, maxCheckRunsPerApplication: 5 };
    const memberId = await insertMember({ phone: "0300001111" });
    const repositories = createTenantRepository(env.DB).forTenant(TENANT_ID);

    const firstFetch = vi.fn(async () => geminiResponse(defaultAiBody()));
    const firstResult = await createService(
      firstFetch as unknown as typeof fetch,
      config,
    ).run(ACTOR, APPLICATION_ID);
    expect(firstResult.matchCandidates.map((c) => c.member.id)).toContain(
      memberId,
    );
    expect(
      await repositories.matchCandidates.findOne(
        whereFieldEquals("match_candidates", "memberId", memberId),
      ),
    ).toMatchObject({ status: "pending" });

    // 電話番号を書き換え、この会員がどの一致条件も満たさなくなるようにする。
    const mismatchedFields = APPLICANT_FIELDS.map((field) =>
      field.label === "電話番号" ? { ...field, value: "0300009999" } : field,
    );
    await repositories.applications.update(
      { fieldsJson: JSON.stringify(mismatchedFields) },
      whereFieldEquals("applications", "id", APPLICATION_ID),
    );

    const secondFetch = vi.fn(async () => geminiResponse(defaultAiBody()));
    const secondResult = await createService(
      secondFetch as unknown as typeof fetch,
      config,
    ).run(ACTOR, APPLICATION_ID);
    expect(secondResult.matchCandidates.map((c) => c.member.id)).not.toContain(
      memberId,
    );
    expect(
      await repositories.matchCandidates.findOne(
        whereFieldEquals("match_candidates", "memberId", memberId),
      ),
    ).toMatchObject({ status: "stale" });

    // 電話番号を元に戻し、再び候補条件を満たすようにする。
    await repositories.applications.update(
      { fieldsJson: JSON.stringify(APPLICANT_FIELDS) },
      whereFieldEquals("applications", "id", APPLICATION_ID),
    );

    const thirdFetch = vi.fn(async () => geminiResponse(defaultAiBody()));
    const thirdResult = await createService(
      thirdFetch as unknown as typeof fetch,
      config,
    ).run(ACTOR, APPLICATION_ID);
    expect(thirdResult.matchCandidates.map((c) => c.member.id)).toContain(
      memberId,
    );
    expect(
      await repositories.matchCandidates.findOne(
        whereFieldEquals("match_candidates", "memberId", memberId),
      ),
    ).toMatchObject({ status: "pending" });
  });

  it("invalidates a 'hold' candidate to 'stale' without discarding its decision record (F-6-9) when it falls out of the top-5", async () => {
    const memberId = await insertMember({ phone: "0300001111" });
    const repositories = createTenantRepository(env.DB).forTenant(TENANT_ID);

    const firstFetch = vi.fn(async () => geminiResponse(defaultAiBody()));
    await createService(firstFetch as unknown as typeof fetch).run(
      ACTOR,
      APPLICATION_ID,
    );
    const row = await repositories.matchCandidates.findOne(
      whereFieldEquals("match_candidates", "memberId", memberId),
    );
    if (!row) {
      throw new Error("expected a MatchCandidate row after the first run");
    }
    // 職員が「保留」を選んだ状態を再現する（決定エンドポイントはTask 010で実装）。
    const heldAt = "2026-09-03T00:00:00.000Z";
    await repositories.matchCandidates.update(
      { decidedAt: heldAt, decidedById: STAFF_ID, status: "hold" },
      whereFieldEquals("match_candidates", "id", row.id),
    );

    const mismatchedFields = APPLICANT_FIELDS.map((field) =>
      field.label === "電話番号" ? { ...field, value: "0300009999" } : field,
    );
    await repositories.applications.update(
      { fieldsJson: JSON.stringify(mismatchedFields) },
      whereFieldEquals("applications", "id", APPLICATION_ID),
    );

    const secondFetch = vi.fn(async () => geminiResponse(defaultAiBody()));
    const secondResult = await createService(
      secondFetch as unknown as typeof fetch,
    ).run(ACTOR, APPLICATION_ID);

    expect(secondResult.matchCandidates.map((c) => c.member.id)).not.toContain(
      memberId,
    );
    expect(
      await repositories.matchCandidates.findOne(
        whereFieldEquals("match_candidates", "id", row.id),
      ),
    ).toMatchObject({
      decidedAt: heldAt,
      decidedById: STAFF_ID,
      status: "stale",
    });
  });
});

describe("run — Usage連携 (NF-2-17・NF-2-21・NF-2-34)", () => {
  it("returns USAGE_LIMIT_EXCEEDED without calling the AI once the monthly Gemini call limit is reached", async () => {
    const limitedConfig: AppConfig = { ...CONFIG, maxGeminiCallsPerMonth: 1 };
    const firstFetch = vi.fn(async () => geminiResponse(defaultAiBody()));
    await createService(
      firstFetch as unknown as typeof fetch,
      limitedConfig,
    ).run(ACTOR, APPLICATION_ID);

    const requestFetch = vi.fn();
    const service = createService(
      requestFetch as unknown as typeof fetch,
      limitedConfig,
    );

    await expect(service.run(ACTOR, APPLICATION_ID)).rejects.toMatchObject({
      code: "USAGE_LIMIT_EXCEEDED",
    });
    expect(requestFetch).not.toHaveBeenCalled();

    const checkRuns = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .checkRuns.all();
    expect(checkRuns).toHaveLength(1);
  });

  it("returns the updated usage in the response", async () => {
    const requestFetch = vi.fn(async () => geminiResponse(defaultAiBody()));
    const service = createService(requestFetch as unknown as typeof fetch);

    const result = await service.run(ACTOR, APPLICATION_ID);

    expect(result.usage).toMatchObject({ geminiCalls: 1 });
  });
});
