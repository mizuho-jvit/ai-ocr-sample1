import { useEffect, useState } from "react";

import type { MatchCandidateView } from "../../worker/types/contracts";
import type { MembersApi } from "../api/members";
import { toErrorMessage } from "../api/members";
import { LIKELIHOOD_LABELS, MATCH_STATUS_LABELS } from "../labels";

export interface MemberDuplicatesPageProps {
  api: Pick<MembersApi, "listMatchCandidates">;
}

/**
 * 🔵 Intent: `画面一覧`の「重複疑いリスト」（F-5-9）。`GET /api/members/match-candidates`
 * （api.md #16・決定#3）は特定の申請に属さない会員側の横断ビューであり、判断操作
 * （F-6-8・merged/rejected/hold）は申請詳細画面の候補カードでのみ行う。この画面は一覧表示のみ。
 */
export function MemberDuplicatesPage({ api }: MemberDuplicatesPageProps) {
  const [candidates, setCandidates] = useState<MatchCandidateView[] | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const result = await api.listMatchCandidates();
        if (!cancelled) {
          setCandidates(result);
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
  }, [api]);

  return (
    <div className="goth member-duplicates-page">
      <h2
        className="serif"
        style={{ fontSize: 19, letterSpacing: "0.1em", margin: "0 0 14px" }}
      >
        重複疑いリスト
      </h2>

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

      {!isLoading && candidates !== null && (
        <div className="card" style={{ overflow: "hidden" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ fontSize: 12, textAlign: "left" }}>
                <th style={{ padding: "8px 12px" }}>会員番号</th>
                <th style={{ padding: "8px 12px" }}>氏名</th>
                <th style={{ padding: "8px 12px" }}>同一人物の可能性</th>
                <th style={{ padding: "8px 12px" }}>判断状況</th>
              </tr>
            </thead>
            <tbody>
              {candidates.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    style={{ color: "var(--ink-soft)", padding: "16px 12px" }}
                  >
                    未解決の名寄せ候補はありません。
                  </td>
                </tr>
              )}
              {candidates.map((candidate, index) => (
                <tr
                  key={candidate.id}
                  style={{
                    borderTop: index === 0 ? "none" : "1px solid var(--rule)",
                    fontSize: 13,
                  }}
                >
                  <td style={{ padding: "8px 12px" }}>
                    {candidate.member.memberNumber}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    {candidate.member.name}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    {candidate.aiLikelihood
                      ? LIKELIHOOD_LABELS[candidate.aiLikelihood]
                      : "—"}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    {candidate.status === "pending" ||
                    candidate.status === "hold"
                      ? MATCH_STATUS_LABELS[candidate.status]
                      : candidate.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
