import type {
  AppStatus,
  Likelihood,
  MatchStatus,
  MemberStatus,
  Role,
  Triage,
} from "../worker/types/contracts";

/**
 * 🔵 Intent: 表示ラベルは`knowledge/wiki/db/data-model.md`「状態値の永続化」の対応表を
 * そのまま実装する。永続値は英字コードのまま変えず、日本語ラベルは画面側だけで持つ。
 */
export const APP_STATUS_LABELS: Record<AppStatus, string> = {
  approved: "承認",
  received: "受付",
  returned: "差戻し",
  under_review: "審査中",
};

export const TRIAGE_LABELS: Record<Triage, string> = {
  approval_candidate: "承認候補",
  needs_review: "要審査",
  return_candidate: "差戻し候補",
};

export const LIKELIHOOD_LABELS: Record<Likelihood, string> = {
  high: "高",
  low: "低",
  medium: "中",
};

/** `stale`は職員向けの表示を持たない内部状態（候補カード一覧に出さない）。 */
export const MATCH_STATUS_LABELS: Record<
  Exclude<MatchStatus, "stale">,
  string
> = {
  hold: "保留",
  merged: "同一人物",
  pending: "未判断",
  rejected: "別人",
};

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  active: "利用資格あり",
  inactive: "退会",
  pending: "申請中",
  suspended: "停止中",
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: "管理者",
  staff: "担当者",
};
