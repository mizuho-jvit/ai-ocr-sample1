import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTenantRepository,
  whereFieldEquals,
} from "../../../src/worker/db/repositories";
import type {
  checkRuns,
  matchCandidates,
  members,
} from "../../../src/worker/db/schema";
import { createApplicationService } from "../../../src/worker/services/application-service";
import {
  type AppConfig,
  type ApplicationField,
  type ApplicationId,
  type MatchCandidateId,
  type MemberId,
  toApplicationId,
  toMatchCandidateId,
  toMemberId,
  toSessionId,
  toStaffUserId,
  toTenantId,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-application-service-match");
const STAFF_ID = toStaffUserId("application-service-match-staff");
const APPLICATION_ID = toApplicationId("application-service-match-application");

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
  sessionId: toSessionId("session-application-service-match"),
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
type CheckRunInsert = typeof checkRuns.$inferInsert;
type MatchCandidateInsert = typeof matchCandidates.$inferInsert;

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

async function insertCheckRun(
  applicationId: ApplicationId,
  overrides: Partial<{ createdAt: string }> = {},
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
      triage: "approval_candidate",
      triageReason: "テスト",
    } as unknown as CheckRunInsert);
  if (overrides.createdAt) {
    await env.DB.prepare("UPDATE check_runs SET created_at = ? WHERE id = ?")
      .bind(overrides.createdAt, id)
      .run();
  }
  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .applications.update(
      { latestCheckRunId: id as never },
      whereFieldEquals("applications", "id", applicationId),
    );
  return id;
}

async function insertMatchCandidate(
  applicationId: ApplicationId,
  memberId: MemberId,
  overrides: Partial<{
    id: MatchCandidateId;
    status: "pending" | "merged" | "rejected" | "hold" | "stale";
  }> = {},
) {
  const id = overrides.id ?? toMatchCandidateId(crypto.randomUUID());
  const status = overrides.status ?? "pending";
  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .matchCandidates.insert({
      aiLikelihood: "medium",
      aiReason: "テスト理由",
      applicationId,
      decidedAt: status === "pending" ? null : "2026-01-01T00:00:00.000Z",
      decidedById: status === "pending" ? null : STAFF_ID,
      id,
      memberId,
      ruleScore: 30,
      status,
    } as unknown as MatchCandidateInsert);
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

describe("listCheckRuns (api.md #12・F-3-7)", () => {
  it("returns check runs newest-first", async () => {
    const first = await insertCheckRun(APPLICATION_ID, {
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const second = await insertCheckRun(APPLICATION_ID, {
      createdAt: "2026-02-01T00:00:00.000Z",
    });

    const history = await service().listCheckRuns(APPLICATION_ID);

    expect(history.map((run) => run.id)).toEqual([second, first]);
  });

  it("throws NOT_FOUND for a missing application", async () => {
    await expect(
      service().listCheckRuns(toApplicationId("missing")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("decideMatch (api.md #13・F-6-8・F-6-9)", () => {
  it("links the application to the member and records the decision on merged", async () => {
    const memberId = await insertMember();
    const candidateId = await insertMatchCandidate(APPLICATION_ID, memberId);

    const result = await service().decideMatch(
      APPLICATION_ID,
      candidateId,
      ACTOR,
      { decision: "merged" },
    );

    expect(result.candidate.status).toBe("merged");
    expect(result.candidate.decidedBy?.id).toBe(STAFF_ID);
    expect(result.candidate.decidedAt).not.toBeNull();
    expect(result.application.member?.id).toBe(memberId);
  });

  // ユーザー指摘: 会員は複数申請を持ちうる（F-5-6の申請履歴）。「同一申請内でmerged候補は
  // 高々1件」（決定#32）というスコープは申請をまたがない。同じ会員へ複数の申請を独立に
  // 紐付けられ、2件目の紐付けでは既にactiveな会員を再昇格・二重記録しないことを確認する。
  it("lets two different applications link to the same member independently, without re-promoting an already-active member", async () => {
    const memberId = await insertMember({ status: "pending" });
    const candidate1 = await insertMatchCandidate(APPLICATION_ID, memberId);
    await service().decideMatch(APPLICATION_ID, candidate1, ACTOR, {
      decision: "merged",
    });
    await service().changeStatus(APPLICATION_ID, ACTOR, {
      toStatus: "under_review",
    });
    const approval = await service().changeStatus(APPLICATION_ID, ACTOR, {
      toStatus: "approved",
    });
    expect(approval.promotedMember?.id).toBe(memberId);

    const secondApplicationId = toApplicationId("application-second-linked");
    await insertApplication({ id: secondApplicationId });
    const candidate2 = await insertMatchCandidate(
      secondApplicationId,
      memberId,
    );

    const result = await service().decideMatch(
      secondApplicationId,
      candidate2,
      ACTOR,
      { decision: "merged" },
    );

    expect(result.application.member?.id).toBe(memberId);
    // 1件目の申請の紐付けは無傷のまま。
    expect((await service().get(APPLICATION_ID)).member?.id).toBe(memberId);

    const memberRow = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .members.findOne(whereFieldEquals("members", "id", memberId));
    expect(memberRow?.status).toBe("active");
    const statusHistory = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM status_history WHERE member_id = ?",
    )
      .bind(memberId)
      .first<{ count: number }>();
    // 昇格は1件目の承認時の1回だけ。2件目の紐付けで二重記録・再昇格は起きない。
    expect(statusHistory?.count).toBe(1);
  });

  it("does not set Application.memberId on rejected, and still returns the candidate view", async () => {
    const memberId = await insertMember();
    const candidateId = await insertMatchCandidate(APPLICATION_ID, memberId);

    const result = await service().decideMatch(
      APPLICATION_ID,
      candidateId,
      ACTOR,
      { decision: "rejected" },
    );

    expect(result.candidate.status).toBe("rejected");
    expect(result.application.member).toBeNull();
    // F-6-10相当: rejectedは候補カード一覧(application.matchCandidates)からは除外される。
    expect(
      result.application.matchCandidates.some((c) => c.id === candidateId),
    ).toBe(false);
  });

  it("records hold without linking the member", async () => {
    const memberId = await insertMember();
    const candidateId = await insertMatchCandidate(APPLICATION_ID, memberId);

    const result = await service().decideMatch(
      APPLICATION_ID,
      candidateId,
      ACTOR,
      { decision: "hold" },
    );

    expect(result.candidate.status).toBe("hold");
    expect(result.application.member).toBeNull();
  });

  it("throws NOT_FOUND for a missing application", async () => {
    await expect(
      service().decideMatch(
        toApplicationId("missing"),
        toMatchCandidateId("missing-candidate"),
        ACTOR,
        { decision: "hold" },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND for a candidate that does not belong to the application", async () => {
    const memberId = await insertMember();
    const otherApplicationId = toApplicationId("application-other-candidate");
    await insertApplication({ id: otherApplicationId });
    const candidateId = await insertMatchCandidate(
      otherApplicationId,
      memberId,
    );

    await expect(
      service().decideMatch(APPLICATION_ID, candidateId, ACTOR, {
        decision: "hold",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // コードレビュー指摘・ユーザー判断: 承認済み(F-4-2の確定状態)の申請はApplication.memberIdを
  // 含め一切変更させない。members.statusのpending→active昇格(F-4-3)は戻す経路が無いため。
  it("rejects any decision once the application is approved (INVALID_TRANSITION)", async () => {
    const memberId = await insertMember();
    await insertApplication({ appStatus: "approved", memberId });
    const candidateId = await insertMatchCandidate(APPLICATION_ID, memberId);

    await expect(
      service().decideMatch(APPLICATION_ID, candidateId, ACTOR, {
        decision: "merged",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  // コードレビュー指摘: pending/hold以外の候補をAPIから直接上書きできてしまう欠陥の修正。
  it.each(["merged", "rejected", "stale"] as const)(
    "rejects redeciding a %s candidate with INVALID_TRANSITION",
    async (existingStatus) => {
      const memberId = await insertMember();
      const candidateId = await insertMatchCandidate(APPLICATION_ID, memberId, {
        status: existingStatus,
      });

      await expect(
        service().decideMatch(APPLICATION_ID, candidateId, ACTOR, {
          decision: "hold",
        }),
      ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    },
  );

  // コードレビュー指摘・ユーザー判断（後勝ちで差し替える）: 候補Aがmerged済みの状態で
  // 候補Bをmergedにすると、Aはpendingへ戻り、Application.memberIdはBへ差し替わる。
  it("replaces a previously merged candidate when a different candidate is merged (後勝ち)", async () => {
    const memberA = await insertMember();
    const memberB = await insertMember();
    await insertApplication({ appStatus: "received", memberId: memberA });
    const candidateA = await insertMatchCandidate(APPLICATION_ID, memberA, {
      status: "merged",
    });
    const candidateB = await insertMatchCandidate(APPLICATION_ID, memberB);

    const result = await service().decideMatch(
      APPLICATION_ID,
      candidateB,
      ACTOR,
      { decision: "merged" },
    );

    expect(result.candidate.status).toBe("merged");
    expect(result.application.member?.id).toBe(memberB);

    const candidateARow = await createTenantRepository(env.DB)
      .forTenant(TENANT_ID)
      .matchCandidates.findOne(
        whereFieldEquals("match_candidates", "id", candidateA),
      );
    expect(candidateARow).toMatchObject({
      decidedAt: null,
      decidedById: null,
      status: "pending",
    });
  });

  // コードレビュー指摘: ほぼ同時に来た2件のdecideMatch(merged)が競合すると、事前SELECTに
  // 頼る実装ではmerged行が2件残ってしまう(片方は以後再判断できず直せない)。
  // whereOtherMergedMatchCandidatesがWHERE句へ条件を埋め込んだUPDATEにすることで、
  // 「merged行が既に複数ある」状態からでも次の1回のdecideMatchで必ず1件に収束することを確認する。
  it("resets every other merged candidate, recovering even if two ended up merged at once", async () => {
    const memberA = await insertMember();
    const memberB = await insertMember();
    const memberC = await insertMember();
    await insertApplication({ appStatus: "received", memberId: memberB });
    const candidateA = await insertMatchCandidate(APPLICATION_ID, memberA, {
      status: "merged",
    });
    const candidateB = await insertMatchCandidate(APPLICATION_ID, memberB, {
      status: "merged",
    });
    const candidateC = await insertMatchCandidate(APPLICATION_ID, memberC);

    const result = await service().decideMatch(
      APPLICATION_ID,
      candidateC,
      ACTOR,
      { decision: "merged" },
    );

    expect(result.candidate.status).toBe("merged");
    expect(result.application.member?.id).toBe(memberC);

    const repo = createTenantRepository(env.DB).forTenant(TENANT_ID);
    const candidateARow = await repo.matchCandidates.findOne(
      whereFieldEquals("match_candidates", "id", candidateA),
    );
    const candidateBRow = await repo.matchCandidates.findOne(
      whereFieldEquals("match_candidates", "id", candidateB),
    );
    expect(candidateARow).toMatchObject({
      decidedAt: null,
      decidedById: null,
      status: "pending",
    });
    expect(candidateBRow).toMatchObject({
      decidedAt: null,
      decidedById: null,
      status: "pending",
    });
  });
});
