import { useCallback, useEffect, useState } from "react";

import type {
  ApplicationDetail,
  ApplicationField,
  AppStatus,
  CheckRunView,
  MatchStatus,
} from "../../worker/types/contracts";
import type { ApplicationsApi } from "../api/applications";
import { toErrorMessage } from "../api/applications";
import {
  type ChecksApi,
  ChecksApiError,
  checksApi as defaultChecksApi,
} from "../api/checks";
import {
  APP_STATUS_BADGE_COLOR,
  AppStatusBadge,
} from "../components/app-status-badge";
import { LetterDraftEditor } from "../components/letter-draft-editor";
import { MatchCandidateCard } from "../components/match-candidate-card";
import { TriageStamp } from "../components/triage-stamp";
import { TRIAGE_LABELS } from "../labels";

/** 🔵 Intent: api.md #11の遷移表をそのまま画面のボタン候補にする。API側でも必ず再検証される。 */
const NEXT_STATUSES: Record<AppStatus, readonly AppStatus[]> = {
  approved: [],
  received: ["under_review"],
  returned: ["under_review"],
  under_review: ["approved", "returned"],
};

const NEXT_STATUS_LABELS: Record<AppStatus, string> = {
  approved: "承認する",
  received: "受付にする",
  returned: "差戻しにする",
  under_review: "審査中にする",
};

export interface ApplicationDetailPageProps {
  api: Pick<
    ApplicationsApi,
    | "get"
    | "updateFields"
    | "changeStatus"
    | "decideMatch"
    | "listCheckRuns"
    | "imageUrl"
  >;
  checksApi?: Pick<ChecksApi, "run">;
  applicationId: string;
  onBack: () => void;
}

/** 🔵 Intent: `ChecksApiError`固有のメッセージを優先し、それ以外は`api/applications.ts`の
 * `toErrorMessage`（`ApplicationsApiError`判定・共通FALLBACK_MESSAGE）へ委ねる。 */
function toRunCheckErrorMessage(error: unknown): string {
  return error instanceof ChecksApiError
    ? error.message
    : toErrorMessage(error);
}

/**
 * 🔵 Intent: `画面一覧`の「申請詳細」（F-4-5・F-4-1〜4・F-3-7・F-6-7〜9）を1画面へまとめる。
 * 項目編集・状態変更・名寄せ判断はそれぞれ専用APIへ委ね、成功のたびに`ApplicationDetail`を
 * 取り直して画面を最新化する（後着優先・排他制御なし=F-4-12）。
 */
export function ApplicationDetailPage({
  api,
  checksApi = defaultChecksApi,
  applicationId,
  onBack,
}: ApplicationDetailPageProps) {
  const [application, setApplication] = useState<ApplicationDetail | null>(
    null,
  );
  const [fields, setFields] = useState<ApplicationField[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [checkRunHistory, setCheckRunHistory] = useState<CheckRunView[] | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingFields, setIsSavingFields] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isRunningCheck, setIsRunningCheck] = useState(false);
  const [checkRunNotice, setCheckRunNotice] = useState<string | null>(null);
  const [decidingCandidateId, setDecidingCandidateId] = useState<string | null>(
    null,
  );
  const [promotedMemberNotice, setPromotedMemberNotice] = useState<
    string | null
  >(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const detail = await api.get(applicationId);
      setApplication(detail);
      setFields(detail.fields);
      setImageUrl(
        detail.hasImage ? (await api.imageUrl(applicationId)).url : null,
      );
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [api, applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateFieldValue(index: number, value: string) {
    setFields((current) =>
      current.map((field, i) => (i === index ? { ...field, value } : field)),
    );
  }

  async function handleSaveFields() {
    setIsSavingFields(true);
    setErrorMessage(null);
    try {
      const detail = await api.updateFields(applicationId, {
        fields: fields.map((field) => ({
          label: field.label,
          value: field.value,
        })),
      });
      setApplication(detail);
      setFields(detail.fields);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsSavingFields(false);
    }
  }

  async function handleChangeStatus(toStatus: AppStatus) {
    setIsChangingStatus(true);
    setErrorMessage(null);
    setPromotedMemberNotice(null);
    try {
      const result = await api.changeStatus(applicationId, { toStatus });
      setApplication(result.application);
      setFields(result.application.fields);
      if (result.promotedMember) {
        setPromotedMemberNotice(
          `会員「${result.promotedMember.name}」を「利用資格あり」へ更新しました。`,
        );
      }
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsChangingStatus(false);
    }
  }

  /** 🔵 Intent: F-4-6。承認済みは呼び出し側(ボタンのdisabled)で防ぐが、API側(business-check.ts)でも再検証される。 */
  async function handleRunCheck() {
    if (application === null || isRunningCheck) {
      return;
    }
    setIsRunningCheck(true);
    setErrorMessage(null);
    try {
      const result = await checksApi.run({ applicationId });
      setApplication(result.application);
      setFields(result.application.fields);
      setCheckRunHistory(null);
      setCheckRunNotice(
        `業務チェックを実施しました(残り再実施回数: ${result.remainingRuns}回)。`,
      );
    } catch (error) {
      setErrorMessage(toRunCheckErrorMessage(error));
    } finally {
      setIsRunningCheck(false);
    }
  }

  async function handleDecideMatch(
    candidateId: string,
    decision: Exclude<MatchStatus, "pending" | "stale">,
  ) {
    setDecidingCandidateId(candidateId);
    setErrorMessage(null);
    try {
      const result = await api.decideMatch(applicationId, candidateId, {
        decision,
      });
      setApplication(result.application);
      setFields(result.application.fields);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setDecidingCandidateId(null);
    }
  }

  async function handleToggleHistory() {
    if (checkRunHistory !== null) {
      setCheckRunHistory(null);
      return;
    }
    try {
      setCheckRunHistory(await api.listCheckRuns(applicationId));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }

  return (
    <div className="goth application-detail-page">
      <button
        className="btn btn-ghost btn-small"
        onClick={onBack}
        style={{ marginBottom: 14 }}
        type="button"
      >
        ← 一覧へ戻る
      </button>

      {errorMessage !== null && (
        <p className="alert" role="alert" style={{ marginBottom: 14 }}>
          {errorMessage}
        </p>
      )}

      {isLoading && (
        <p className="status-message" role="status">
          読み込んでいます…
        </p>
      )}

      {!isLoading && application !== null && (
        <>
          <div
            style={{
              alignItems: "center",
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <div style={{ alignItems: "center", display: "flex", gap: 12 }}>
              <TriageStamp size={56} triage={application.triage} />
              <h2
                className="serif"
                style={{ fontSize: 19, letterSpacing: "0.1em", margin: 0 }}
              >
                {application.docType}{" "}
                <AppStatusBadge status={application.appStatus} />
              </h2>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {NEXT_STATUSES[application.appStatus].map((toStatus) => (
                // 🔵 Intent: プロトタイプ`ai-ocr-demo.jsx`と同じく、遷移先ステータスごとの色で
                // ボタンを塗り分ける（統一の黒ではなく、承認=緑・差戻し=朱色等）。
                <button
                  className="btn btn-small"
                  disabled={isChangingStatus}
                  key={toStatus}
                  onClick={() => void handleChangeStatus(toStatus)}
                  style={{
                    background: "#fff",
                    border: `1px solid ${APP_STATUS_BADGE_COLOR[toStatus]}`,
                    color: APP_STATUS_BADGE_COLOR[toStatus],
                  }}
                  type="button"
                >
                  {NEXT_STATUS_LABELS[toStatus]}
                </button>
              ))}
            </div>
          </div>

          {promotedMemberNotice !== null && (
            <p
              style={{
                color: "var(--ok-green)",
                fontSize: 12,
                margin: "0 0 14px",
              }}
            >
              ✓ {promotedMemberNotice}
            </p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {imageUrl !== null && (
              <div
                className="card"
                style={{ padding: 10, textAlign: "center" }}
              >
                <div
                  style={{
                    color: "var(--ink-soft)",
                    fontSize: 11,
                    letterSpacing: "0.15em",
                    marginBottom: 6,
                  }}
                >
                  原本
                </div>
                <img
                  alt="申請書の原本"
                  src={imageUrl}
                  style={{ borderRadius: 4, maxHeight: 420, maxWidth: "100%" }}
                />
              </div>
            )}

            <div className="card" style={{ padding: 12 }}>
              <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>抽出項目</h3>
              {fields.map((field, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 同じラベルの項目が複数あり得るため(コードレビュー指摘#5)、並び順が変わらないindexをキー・id両方に使う。
                <div className="field-group" key={index}>
                  <label className="field-label" htmlFor={`field-${index}`}>
                    {field.label}
                    {field.edited && (
                      <span style={{ color: "var(--vermilion)" }}>
                        {" "}
                        ・修正済
                      </span>
                    )}
                  </label>
                  <input
                    className="field-input"
                    id={`field-${index}`}
                    onChange={(event) =>
                      updateFieldValue(index, event.target.value)
                    }
                    value={field.value}
                  />
                </div>
              ))}
              <button
                className="btn btn-primary btn-small"
                disabled={isSavingFields}
                onClick={() => void handleSaveFields()}
                type="button"
              >
                項目を保存
              </button>
            </div>

            <div className="card" style={{ padding: 12 }}>
              <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>業務チェック</h3>
              <button
                className="btn btn-primary btn-small"
                disabled={
                  isRunningCheck || application.appStatus === "approved"
                }
                onClick={() => void handleRunCheck()}
                type="button"
              >
                {application.latestCheckRun !== null
                  ? "業務チェックを再実施"
                  : "業務チェックを実施"}
              </button>
              {application.appStatus === "approved" && (
                <p
                  style={{
                    color: "var(--ink-soft)",
                    fontSize: 12,
                    margin: "8px 0 0",
                  }}
                >
                  承認済みの申請では実施できません。
                </p>
              )}
              {checkRunNotice !== null && (
                <p
                  style={{
                    color: "var(--ok-green)",
                    fontSize: 12,
                    margin: "8px 0 0",
                  }}
                >
                  ✓ {checkRunNotice}
                </p>
              )}
            </div>

            {application.latestCheckRun !== null && (
              <div
                className="card"
                style={{ display: "flex", gap: 12, padding: 12 }}
              >
                <TriageStamp
                  size={52}
                  triage={application.latestCheckRun.triage}
                />
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ fontSize: 13, margin: "0 0 6px" }}>
                    業務チェック結果 —{" "}
                    {TRIAGE_LABELS[application.latestCheckRun.triage]}
                  </h3>
                  <p style={{ fontSize: 13, margin: "0 0 10px" }}>
                    {application.latestCheckRun.triageReason}
                  </p>
                  {application.latestCheckRun.consistency.length > 0 && (
                    <ul
                      style={{
                        fontSize: 12,
                        margin: "0 0 8px",
                        paddingLeft: 18,
                      }}
                    >
                      {application.latestCheckRun.consistency.map(
                        (issue, index) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: サーバーから安定したidを持たない一覧のため。
                          <li key={index}>
                            [{issue.labels.join("・")}] {issue.message}
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                  {application.latestCheckRun.deficiencies.length > 0 && (
                    <ul
                      style={{
                        fontSize: 12,
                        margin: "0 0 8px",
                        paddingLeft: 18,
                      }}
                    >
                      {application.latestCheckRun.deficiencies.map(
                        (deficiency, index) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: サーバーから安定したidを持たない一覧のため。
                          <li key={index}>
                            [{deficiency.label}] {deficiency.message}
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                  {application.latestCheckRun.letterDraft !== null && (
                    // 再実施でCheckRunが変わったら編集途中の内容を捨てて新しい下書きへ置き換える（決定#34）。
                    <LetterDraftEditor
                      draft={application.latestCheckRun.letterDraft}
                      key={application.latestCheckRun.id}
                    />
                  )}
                  <button
                    className="btn btn-ghost btn-small"
                    onClick={() => void handleToggleHistory()}
                    style={{ marginTop: 10 }}
                    type="button"
                  >
                    {checkRunHistory !== null
                      ? "履歴を閉じる"
                      : "業務チェック履歴を表示"}
                  </button>
                  {checkRunHistory !== null && (
                    <ul style={{ fontSize: 12, marginTop: 8, paddingLeft: 18 }}>
                      {checkRunHistory.map((run) => (
                        <li key={run.id}>
                          {run.createdAt} — {TRIAGE_LABELS[run.triage]}（
                          {run.createdBy.name}）
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {application.matchCandidates.length > 0 && (
              <div>
                <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>名寄せ候補</h3>
                {application.matchCandidates.map((candidate) => (
                  <MatchCandidateCard
                    application={application}
                    candidate={candidate}
                    isDeciding={decidingCandidateId === candidate.id}
                    key={candidate.id}
                    onDecide={(candidateId, decision) =>
                      void handleDecideMatch(candidateId, decision)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
