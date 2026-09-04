import { useEffect, useState } from "react";

import type {
  ApplicationListQuery,
  ApplicationListResponse,
  AppStatus,
} from "../../worker/types/contracts";
import type { ApplicationsApi } from "../api/applications";
import { toErrorMessage } from "../api/applications";
import { AppStatusBadge } from "../components/app-status-badge";
import { TriageStamp } from "../components/triage-stamp";
import { APP_STATUS_LABELS } from "../labels";

type LinkedFilter = "all" | "linked" | "unlinked";

export interface ApplicationListPageProps {
  api: Pick<ApplicationsApi, "list">;
  onSelectApplication: (applicationId: string) => void;
}

/** データベースへ保存されたISO日時を、余計な依存を増やさず簡潔に表示する。 */
function formatDateTime(value: string): string {
  return value.replace("T", " ").slice(0, 16);
}

/**
 * 🔵 Intent: `画面一覧`の「申請状況一覧」（F-4-10・F-4-11）。フィルタ・「要審査のみ」ビューは
 * `GET /api/applications`（api.md #7）へそのまま渡し、絞り込み自体はサーバー側で行う。
 */
export function ApplicationListPage({
  api,
  onSelectApplication,
}: ApplicationListPageProps) {
  const [appStatus, setAppStatus] = useState<AppStatus | "">("");
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [linkedFilter, setLinkedFilter] = useState<LinkedFilter>("all");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ApplicationListResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setErrorMessage(null);
      const query: ApplicationListQuery = { page };
      if (appStatus) {
        query.appStatus = appStatus;
      }
      if (needsReviewOnly) {
        query.needsReviewOnly = true;
      }
      if (linkedFilter !== "all") {
        query.linked = linkedFilter === "linked";
      }
      try {
        const response = await api.list(query);
        if (!cancelled) {
          setResult(response);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(toErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [api, appStatus, needsReviewOnly, linkedFilter, page]);

  const totalPages = result
    ? Math.max(1, Math.ceil(result.total / result.perPage))
    : 1;

  return (
    <div className="goth application-list-page">
      <h2
        className="serif"
        style={{ fontSize: 19, letterSpacing: "0.1em", margin: "0 0 14px" }}
      >
        申請状況一覧
      </h2>

      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <label style={{ fontSize: 13 }}>
          処理状態{" "}
          <select
            aria-label="処理状態で絞り込み"
            onChange={(event) => {
              setAppStatus(event.target.value as AppStatus | "");
              setPage(1);
            }}
            value={appStatus}
          >
            <option value="">すべて</option>
            {(Object.keys(APP_STATUS_LABELS) as AppStatus[]).map((status) => (
              <option key={status} value={status}>
                {APP_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: 13 }}>
          会員紐付け{" "}
          <select
            aria-label="会員紐付けで絞り込み"
            onChange={(event) => {
              setLinkedFilter(event.target.value as LinkedFilter);
              setPage(1);
            }}
            value={linkedFilter}
          >
            <option value="all">すべて</option>
            <option value="linked">紐付け済み</option>
            <option value="unlinked">未紐付け</option>
          </select>
        </label>

        <label
          style={{
            alignItems: "center",
            display: "flex",
            fontSize: 13,
            gap: 4,
          }}
        >
          <input
            checked={needsReviewOnly}
            onChange={(event) => {
              setNeedsReviewOnly(event.target.checked);
              setPage(1);
            }}
            type="checkbox"
          />
          要審査のみ
        </label>
      </div>

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

      {!isLoading && result !== null && (
        <>
          <div className="card" style={{ overflow: "hidden" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ fontSize: 12, textAlign: "left" }}>
                  <th style={{ padding: "8px 12px" }}>帳票種別</th>
                  <th style={{ padding: "8px 12px" }}>処理状態</th>
                  <th style={{ padding: "8px 12px" }}>AI判定</th>
                  <th style={{ padding: "8px 12px" }}>処理者</th>
                  <th style={{ padding: "8px 12px" }}>会員紐付け</th>
                  <th style={{ padding: "8px 12px" }}>登録日時</th>
                  <th style={{ padding: "8px 12px" }} />
                </tr>
              </thead>
              <tbody>
                {result.items.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      style={{ color: "var(--ink-soft)", padding: "16px 12px" }}
                    >
                      該当する申請はありません。
                    </td>
                  </tr>
                )}
                {result.items.map((item, index) => (
                  <tr
                    key={item.id}
                    style={{
                      borderTop: index === 0 ? "none" : "1px solid var(--rule)",
                      fontSize: 13,
                    }}
                  >
                    <td style={{ padding: "8px 12px" }}>{item.docType}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <AppStatusBadge status={item.appStatus} />
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <TriageStamp size={32} triage={item.triage} />
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {item.createdBy.name}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {item.member ? item.member.name : "未紐付け"}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {formatDateTime(item.createdAt)}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <button
                        className="btn btn-ghost btn-small"
                        onClick={() => onSelectApplication(item.id)}
                        type="button"
                      >
                        詳細
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            style={{
              alignItems: "center",
              display: "flex",
              gap: 10,
              marginTop: 14,
            }}
          >
            <button
              className="btn btn-ghost btn-small"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              type="button"
            >
              前へ
            </button>
            <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>
              {page} / {totalPages}（全{result.total}件）
            </span>
            <button
              className="btn btn-ghost btn-small"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
              type="button"
            >
              次へ
            </button>
          </div>
        </>
      )}
    </div>
  );
}
