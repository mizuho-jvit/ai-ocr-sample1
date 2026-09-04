import type { TenantRepository } from "../db/repositories";
import {
  whereFieldEquals,
  whereOtherMergedMatchCandidates,
} from "../db/repositories";
import {
  ApiErrorException,
  type AppConfig,
  type ApplicationDetail,
  type ApplicationField,
  type ApplicationId,
  type ApplicationListQuery,
  type ApplicationListResponse,
  type ApplicationSummary,
  type AppStatus,
  type ChangeAppStatusRequest,
  type ChangeAppStatusResponse,
  type CheckRunView,
  type DecideMatchRequest,
  type DecideMatchResponse,
  type MatchCandidateId,
  type MemberStatus,
  type MemberSummary,
  type Triage,
  type UpdateFieldsRequest,
} from "../types";
import {
  type ApplicationRow,
  buildApplicationDetail,
  buildCheckRunHistory,
  buildMatchCandidateView,
  toMemberSummary,
  toStaffUserSummary,
} from "./application-view";
import type { SessionActor } from "./auth";

export interface ApplicationService {
  list(query: ApplicationListQuery): Promise<ApplicationListResponse>;
  get(applicationId: ApplicationId): Promise<ApplicationDetail>;
  updateFields(
    applicationId: ApplicationId,
    actor: SessionActor,
    input: UpdateFieldsRequest,
  ): Promise<ApplicationDetail>;
  changeStatus(
    applicationId: ApplicationId,
    actor: SessionActor,
    input: ChangeAppStatusRequest,
  ): Promise<ChangeAppStatusResponse>;
  listCheckRuns(applicationId: ApplicationId): Promise<CheckRunView[]>;
  decideMatch(
    applicationId: ApplicationId,
    candidateId: MatchCandidateId,
    actor: SessionActor,
    input: DecideMatchRequest,
  ): Promise<DecideMatchResponse>;
}

export interface ApplicationServiceOptions {
  readonly config: AppConfig;
  readonly repository: TenantRepository;
}

/** 🔵 Intent: api.md #11「申請管理（F-4）」の遷移表をそのままコード化する。 */
const ALLOWED_TRANSITIONS: Record<AppStatus, ReadonlySet<AppStatus>> = {
  approved: new Set(),
  received: new Set(["under_review"]),
  returned: new Set(["under_review"]),
  under_review: new Set(["approved", "returned"]),
};

/** 🔴 Intent: 一覧のページングは要件に既定値の定めが無いため、他の一覧APIが増えた際の
 * 参照点としてここへ定数化する。 */
const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

/** 🔵 Intent: F-4-3。承認による会員の自動昇格は職員の手動操作(F-5-7)ではないため定型理由を残す。 */
const AUTO_PROMOTION_REASON = "承認に伴う自動昇格（F-4-3）";

function notFound(): ApiErrorException {
  return new ApiErrorException("NOT_FOUND");
}

function clampPerPage(value: number): number {
  return Math.min(Math.max(value, 1), MAX_PER_PAGE);
}

/**
 * 🔴 Intent: F-4-11「要審査のみ」ビューの対象は要件に定めが無い。`Triage`型の
 * `needs_review`（要審査）値をそのまま対象とする、名称と1対1の最も単純な解釈を採る。
 */
function isNeedsReview(triage: Triage | null): boolean {
  return triage === "needs_review";
}

/**
 * 🟡 Intent: `ApplicationDetail`の組み立て（application-view.ts）はテナント範囲の全テーブルを
 * 都度JOINできないScopedDbの制約上、単一申請向けに設計されている。一覧は全件を1回ずつ
 * バルク取得（`all()`）してMapで突き合わせ、申請件数ぶんのN+1クエリを避ける
 * （デモ規模のテナント1件・数百件程度を前提とした割り切り）。
 */
export function createApplicationService(
  options: ApplicationServiceOptions,
): ApplicationService {
  const { config, repository } = options;
  const repositories = () => repository.forTenant(config.tenantId);

  async function requireApplication(
    applicationId: ApplicationId,
  ): Promise<ApplicationRow> {
    const application = await repositories().applications.findOne(
      whereFieldEquals("applications", "id", applicationId),
    );
    if (!application) {
      throw notFound();
    }
    return application;
  }

  return Object.freeze({
    async changeStatus(applicationId, actor, input) {
      const repos = repositories();
      const application = await requireApplication(applicationId);
      const toStatus = input.toStatus;
      const fromStatus = application.appStatus as AppStatus;

      if (!ALLOWED_TRANSITIONS[fromStatus].has(toStatus)) {
        throw new ApiErrorException("INVALID_TRANSITION");
      }

      const member =
        toStatus === "approved" && application.memberId
          ? await repos.members.findOne(
              whereFieldEquals("members", "id", application.memberId),
            )
          : null;
      const promotesMember = member !== null && member.status === "pending";

      // F-4-4: すべての変更を履歴化する。F-4-3: 承認かつ会員がpendingなら同一トランザクションで昇格させる。
      await repos.runTransaction([
        repos.applications.prepareUpdate(
          { appStatus: toStatus, updatedById: actor.user.id },
          whereFieldEquals("applications", "id", applicationId),
        ),
        repos.appStatusHistory.prepareInsert({
          applicationId,
          createdById: actor.user.id,
          fromStatus,
          id: crypto.randomUUID(),
          note: input.note ?? null,
          toStatus,
        }),
        ...(promotesMember && member
          ? [
              repos.members.prepareUpdate(
                {
                  status: "active" as MemberStatus,
                  updatedById: actor.user.id,
                },
                whereFieldEquals("members", "id", member.id),
              ),
              repos.statusHistory.prepareInsert({
                createdById: actor.user.id,
                fromStatus: "pending" as MemberStatus,
                id: crypto.randomUUID(),
                memberId: member.id,
                reason: AUTO_PROMOTION_REASON,
                toStatus: "active" as MemberStatus,
              }),
            ]
          : []),
      ]);

      const updatedApplication = await requireApplication(applicationId);
      const applicationDetail = await buildApplicationDetail(
        repos,
        updatedApplication,
      );
      const promotedMember: MemberSummary | null =
        promotesMember && member
          ? { ...toMemberSummary(member), status: "active" }
          : null;

      return { application: applicationDetail, promotedMember };
    },

    async decideMatch(applicationId, candidateId, actor, input) {
      const repos = repositories();
      const application = await requireApplication(applicationId);
      // 🔵 Intent: F-4-2「承認は確定状態」。承認後はApplication.memberIdを含め
      // 一切変更させない（ユーザー判断）。members.statusのpending→active昇格（F-4-3）は
      // 戻す経路が無いため、昇格済みの会員が宙に浮く事態そのものをここで断つ。
      if (application.appStatus === "approved") {
        throw new ApiErrorException("INVALID_TRANSITION");
      }

      const candidate = await repos.matchCandidates.findOne(
        whereFieldEquals("match_candidates", "id", candidateId),
      );
      if (!candidate || candidate.applicationId !== applicationId) {
        throw notFound();
      }
      // コードレビュー指摘: 判断可能なのはpending/holdの候補のみ。merged/rejected/stale
      // （UI上は決定済み・非表示）をAPIから直接上書きできてしまう欠陥を塞ぐ。
      if (candidate.status !== "pending" && candidate.status !== "hold") {
        throw new ApiErrorException("INVALID_TRANSITION");
      }

      const now = new Date().toISOString();
      // F-6-8・F-6-9: 判断結果・判断者・日時を保存する。mergedのみApplication.memberIdを設定する（api.md）。
      // コードレビュー指摘・ユーザー判断: 「後勝ち」で紐付け先を差し替え可能にする。mergedにする際、
      // 同じ申請の別候補が既にmerged済みなら、その候補をpending（未判断・decidedById/decidedAtも
      // クリア）へ戻し、Application.memberIdを今回の候補へ差し替える。申請1件につきmerged候補は
      // 常に高々1件という不変条件を保つ。事前にJS側でmerged行をSELECTして戻す実装だと、ほぼ同時に
      // 来た2件のdecideMatch(merged)がどちらも「まだmergedは無い」を読んでしまい、merged行が2件
      // 残る（以後どちらも再判断不可）。whereOtherMergedMatchCandidatesでWHERE句へ条件を埋め込んだ
      // UPDATE 1文にすることで、batch実行時点でDB上に実在するmerged行だけを対象にし、後発の
      // decideMatchが必ず先行分を拾って戻すようにする。
      await repos.runTransaction([
        repos.matchCandidates.prepareUpdate(
          {
            decidedAt: now,
            decidedById: actor.user.id,
            status: input.decision,
          },
          whereFieldEquals("match_candidates", "id", candidateId),
        ),
        ...(input.decision === "merged"
          ? [
              repos.applications.prepareUpdate(
                { memberId: candidate.memberId, updatedById: actor.user.id },
                whereFieldEquals("applications", "id", applicationId),
              ),
              repos.matchCandidates.prepareUpdate(
                { decidedAt: null, decidedById: null, status: "pending" },
                whereOtherMergedMatchCandidates(applicationId, candidateId),
              ),
            ]
          : []),
      ]);

      const updatedCandidate = await repos.matchCandidates.findOne(
        whereFieldEquals("match_candidates", "id", candidateId),
      );
      if (!updatedCandidate) {
        throw new Error("match_candidates row disappeared during decideMatch");
      }
      const updatedApplication = await requireApplication(applicationId);
      const [candidateView, applicationDetail] = await Promise.all([
        buildMatchCandidateView(repos, updatedCandidate),
        buildApplicationDetail(repos, updatedApplication),
      ]);

      return { application: applicationDetail, candidate: candidateView };
    },

    async get(applicationId) {
      const repos = repositories();
      const application = await requireApplication(applicationId);
      return buildApplicationDetail(repos, application);
    },

    async list(query) {
      const repos = repositories();
      const [applicationRows, checkRunRows, staffRows, memberRows] =
        await Promise.all([
          repos.applications.all(),
          repos.checkRuns.all(),
          repos.staffUsers.all(),
          repos.members.all(),
        ]);

      const triageByCheckRunId = new Map(
        checkRunRows.map((row) => [row.id, row.triage as Triage]),
      );
      const staffById = new Map(
        staffRows.map((row) => [row.id, toStaffUserSummary(row)]),
      );
      const memberById = new Map(
        memberRows.map((row) => [row.id, toMemberSummary(row)]),
      );

      function triageOf(row: ApplicationRow): Triage | null {
        return row.latestCheckRunId
          ? (triageByCheckRunId.get(row.latestCheckRunId) ?? null)
          : null;
      }

      const filtered = applicationRows.filter((row) => {
        if (query.appStatus && row.appStatus !== query.appStatus) {
          return false;
        }
        if (query.triage && triageOf(row) !== query.triage) {
          return false;
        }
        if (query.createdById && row.createdById !== query.createdById) {
          return false;
        }
        if (query.linked !== undefined) {
          const isLinked = row.memberId !== null;
          if (isLinked !== query.linked) {
            return false;
          }
        }
        if (query.needsReviewOnly && !isNeedsReview(triageOf(row))) {
          return false;
        }
        return true;
      });

      const sorted = [...filtered].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );

      const page = query.page && query.page > 0 ? query.page : DEFAULT_PAGE;
      const perPage = clampPerPage(query.perPage ?? DEFAULT_PER_PAGE);
      const start = (page - 1) * perPage;
      const pageRows = sorted.slice(start, start + perPage);

      const items: ApplicationSummary[] = pageRows.map((row) => {
        const createdBy = staffById.get(row.createdById);
        if (!createdBy) {
          throw new Error(
            `staff_users row not found for id ${row.createdById}`,
          );
        }
        return {
          appStatus: row.appStatus as AppStatus,
          createdAt: row.createdAt,
          createdBy,
          docType: row.docType,
          hasImage: row.imageKey !== null,
          id: row.id,
          member: row.memberId ? (memberById.get(row.memberId) ?? null) : null,
          triage: triageOf(row),
        } satisfies ApplicationSummary;
      });

      return { items, page, perPage, total: filtered.length };
    },

    async listCheckRuns(applicationId) {
      const repos = repositories();
      await requireApplication(applicationId);
      return buildCheckRunHistory(repos, applicationId);
    },

    async updateFields(applicationId, actor, input) {
      const repos = repositories();
      const application = await requireApplication(applicationId);
      const currentFields = JSON.parse(
        application.fieldsJson,
      ) as ApplicationField[];

      /**
       * 🔵 Intent: コードレビュー指摘#5。ラベルだけをキーにした`Map`だと、同じラベルを持つ
       * 項目が複数ある帳票(例: 氏名欄が2箇所)で、後勝ちの1件が同ラベル全項目へ適用されてしまう。
       * 画面(`ocr-page.tsx`・`application-detail-page.tsx`)は常に`application.fields`と同じ
       * 並び順で全項目を送り返すため、`input.fields`をその順で1件ずつ消費し、まだ対応付けて
       * いない同ラベルの最初の項目へ割り当てる。これにより出現順で位置を復元しつつ、既存の
       * 部分更新(未指定ラベルはそのまま)にも対応する。
       */
      const consumed = new Array(currentFields.length).fill(false);
      const nextValueByIndex = new Map<number, string>();
      for (const incoming of input.fields) {
        const matchIndex = currentFields.findIndex(
          (field, index) => !consumed[index] && field.label === incoming.label,
        );
        if (matchIndex === -1) {
          continue;
        }
        consumed[matchIndex] = true;
        nextValueByIndex.set(matchIndex, incoming.value);
      }

      // api.md #10: confidenceは変更しない。値が変わった項目、または既に編集済みの項目はeditedをtrueで維持する。
      const nextFields: ApplicationField[] = currentFields.map(
        (field, index) => {
          const nextValue = nextValueByIndex.get(index);
          if (nextValue === undefined) {
            return field;
          }
          return {
            ...field,
            edited: field.edited || nextValue !== field.value,
            value: nextValue,
          };
        },
      );
      const editedCount = nextFields.filter((field) => field.edited).length;

      await repos.applications.update(
        {
          editedCount,
          fieldsJson: JSON.stringify(nextFields),
          updatedById: actor.user.id,
        },
        whereFieldEquals("applications", "id", applicationId),
      );

      const updatedApplication = await requireApplication(applicationId);
      return buildApplicationDetail(repos, updatedApplication);
    },
  } satisfies ApplicationService);
}
