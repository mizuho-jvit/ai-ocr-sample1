import type { Triage } from "../../worker/types/contracts";
import { TRIAGE_LABELS } from "../labels";

/** プロトタイプ`ai-ocr-demo.jsx`のTRIAGE_STYLEをCSSカスタムプロパティで踏襲する。 */
const TRIAGE_STAMP_COLOR: Record<Triage, string> = {
  approval_candidate: "var(--ok-green)",
  needs_review: "var(--amber-border)",
  return_candidate: "var(--vermilion)",
};

export interface TriageStampProps {
  triage: Triage | null;
  size?: number;
}

/**
 * 🔵 Intent: overview.md「デザイン要件」の「判定表示｜判子風の円形スタンプ」・
 * acceptance.md「判子風スタンプが維持されている」を満たす。プロトタイプ`ai-ocr-demo.jsx`の
 * `TriageStamp`をそのまま踏襲し、色はハードコードではなく`theme.css`のCSSカスタムプロパティを使う。
 */
export function TriageStamp({ triage, size = 72 }: TriageStampProps) {
  if (triage === null) {
    return (
      <span
        aria-label="AI業務チェック 未実施"
        className="serif"
        role="img"
        style={{
          alignItems: "center",
          border: "2px dashed var(--rule)",
          borderRadius: "50%",
          boxSizing: "border-box",
          color: "#b9b5a9",
          display: "flex",
          flexShrink: 0,
          fontSize: size / 5.2,
          height: size,
          justifyContent: "center",
          lineHeight: 1.25,
          padding: 6,
          textAlign: "center",
          whiteSpace: "pre-line",
          width: size,
        }}
      >
        {"未\n審査"}
      </span>
    );
  }

  const label = TRIAGE_LABELS[triage];
  const displayText =
    label.length > 3 ? `${label.slice(0, 3)}\n${label.slice(3)}` : label;

  return (
    <span
      aria-label={`AI判定: ${label}`}
      className="serif"
      role="img"
      style={{
        alignItems: "center",
        border: `2.5px solid ${TRIAGE_STAMP_COLOR[triage]}`,
        borderRadius: "50%",
        boxSizing: "border-box",
        color: TRIAGE_STAMP_COLOR[triage],
        display: "flex",
        flexShrink: 0,
        fontSize: size / 4.8,
        fontWeight: 600,
        height: size,
        justifyContent: "center",
        lineHeight: 1.25,
        padding: 6,
        textAlign: "center",
        transform: "rotate(-8deg)",
        whiteSpace: "pre-line",
        width: size,
      }}
    >
      {displayText}
    </span>
  );
}
