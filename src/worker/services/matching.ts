import {
  type TenantScopedRepositories,
  whereFieldEquals,
} from "../db/repositories";
import type { members } from "../db/schema";
import type {
  ApplicationId,
  Likelihood,
  MemberStatus,
  MemberSummary,
  RuleScoreBreakdown,
} from "../types";
import { SCORE_WEIGHTS } from "./matching-constants";
import type { NormalizedMemberIdentity } from "./member-normalizer";

/**
 * 🔵 Intent: findMatchCandidatesが必要とする最小の依存だけを束ねる。DI層
 * （context.get("repository").forTenant()）がそのまま渡す`TenantScopedRepositories`を
 * 受け取れる形にし、生の`ScopedDb`をroute/service層へ露出させない（NF-5-6）。
 * Task 009が業務チェック実施のapplicationIdを渡すことで、F-6-10のrejected除外が
 * ここで行える。
 */
export interface TenantScope {
  repositories: TenantScopedRepositories;
  applicationId: ApplicationId;
}

export interface RuleMatchCandidate {
  member: MemberSummary;
  ruleScore: number;
  breakdown: RuleScoreBreakdown;
  likelihood: Likelihood;
  reason: string;
}

type MemberRow = typeof members.$inferSelect;

const MAX_CANDIDATES = 5;

/**
 * 🔵 Intent: F-6-3の3条件を独立に判定し、真の条件だけ加算してruleScoreとする。
 * 氏名一致は住所を条件に含めない（住所前方一致は方向性の欠陥により撤回。決定#21参照）。
 */
function scoreMember(
  input: NormalizedMemberIdentity,
  member: MemberRow,
): RuleScoreBreakdown {
  const kanaAndBirthDate =
    input.kanaNormalized.length > 0 &&
    input.kanaNormalized === member.kanaNormalized &&
    input.birthDateNormalized !== null &&
    input.birthDateNormalized === member.birthDate;

  const phone =
    input.phoneNormalized !== null && input.phoneNormalized === member.phone;

  const name =
    input.nameNormalized.length > 0 &&
    input.nameNormalized === member.nameNormalized;

  const total =
    (kanaAndBirthDate ? SCORE_WEIGHTS.kanaAndBirthDate : 0) +
    (phone ? SCORE_WEIGHTS.phone : 0) +
    (name ? SCORE_WEIGHTS.name : 0);

  return { kanaAndBirthDate, name, phone, total };
}

/**
 * 🔵 Intent: 決定#27によりF-6-5の「同一人物の可能性」はAIではなくルールベースで判定する
 * （既存会員の個人情報をAIへ送信しないため）。「高スコア」条件（カナ+生年月日一致・
 * 電話番号一致）が2つとも成立→high、いずれか1つのみ→medium、正規化後氏名一致のみ→low。
 */
function classifyLikelihood(breakdown: RuleScoreBreakdown): Likelihood {
  const strongMatchCount =
    Number(breakdown.kanaAndBirthDate) + Number(breakdown.phone);
  if (strongMatchCount >= 2) {
    return "high";
  }
  return strongMatchCount === 1 ? "medium" : "low";
}

/** 🔵 Intent: 決定#27。classifyLikelihoodと同じ内訳から、根拠を示す定型文を組み立てる。 */
function describeLikelihoodReason(breakdown: RuleScoreBreakdown): string {
  const matchedConditions: string[] = [];
  if (breakdown.kanaAndBirthDate) {
    matchedConditions.push("カナ氏名と生年月日");
  }
  if (breakdown.phone) {
    matchedConditions.push("電話番号");
  }
  if (breakdown.name) {
    matchedConditions.push("氏名（正規化後）");
  }
  return `${matchedConditions.join("・")}が一致しているため。`;
}

function toMemberSummary(member: MemberRow): MemberSummary {
  return {
    birthDate: member.birthDate,
    id: member.id,
    memberNumber: member.memberNumber,
    name: member.name,
    nameKana: member.nameKana,
    phone: member.phone,
    // 🟡 Intent: DB層はCHECK制約で値集合を保証済みのため、境界での型アサーションに留める。
    status: member.status as MemberStatus,
  };
}

/**
 * 🔵 Intent: F-6-3の3条件それぞれが成立し得る場合だけ、対応する索引列
 * （members_tenant_kana_normalized_index・members_tenant_phone_index・
 * members_tenant_name_normalized_index）で絞り込んだ問い合わせを発行する。
 * 全件スキャンを避けるための候補集合であり、最終的な条件判定は
 * scoreMemberが行う（索引列だけでは生年月日まで判定できないため）。
 */
async function candidateRowsForConditions(
  repositories: TenantScopedRepositories,
  input: NormalizedMemberIdentity,
): Promise<MemberRow[]> {
  const lookups: Promise<MemberRow[]>[] = [];

  if (input.kanaNormalized.length > 0 && input.birthDateNormalized !== null) {
    lookups.push(
      repositories.members.find(
        whereFieldEquals("members", "kanaNormalized", input.kanaNormalized),
      ),
    );
  }

  if (input.phoneNormalized !== null) {
    lookups.push(
      repositories.members.find(
        whereFieldEquals("members", "phone", input.phoneNormalized),
      ),
    );
  }

  if (input.nameNormalized.length > 0) {
    lookups.push(
      repositories.members.find(
        whereFieldEquals("members", "nameNormalized", input.nameNormalized),
      ),
    );
  }

  const rowSets = await Promise.all(lookups);
  const uniqueById = new Map<string, MemberRow>();
  for (const rows of rowSets) {
    for (const row of rows) {
      uniqueById.set(row.id, row);
    }
  }
  return [...uniqueById.values()];
}

/**
 * 🔵 Intent: AIを呼ばずテナント内会員だけを決定的にスコアリングし、同一人物の可能性も
 * ルールベースで判定する（F-6-3・F-6-4・F-6-5・F-6-12・決定#27）。会員の個人情報はここから
 * 外部へ送信しない。このapplicationIdに対してrejected済みの組み合わせは候補から除外する（F-6-10）。
 */
export async function findMatchCandidates(
  scope: TenantScope,
  input: NormalizedMemberIdentity,
): Promise<RuleMatchCandidate[]> {
  const [candidateMembers, existingCandidates] = await Promise.all([
    candidateRowsForConditions(scope.repositories, input),
    scope.repositories.matchCandidates.find(
      whereFieldEquals(
        "match_candidates",
        "applicationId",
        scope.applicationId,
      ),
    ),
  ]);

  const rejectedMemberIds = new Set(
    existingCandidates
      .filter((candidate) => candidate.status === "rejected")
      .map((candidate) => candidate.memberId),
  );

  const scored = candidateMembers
    .filter((member) => !rejectedMemberIds.has(member.id))
    .map((member) => ({ breakdown: scoreMember(input, member), member }))
    .filter((entry) => entry.breakdown.total > 0)
    .sort((a, b) => {
      if (b.breakdown.total !== a.breakdown.total) {
        return b.breakdown.total - a.breakdown.total;
      }
      // 🔵 Intent: 同点時はDBの返却順に依存させず、member.id昇順で決定的にする。
      return a.member.id.localeCompare(b.member.id);
    });

  return scored.slice(0, MAX_CANDIDATES).map((entry) => ({
    breakdown: entry.breakdown,
    likelihood: classifyLikelihood(entry.breakdown),
    member: toMemberSummary(entry.member),
    reason: describeLikelihoodReason(entry.breakdown),
    ruleScore: entry.breakdown.total,
  }));
}
