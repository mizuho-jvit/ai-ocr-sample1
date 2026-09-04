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
import { MatchCandidateCard } from "../components/match-candidate-card";
import { APP_STATUS_LABELS, TRIAGE_LABELS } from "../labels";

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
  applicationId: string;
  onBack: () => void;
}

/**
 * 🔵 Intent: `画面一覧`の「申請詳細」（F-4-5・F-4-1〜4・F-3-7・F-6-7〜9）を1画面へまとめる。
 * 項目編集・状態変更・名寄せ判断はそれぞれ専用APIへ委ね、成功のたびに`ApplicationDetail`を
 * 取り直して画面を最新化する（後着優先・排他制御なし=F-4-12）。
 */
export function ApplicationDetailPage({
  api,
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
              alignItems: "baseline",
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <h2
              className="serif"
              style={{ fontSize: 19, letterSpacing: "0.1em", margin: 0 }}
            >
              {application.docType}{" "}
              <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>
                — {APP_STATUS_LABELS[application.appStatus]}
              </span>
            </h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {NEXT_STATUSES[application.appStatus].map((toStatus) => (
                <button
                  className="btn btn-primary btn-small"
                  disabled={isChangingStatus}
                  key={toStatus}
                  onClick={() => void handleChangeStatus(toStatus)}
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
                <div className="field-group" key={field.label}>
                  <label
                    className="field-label"
                    htmlFor={`field-${field.label}`}
                  >
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
                    id={`field-${field.label}`}
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

            {application.latestCheckRun !== null && (
              <div className="card" style={{ padding: 12 }}>
                <h3 style={{ fontSize: 13, margin: "0 0 6px" }}>
                  業務チェック結果 —{" "}
                  {TRIAGE_LABELS[application.latestCheckRun.triage]}
                </h3>
                <p style={{ fontSize: 13, margin: "0 0 10px" }}>
                  {application.latestCheckRun.triageReason}
                </p>
                {application.latestCheckRun.consistency.length > 0 && (
                  <ul
                    style={{ fontSize: 12, margin: "0 0 8px", paddingLeft: 18 }}
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
                    style={{ fontSize: 12, margin: "0 0 8px", paddingLeft: 18 }}
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
                  <div
                    style={{
                      background: "var(--amber-bg)",
                      border: "1px solid var(--amber-border)",
                      borderRadius: 6,
                      fontSize: 12,
                      padding: 8,
                    }}
                  >
                    差戻し文面案: {application.latestCheckRun.letterDraft}
                  </div>
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
