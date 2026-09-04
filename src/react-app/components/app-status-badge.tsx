import type { AppStatus } from "../../worker/types/contracts";
import { APP_STATUS_LABELS } from "../labels";

/** プロトタイプ`ai-ocr-demo.jsx`のAPP_STATUS_COLORをCSSカスタムプロパティで踏襲する。 */
const APP_STATUS_BADGE_COLOR: Record<AppStatus, string> = {
  approved: "var(--ok-green)",
  received: "var(--ink-soft)",
  returned: "var(--vermilion)",
  under_review: "var(--amber-border)",
};

export interface AppStatusBadgeProps {
  status: AppStatus;
}

/** 🔵 Intent: プロトタイプ`ai-ocr-demo.jsx`の`AppStatusBadge`を踏襲した申請ステータスバッジ。 */
export function AppStatusBadge({ status }: AppStatusBadgeProps) {
  return (
    <span
      style={{
        background: APP_STATUS_BADGE_COLOR[status],
        borderRadius: 4,
        color: "#fff",
        fontSize: 11,
        letterSpacing: "0.05em",
        padding: "3px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {APP_STATUS_LABELS[status]}
    </span>
  );
}
