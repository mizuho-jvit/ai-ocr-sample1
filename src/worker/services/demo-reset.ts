import type { TenantRepository } from "../db/repositories";
import { whereAll, whereFieldEquals } from "../db/repositories";
import { emitDemoResetLog } from "../observability/logger";
import {
  ApiErrorException,
  type AppConfig,
  type ImageKey,
  type ResetPreviewResponse,
  type ResetRequest,
  type ResetResponse,
} from "../types";
import type { SessionActor } from "./auth";
import { type ImageStorage, PartialImageDeleteError } from "./image-storage";

/**
 * 🔵 Intent: F-9-7・[決定#5](../../../knowledge/wiki/architecture/api.md)。
 * IMEを経由せず入力でき、誤入力しにくい固定の確認語とする（ランダム生成しない）。
 */
const CONFIRMATION_WORD = "RESET";

const textEncoder = new TextEncoder();

/**
 * 🟡 Intent: コードレビュー指摘・P2・決定#51。previewが提示した削除対象集合と、
 * 実行時に実際に削除する集合が一致することを検証するためのダイジェスト。
 * 順序に依存しないよう、IDをソートしてから固定形式へ直列化しSHA-256をとる。
 */
async function computeSnapshotToken(
  applicationIds: readonly string[],
  memberIds: readonly string[],
): Promise<string> {
  const payload = JSON.stringify({
    applications: [...applicationIds].sort(),
    members: [...memberIds].sort(),
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(payload),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface DemoResetService {
  preview(): Promise<ResetPreviewResponse>;
  reset(input: ResetRequest, actor: SessionActor): Promise<ResetResponse>;
}

export interface DemoResetServiceOptions {
  readonly config: AppConfig;
  readonly repository: TenantRepository;
  readonly imageStorage: ImageStorage;
}

function validationError(): ApiErrorException {
  return new ApiErrorException("VALIDATION_ERROR");
}

/**
 * 🔵 Intent: F-9・api.md #27〜28を実装する。件数はデモ規模を前提に全件取得して
 * JS側で数える(決定#29・#41と同じ方針)。削除本体はF-9-11の順序を厳守する。
 */
export function createDemoResetService(
  options: DemoResetServiceOptions,
): DemoResetService {
  const { config, imageStorage, repository } = options;
  const repositories = () => repository.forTenant(config.tenantId);

  /**
   * 🔵 Intent: F-9-11①。削除対象のimageKeyは、D1の削除(②)より前にここで確定させる
   * （コードレビュー指摘・P1・決定#50）。D1削除後にR2のprefixを再列挙する方式だと、
   * その間に完了した別リクエスト（OCR登録等）がR2へ保存した新しい画像まで削除してしまい、
   * D1に残るimageKey付きの申請と対応するR2オブジェクトの不整合を生む。
   */
  async function countPendingDeletion() {
    const repos = repositories();
    const applications = await repos.applications.all();
    const nonSeedMembers = await repos.members.find(
      whereFieldEquals("members", "isSeed", false),
    );
    const imageKeys = applications
      .map((application) => application.imageKey)
      .filter((imageKey): imageKey is ImageKey => imageKey !== null);
    const snapshotToken = await computeSnapshotToken(
      applications.map((application) => application.id),
      nonSeedMembers.map((member) => member.id),
    );
    return {
      applicationsCount: applications.length,
      imageKeys,
      nonSeedMembersCount: nonSeedMembers.length,
      snapshotToken,
    };
  }

  return Object.freeze({
    async preview() {
      const counts = await countPendingDeletion();
      return {
        applications: counts.applicationsCount,
        confirmationWord: CONFIRMATION_WORD,
        images: counts.imageKeys.length,
        members: counts.nonSeedMembersCount,
        snapshotToken: counts.snapshotToken,
      };
    },

    async reset(input, actor) {
      if (input.confirmation !== CONFIRMATION_WORD) {
        throw validationError();
      }

      const repos = repositories();
      const counts = await countPendingDeletion();

      /**
       * 🟡 Intent: コードレビュー指摘・P2・決定#51。previewの表示後に別リクエストが
       * 申請・非seed会員を追加/削除していれば、削除対象集合のダイジェストが変わり
       * ここで検出できる。F-9-7の「事前提示した件数で確認させる」安全策を、
       * 実際の削除対象に対しても成立させるため、不一致なら実行せず409で停止する
       * （名寄せ判断・スタッフ編集と同じくINVALID_TRANSITIONを再利用。決定#32・#44）。
       */
      if (input.snapshotToken !== counts.snapshotToken) {
        throw new ApiErrorException("INVALID_TRANSITION");
      }

      /**
       * 🔵 Intent: F-9-11 ①→②。applications.latestCheckRunIdとcheckRuns.applicationId
       * は循環参照のため、check_runsを消す前にapplications側の参照を外す必要がある
       * （business-check.test.tsのテスト間クリーンアップと同じ制約）。子テーブルの削除は
       * D1Database.batch（単一トランザクション）で原子的に行う(決定#49)。
       */
      await repos.runTransaction([
        repos.applications.prepareUpdate(
          { latestCheckRunId: null },
          whereAll(),
        ),
        repos.matchCandidates.prepareDelete(whereAll()),
        repos.checkRuns.prepareDelete(whereAll()),
        repos.appStatusHistory.prepareDelete(whereAll()),
        repos.applications.prepareDelete(whereAll()),
        // F-9-4: StatusHistoryはシード会員の分も含めて全削除する。
        repos.statusHistory.prepareDelete(whereAll()),
        // F-9-2・F-9-3: シード会員は削除しない。
        repos.members.prepareDelete(
          whereFieldEquals("members", "isSeed", false),
        ),
      ]);

      // F-9-11 ③: D1の削除が確定した後、①で確定した集合(counts.imageKeys)だけをR2から
      // 削除する。ここでR2をprefix再列挙すると、②の完了後・③の実行前に完了した別リクエストの
      // 新規アップロードまで削除してしまう（コードレビュー指摘・P1・決定#50）。
      let deletedImages: number;
      try {
        deletedImages = await imageStorage.deleteMany(counts.imageKeys);
      } catch (error) {
        /**
         * 🟡 Intent: コードレビュー指摘・P2・決定#52。R2削除が途中で失敗しても、②の
         * D1削除は既に確定している。実行者・D1側の削除件数を監査ログへ残してから、
         * 元の例外をそのまま再throwする（業務上の失敗を隠さない・LOG-2と同じ規律）。
         * `deletedImages`にはR2側でそこまでに確定した件数(`PartialImageDeleteError`が
         * 持つ値。それ以外の例外なら0件)を渡す。
         */
        emitDemoResetLog({
          deletedApplications: counts.applicationsCount,
          deletedImages:
            error instanceof PartialImageDeleteError ? error.deletedCount : 0,
          deletedMembers: counts.nonSeedMembersCount,
          executedById: actor.user.id,
          outcome: "partial_failure",
        });
        throw error;
      }

      emitDemoResetLog({
        deletedApplications: counts.applicationsCount,
        deletedImages,
        deletedMembers: counts.nonSeedMembersCount,
        executedById: actor.user.id,
        outcome: "success",
      });

      return {
        deleted: {
          applications: counts.applicationsCount,
          images: deletedImages,
          members: counts.nonSeedMembersCount,
        },
        // F-9-9・NF-2-40: UsageCounterは初期化しない。常にfalseを返し画面に表示させる。
        usageCounterReset: false,
      };
    },
  } satisfies DemoResetService);
}
