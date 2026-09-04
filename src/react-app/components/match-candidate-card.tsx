import {
  BIRTH_DATE_LABELS,
  findFieldValueByLabels,
  NAME_KANA_LABELS,
  NAME_LABELS,
  PHONE_LABELS,
} from "../../shared/field-label-aliases";
import type {
  ApplicationDetail,
  ApplicationField,
  MatchCandidateView,
  MatchStatus,
} from "../../worker/types/contracts";
import { LIKELIHOOD_LABELS, MATCH_STATUS_LABELS } from "../labels";

/**
 * 🔵 Intent: コードレビュー指摘#6。バックエンドの名寄せ判定（business-check.ts）と同じ
 * 表記ゆれ辞書（決定#26・#38）を使う。以前はラベル文字列の完全一致だけだったため、
 * OCRが「フリガナ」等の別表記で抽出した項目を拾えず、実際は一致している値が
 * 空欄・不一致ハイライトとして誤表示されていた。
 */
function findFieldValue(
  fields: ApplicationField[],
  labels: ReadonlySet<string>,
): string {
  return findFieldValueByLabels(fields, labels) ?? "";
}

interface DiffRowProps {
  applicantValue: string;
  label: string;
  memberValue: string;
}

/** F-6-7: 申請データと会員データの項目を左右に並べ、一致しない行をハイライトする。 */
function DiffRow({ applicantValue, label, memberValue }: DiffRowProps) {
  const differs = applicantValue !== memberValue;
  return (
    <div
      data-differs={differs}
      style={{
        background: differs ? "var(--amber-bg)" : "transparent",
        display: "grid",
        fontSize: 12,
        gap: 8,
        gridTemplateColumns: "72px 1fr 1fr",
        padding: "4px 8px",
      }}
    >
      <div style={{ color: "var(--ink-soft)" }}>{label}</div>
      <div>{applicantValue || "（空欄）"}</div>
      <div>{memberValue || "（空欄）"}</div>
    </div>
  );
}

export interface MatchCandidateCardProps {
  application: ApplicationDetail;
  candidate: MatchCandidateView;
  isDeciding: boolean;
  onDecide: (
    candidateId: string,
    decision: Exclude<MatchStatus, "pending" | "stale">,
  ) => void;
}

/**
 * 🔵 Intent: F-6-7の候補カードUI。申請データと会員データを左右に並べて差分をハイライトし、
 * F-6-8の3操作（同一人物として紐付け・別人として登録・保留）を提供する。
 * `merged`済みの候補は確定済みの紐付けとして再判断ボタンを出さない。
 */
export function MatchCandidateCard({
  application,
  candidate,
  isDeciding,
  onDecide,
}: MatchCandidateCardProps) {
  // F-4-2・api.md: 承認済み(確定状態)の申請は名寄せ判断も変更不可（Application.memberId
  // を含め一切変更させない）。バックエンドのdecideMatchと同じ条件をUI側でも反映する。
  const canDecide =
    application.appStatus !== "approved" &&
    (candidate.status === "pending" || candidate.status === "hold");

  return (
    <div className="card" style={{ marginBottom: 10, padding: 12 }}>
      <div
        style={{
          alignItems: "baseline",
          display: "flex",
          fontSize: 12,
          gap: 10,
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <span>
          {candidate.member.memberNumber} {candidate.member.name}
        </span>
        <span style={{ color: "var(--ink-soft)" }}>
          スコア {candidate.ruleScore}・可能性{" "}
          {candidate.aiLikelihood
            ? LIKELIHOOD_LABELS[candidate.aiLikelihood]
            : "—"}
          ・
          {
            MATCH_STATUS_LABELS[
              candidate.status === "stale" ? "pending" : candidate.status
            ]
          }
        </span>
      </div>
      {candidate.aiReason !== null && (
        <p
          style={{ color: "var(--ink-soft)", fontSize: 12, margin: "0 0 8px" }}
        >
          {candidate.aiReason}
        </p>
      )}
      <div
        style={{
          border: "1px solid var(--rule)",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            fontSize: 11,
            gridTemplateColumns: "72px 1fr 1fr",
            padding: "4px 8px",
          }}
        >
          <div />
          <div style={{ color: "var(--ink-soft)" }}>申請データ</div>
          <div style={{ color: "var(--ink-soft)" }}>会員データ</div>
        </div>
        <DiffRow
          applicantValue={findFieldValue(application.fields, NAME_LABELS)}
          label="氏名"
          memberValue={candidate.member.name}
        />
        <DiffRow
          applicantValue={findFieldValue(application.fields, NAME_KANA_LABELS)}
          label="氏名カナ"
          memberValue={candidate.member.nameKana ?? ""}
        />
        <DiffRow
          applicantValue={findFieldValue(application.fields, BIRTH_DATE_LABELS)}
          label="生年月日"
          memberValue={candidate.member.birthDate ?? ""}
        />
        <DiffRow
          applicantValue={findFieldValue(application.fields, PHONE_LABELS)}
          label="電話番号"
          memberValue={candidate.member.phone ?? ""}
        />
      </div>
      {canDecide && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            className="btn btn-primary btn-small"
            disabled={isDeciding}
            onClick={() => onDecide(candidate.id, "merged")}
            type="button"
          >
            同一人物として紐付け
          </button>
          <button
            className="btn btn-ghost btn-small"
            disabled={isDeciding}
            onClick={() => onDecide(candidate.id, "rejected")}
            type="button"
          >
            別人として登録
          </button>
          <button
            className="btn btn-ghost btn-small"
            disabled={isDeciding}
            onClick={() => onDecide(candidate.id, "hold")}
            type="button"
          >
            保留
          </button>
        </div>
      )}
    </div>
  );
}
