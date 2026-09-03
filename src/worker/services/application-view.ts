import type { TenantScopedRepositories } from "../db/repositories";
import { whereFieldEquals } from "../db/repositories";
import type {
  applications,
  appStatusHistory,
  checkRuns,
  matchCandidates,
  members,
  staffUsers,
} from "../db/schema";
import type {
  ApplicationDetail,
  ApplicationField,
  AppStatus,
  AppStatusHistoryEntry,
  CheckRunView,
  ConsistencyIssue,
  Deficiency,
  Likelihood,
  MatchCandidateView,
  MatchStatus,
  MemberId,
  MemberStatus,
  MemberSummary,
  StaffUserId,
  StaffUserSummary,
  Triage,
} from "../types";

type ApplicationRow = typeof applications.$inferSelect;
type StaffRow = typeof staffUsers.$inferSelect;
type MemberRow = typeof members.$inferSelect;
type CheckRunRow = typeof checkRuns.$inferSelect;
type MatchCandidateRow = typeof matchCandidates.$inferSelect;
type AppStatusHistoryRow = typeof appStatusHistory.$inferSelect;

function toStaffUserSummary(staff: StaffRow): StaffUserSummary {
  return {
    email: staff.email,
    id: staff.id,
    isActive: staff.isActive,
    name: staff.name,
    role: staff.role === "admin" ? "admin" : "staff",
  };
}

function toMemberSummary(member: MemberRow): MemberSummary {
  return {
    birthDate: member.birthDate,
    id: member.id,
    memberNumber: member.memberNumber,
    name: member.name,
    nameKana: member.nameKana,
    phone: member.phone,
    status: member.status as MemberStatus,
  };
}

/**
 * 🔵 Intent: applications.createdByIdはNOT NULL（アプリ外で行が作られ得ないため）。
 * 参照先が見つからない場合はFK不整合であり、呼び出し元に握り潰させず例外にする。
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

async function optionalStaffSummary(
  repositories: TenantScopedRepositories,
  id: StaffUserId | null,
): Promise<StaffUserSummary | null> {
  return id ? requireStaffSummary(repositories, id) : null;
}

async function optionalMemberSummary(
  repositories: TenantScopedRepositories,
  id: MemberId | null,
): Promise<MemberSummary | null> {
  if (!id) {
    return null;
  }
  const member = await repositories.members.findOne(
    whereFieldEquals("members", "id", id),
  );
  return member ? toMemberSummary(member) : null;
}

function toCheckRunView(
  row: CheckRunRow,
  createdBy: StaffUserSummary,
): CheckRunView {
  return {
    applicationId: row.applicationId,
    consistency: JSON.parse(row.consistencyJson) as ConsistencyIssue[],
    createdAt: row.createdAt,
    createdBy,
    deficiencies: JSON.parse(row.deficienciesJson) as Deficiency[],
    id: row.id,
    letterDraft: row.letterDraft,
    triage: row.triage as Triage,
    triageReason: row.triageReason,
  };
}

async function optionalCheckRunView(
  repositories: TenantScopedRepositories,
  id: CheckRunRow["id"] | null,
): Promise<CheckRunView | null> {
  if (!id) {
    return null;
  }
  const row = await repositories.checkRuns.findOne(
    whereFieldEquals("check_runs", "id", id),
  );
  if (!row) {
    return null;
  }
  const createdBy = await requireStaffSummary(repositories, row.createdById);
  return toCheckRunView(row, createdBy);
}

/**
 * 🔵 Intent: `rejected`はF-6-10・types.md §5の注記どおり、候補カード用の一覧からは
 * 除外する（重複疑いリストのような専用の履歴表示だけがrejectedを扱う）。
 * `stale`も同様に除外する（コードレビュー指摘#5）。業務チェック再実施のたびに
 * 今回の上位5件から外れた`pending`/`hold`候補がここへ`stale`として溜まり続けるため、
 * 候補カードには出さない。行自体は削除せずbusiness-check.tsが`stale`へ更新するのみ
 * （`hold`の判断記録=F-6-9を保持するため）。
 */
async function buildMatchCandidateViews(
  repositories: TenantScopedRepositories,
  applicationId: ApplicationRow["id"],
): Promise<MatchCandidateView[]> {
  const rows = await repositories.matchCandidates.find(
    whereFieldEquals("match_candidates", "applicationId", applicationId),
  );
  const visible = rows.filter(
    (row: MatchCandidateRow) =>
      row.status !== "rejected" && row.status !== "stale",
  );

  return Promise.all(
    visible.map(async (row) => {
      const member = await repositories.members.findOne(
        whereFieldEquals("members", "id", row.memberId),
      );
      if (!member) {
        throw new Error(`members row not found for id ${row.memberId}`);
      }
      const decidedBy = await optionalStaffSummary(
        repositories,
        row.decidedById,
      );
      return {
        aiLikelihood: row.aiLikelihood as Likelihood | null,
        aiReason: row.aiReason,
        decidedAt: row.decidedAt,
        decidedBy,
        id: row.id,
        member: toMemberSummary(member),
        ruleScore: row.ruleScore,
        status: row.status as MatchStatus,
      } satisfies MatchCandidateView;
    }),
  );
}

/** 🔵 Intent: GET /api/applications/:id/check-runs等と同じ「新しい順」（F-3-7）で揃える。 */
async function buildStatusHistory(
  repositories: TenantScopedRepositories,
  applicationId: ApplicationRow["id"],
): Promise<AppStatusHistoryEntry[]> {
  const rows = await repositories.appStatusHistory.find(
    whereFieldEquals("app_status_history", "applicationId", applicationId),
  );
  const sorted = [...rows].sort(
    (a: AppStatusHistoryRow, b: AppStatusHistoryRow) =>
      b.createdAt.localeCompare(a.createdAt),
  );
  return Promise.all(
    sorted.map(async (row) => ({
      createdAt: row.createdAt,
      createdBy: await requireStaffSummary(repositories, row.createdById),
      fromStatus: row.fromStatus as AppStatus | null,
      id: row.id,
      note: row.note,
      toStatus: row.toStatus as AppStatus,
    })),
  );
}

/**
 * 🟡 Intent: `ApplicationDetail`の組み立てをここへ集約する。POST /api/checks/run（Task 009）
 * だけでなく、GET /api/applications/:id・PATCH .../fields・POST .../status（Task 010、
 * すべて同じ`ApplicationDetail`を返す・api.md #9〜11）が今後同じ組み立てを必要とするため、
 * 呼び出し側ごとに複製しない一箇所として`services/`層に置く。
 */
export async function buildApplicationDetail(
  repositories: TenantScopedRepositories,
  application: ApplicationRow,
): Promise<ApplicationDetail> {
  const [
    createdBy,
    updatedBy,
    member,
    latestCheckRun,
    matchCandidateViews,
    statusHistory,
  ] = await Promise.all([
    requireStaffSummary(repositories, application.createdById),
    optionalStaffSummary(repositories, application.updatedById),
    optionalMemberSummary(repositories, application.memberId),
    optionalCheckRunView(repositories, application.latestCheckRunId),
    buildMatchCandidateViews(repositories, application.id),
    buildStatusHistory(repositories, application.id),
  ]);

  const fields = JSON.parse(application.fieldsJson) as ApplicationField[];

  return {
    appStatus: application.appStatus as AppStatus,
    createdAt: application.createdAt,
    createdBy,
    docType: application.docType,
    editedCount: application.editedCount,
    fields,
    hasImage: application.imageKey !== null,
    id: application.id,
    latestCheckRun,
    matchCandidates: matchCandidateViews,
    member,
    processingSec: application.processingSec,
    statusHistory,
    triage: latestCheckRun?.triage ?? null,
    updatedBy,
  } satisfies ApplicationDetail;
}
