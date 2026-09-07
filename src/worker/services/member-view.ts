import type { TenantScopedRepositories } from "../db/repositories";
import { whereFieldEquals } from "../db/repositories";
import type { applications, members, statusHistory } from "../db/schema";
import type {
  ApplicationSummary,
  AppStatus,
  MemberDetail,
  MemberStatus,
  MemberSummary,
  StaffUserId,
  StaffUserSummary,
  StatusHistoryEntry,
  Triage,
} from "../types";
import { toMemberSummary, toStaffUserSummary } from "./application-view";

export type MemberRow = typeof members.$inferSelect;
type ApplicationRow = typeof applications.$inferSelect;
type StatusHistoryRow = typeof statusHistory.$inferSelect;

/**
 * 🟡 Intent: application-view.tsのrequireStaffSummaryと同じ変換だが、
 * 500行ルール・Worker内の責務分離のためファイルをまたいだ内部関数の共有はせず
 * ここで独立に定義する（公開関数のtoStaffUserSummaryのみ再利用する）。
 */
async function requireStaffSummary(
  repositories: TenantScopedRepositories,
  id: StaffUserId,
): Promise<StaffUserSummary> {
  const staff = await repositories.staffUsers.findOne(
    whereFieldEquals("staff_users", "id", id),
  );
  if (!staff) {
    throw new Error(`staff_users row not found for id ${id}`);
  }
  return toStaffUserSummary(staff);
}

/**
 * 🔵 Intent: F-5-6「申請履歴（原本画像へのリンク付き）」。`hasImage`を含む`ApplicationSummary`を
 * そのまま再利用し、リンク自体（署名付きURL取得）は画面側が`GET /api/images/:applicationId`を呼ぶ。
 */
async function toApplicationSummary(
  repositories: TenantScopedRepositories,
  row: ApplicationRow,
  memberSummary: MemberSummary,
): Promise<ApplicationSummary> {
  const [createdBy, checkRun] = await Promise.all([
    requireStaffSummary(repositories, row.createdById),
    row.latestCheckRunId
      ? repositories.checkRuns.findOne(
          whereFieldEquals("check_runs", "id", row.latestCheckRunId),
        )
      : Promise.resolve(null),
  ]);
  return {
    appStatus: row.appStatus as AppStatus,
    createdAt: row.createdAt,
    createdBy,
    docType: row.docType,
    hasImage: row.imageKey !== null,
    id: row.id,
    member: memberSummary,
    triage: checkRun ? (checkRun.triage as Triage) : null,
  } satisfies ApplicationSummary;
}

/** 🔵 Intent: F-5-6「状態遷移履歴」。他の履歴一覧（F-3-7・app_status_history）と同じ「新しい順」に揃える。 */
async function buildStatusHistory(
  repositories: TenantScopedRepositories,
  memberId: MemberRow["id"],
): Promise<StatusHistoryEntry[]> {
  const rows = await repositories.statusHistory.find(
    whereFieldEquals("status_history", "memberId", memberId),
  );
  const sorted = [...rows].sort((a: StatusHistoryRow, b: StatusHistoryRow) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return Promise.all(
    sorted.map(async (row) => ({
      createdAt: row.createdAt,
      createdBy: await requireStaffSummary(repositories, row.createdById),
      fromStatus: row.fromStatus as MemberStatus | null,
      id: row.id,
      reason: row.reason,
      toStatus: row.toStatus as MemberStatus,
    })),
  );
}

/**
 * 🔵 Intent: `MemberDetail`の組み立てをここへ集約し、get/create/update/changeStatusの
 * 全経路（api.md #20〜23）から同じ組み立てを再利用する（application-view.tsの
 * buildApplicationDetailと同じ方針）。
 */
export async function buildMemberDetail(
  repositories: TenantScopedRepositories,
  member: MemberRow,
): Promise<MemberDetail> {
  const memberSummary = toMemberSummary(member);
  const [applicationRows, statusHistoryEntries] = await Promise.all([
    repositories.applications.find(
      whereFieldEquals("applications", "memberId", member.id),
    ),
    buildStatusHistory(repositories, member.id),
  ]);
  const sortedApplicationRows = [...applicationRows].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const applicationSummaries = await Promise.all(
    sortedApplicationRows.map((row) =>
      toApplicationSummary(repositories, row, memberSummary),
    ),
  );

  return {
    ...memberSummary,
    address: member.address,
    applications: applicationSummaries,
    createdAt: member.createdAt,
    email: member.email,
    postalCode: member.postalCode,
    statusHistory: statusHistoryEntries,
  } satisfies MemberDetail;
}
