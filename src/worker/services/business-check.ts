import type { TenantRepository } from "../db/repositories";
import { whereFieldEquals } from "../db/repositories";
import type { OperationTrace } from "../observability/operation-trace";
import {
  ApiErrorException,
  type AppConfig,
  type ApplicationField,
  type ApplicationId,
  type RunCheckResponse,
  toCheckRunId,
  toMatchCandidateId,
} from "../types";
import { buildApplicationDetail } from "./application-view";
import type { SessionActor } from "./auth";
import { runBusinessCheckAi } from "./business-check-ai";
import { createGeminiClient } from "./gemini-client";
import { findMatchCandidates } from "./matching";
import {
  BIRTH_DATE_LABELS,
  NAME_KANA_LABELS,
  NAME_LABELS,
  PHONE_LABELS,
} from "./matching-constants";
import { type MemberIdentity, normalizeMemberInput } from "./member-normalizer";
import type { UsageService } from "./usage";

export interface BusinessCheckService {
  run(
    actor: SessionActor,
    applicationId: ApplicationId,
  ): Promise<RunCheckResponse>;
}

export interface BusinessCheckServiceOptions {
  readonly config: AppConfig;
  readonly apiKey: string;
  readonly repository: TenantRepository;
  readonly usage: UsageService;
  readonly trace?: OperationTrace;
  readonly requestFetch?: typeof fetch;
}

function findFieldValue(
  fields: ApplicationField[],
  labels: ReadonlySet<string>,
): string | null {
  const field = fields.find((candidate) => labels.has(candidate.label.trim()));
  if (!field || field.value.trim().length === 0) {
    return null;
  }
  return field.value;
}

/** 🔵 Intent: F-6の第1段（決定的正規化・findMatchCandidates）が要求するMemberIdentityへ変換する。 */
function extractMemberIdentity(fields: ApplicationField[]): MemberIdentity {
  return {
    birthDate: findFieldValue(fields, BIRTH_DATE_LABELS),
    name: findFieldValue(fields, NAME_LABELS) ?? "",
    nameKana: findFieldValue(fields, NAME_KANA_LABELS),
    phone: findFieldValue(fields, PHONE_LABELS),
  };
}

/**
 * 🔵 Intent: dataflow.md「AI業務チェックと名寄せ」の順序どおりに実装する。
 * ① 状態検証（承認済み409・上限409）→ ② received→under_reviewの自動遷移（F-4-7、
 * ステータス更新+履歴追加を単一のD1トランザクションで）→ ③ 名寄せ第1段・第2段（ともに
 * AI不使用。findMatchCandidatesがスコアリングと同一人物の可能性判定の両方を行う・決定#27）→
 * ④ UsageCounter加算（NF-2-39・AI呼び出し前）→ ⑤ Pass②（申請データのみのCheckResult、
 * business-check-ai.tsへ委譲）→ ⑥ CheckRun保存・最新ID更新・MatchCandidate UPSERT・
 * 今回の上位5件から外れたpending/hold候補のstale化（コードレビュー指摘#5）を
 * 単一のD1トランザクションでまとめて行う（コードレビュー指摘#2:
 * 途中失敗でCheckRunだけ/候補の一部だけが保存された状態を作らない）。
 */
export function createBusinessCheckService(
  options: BusinessCheckServiceOptions,
): BusinessCheckService {
  const { config, repository, usage, trace } = options;
  const geminiClient = createGeminiClient({
    aiGatewayAccountId: config.aiGatewayAccountId,
    aiGatewayId: config.aiGatewayId,
    apiKey: options.apiKey,
    model: config.geminiModel,
    requestFetch: options.requestFetch,
  });

  return Object.freeze({
    async run(
      actor: SessionActor,
      applicationId: ApplicationId,
    ): Promise<RunCheckResponse> {
      const repositories = repository.forTenant(config.tenantId);

      const application = await repositories.applications.findOne(
        whereFieldEquals("applications", "id", applicationId),
      );
      if (!application) {
        throw new ApiErrorException("NOT_FOUND");
      }
      if (application.appStatus === "approved") {
        throw new ApiErrorException("INVALID_TRANSITION");
      }

      // コードレビュー指摘#3: 件数を読み取ってから判定するのではなく、単一の条件付き
      // UPDATE（applications.checkRunCount、usage_counterのNF-2-39と同じ規律）で
      // AI呼び出し前に予約する。並行した2リクエストが両方とも判定を通過するのを防ぐ。
      const checkRunReservation =
        await repositories.applications.reserveCheckRunSlot(
          applicationId,
          config.maxCheckRunsPerApplication,
        );
      if (!checkRunReservation) {
        throw new ApiErrorException("CHECK_RUN_LIMIT");
      }

      if (application.appStatus === "received") {
        // コードレビュー指摘#2: ステータス更新と履歴追加を1つのD1トランザクションにまとめ、
        // 片方だけ成功する状態を作らない。
        await repositories.runTransaction([
          repositories.applications.prepareUpdate(
            { appStatus: "under_review" },
            whereFieldEquals("applications", "id", applicationId),
          ),
          repositories.appStatusHistory.prepareInsert({
            applicationId,
            createdById: actor.user.id,
            fromStatus: "received",
            id: crypto.randomUUID(),
            note: null,
            toStatus: "under_review",
          }),
        ]);
      }

      const fields = JSON.parse(application.fieldsJson) as ApplicationField[];
      const normalizedInput = normalizeMemberInput(
        extractMemberIdentity(fields),
      );
      const ruleCandidates = await findMatchCandidates(
        { applicationId, repositories },
        normalizedInput,
      );

      // NF-2-17・NF-2-34: Pass②もGemini呼び出し回数の合算対象。AI呼び出し前に加算する(NF-2-39)。
      const usageResponse = await usage.consumeGemini();

      const aiResult = await runBusinessCheckAi(
        geminiClient,
        {
          docType: application.docType,
          fields: fields.map((field) => ({
            label: field.label,
            value: field.value,
          })),
        },
        trace,
      );

      // 決定#24・api.md: UNIQUE(applicationId, memberId)により、再実施時はruleScore/aiLikelihoodを
      // 更新する。rejected済みはfindMatchCandidatesの時点で除外済み(F-6-10)のためここへ現れない。
      // 決定#27: aiLikelihood/aiReasonはcandidate.likelihood/reason（ルールベース判定、matching.ts）
      // をそのまま書き込む。AIへ候補会員の個人情報を渡す経路はここに無い。
      const existingMatchRows = await repositories.matchCandidates.find(
        whereFieldEquals("match_candidates", "applicationId", applicationId),
      );
      const existingByMemberId = new Map(
        existingMatchRows.map((row) => [row.memberId, row]),
      );
      const ruleCandidateMemberIds = new Set(
        ruleCandidates.map((candidate) => candidate.member.id),
      );

      const matchCandidateOps = ruleCandidates.map((candidate) => {
        const existingRow = existingByMemberId.get(candidate.member.id);
        if (existingRow) {
          return repositories.matchCandidates.prepareUpdate(
            {
              aiLikelihood: candidate.likelihood,
              aiReason: candidate.reason,
              ruleScore: candidate.ruleScore,
              // コードレビュー指摘#5: 前回staleへ無効化された候補が今回また上位5件に
              // 戻ってきた場合、staleのまま固定せず未判断(pending)へ戻す。
              ...(existingRow.status === "stale"
                ? { status: "pending" as const }
                : {}),
            },
            whereFieldEquals("match_candidates", "id", existingRow.id),
          );
        }
        return repositories.matchCandidates.prepareInsert({
          aiLikelihood: candidate.likelihood,
          aiReason: candidate.reason,
          applicationId,
          decidedAt: null,
          decidedById: null,
          id: toMatchCandidateId(crypto.randomUUID()),
          memberId: candidate.member.id,
          ruleScore: candidate.ruleScore,
          status: "pending",
        });
      });

      /**
       * コードレビュー指摘#5: 今回の上位5件から外れた既存のpending/hold候補は、
       * 削除せずstaleへ無効化する。削除しないのはholdの判断記録（F-6-9）を残すため。
       * merged/rejectedはここで一切触れない(mergedは確定した紐付け、rejectedは
       * F-6-10により既にfindMatchCandidatesのスコアリング対象からも除外済み)。
       */
      const staleOps = existingMatchRows
        .filter(
          (row) =>
            (row.status === "pending" || row.status === "hold") &&
            !ruleCandidateMemberIds.has(row.memberId),
        )
        .map((row) =>
          repositories.matchCandidates.prepareUpdate(
            { status: "stale" },
            whereFieldEquals("match_candidates", "id", row.id),
          ),
        );

      // コードレビュー指摘#2: CheckRun保存・最新ID更新・候補UPSERTを1つのD1トランザクションに
      // まとめる。途中で失敗した場合にCheckRunだけ残る/候補の一部だけ更新される状態を作らない。
      const checkRunId = toCheckRunId(crypto.randomUUID());
      await repositories.runTransaction([
        repositories.checkRuns.prepareInsert({
          applicationId,
          consistencyJson: JSON.stringify(aiResult.consistency),
          createdById: actor.user.id,
          deficienciesJson: JSON.stringify(aiResult.deficiencies),
          id: checkRunId,
          letterDraft: aiResult.letterDraft,
          triage: aiResult.triage,
          triageReason: aiResult.triageReason,
        }),
        repositories.applications.prepareUpdate(
          { latestCheckRunId: checkRunId, updatedById: actor.user.id },
          whereFieldEquals("applications", "id", applicationId),
        ),
        ...matchCandidateOps,
        ...staleOps,
      ]);

      const updatedApplication = await repositories.applications.findOne(
        whereFieldEquals("applications", "id", applicationId),
      );
      if (!updatedApplication) {
        throw new Error("application disappeared during business check");
      }
      const applicationDetail = await buildApplicationDetail(
        repositories,
        updatedApplication,
      );
      const checkRun = applicationDetail.latestCheckRun;
      if (!checkRun) {
        throw new Error("latestCheckRun missing after business check");
      }

      const remainingRuns = Math.max(
        0,
        config.maxCheckRunsPerApplication - checkRunReservation.checkRunCount,
      );

      return {
        application: applicationDetail,
        checkRun,
        matchCandidates: applicationDetail.matchCandidates,
        remainingRuns,
        usage: usageResponse,
      };
    },
  } satisfies BusinessCheckService);
}
