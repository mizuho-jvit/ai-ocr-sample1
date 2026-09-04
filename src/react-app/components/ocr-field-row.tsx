import type { ApplicationField } from "../../worker/types/contracts";

/** NF-4-3: 確信度閾値は定数として一元管理する（環境変数では変更しない）。 */
export const CONFIDENCE_HIGHLIGHT_THRESHOLD = 0.85;

/**
 * 🟡 Intent: 読取確認画面だけのUI状態（確認済みかどうか）。サーバー契約
 * （`ApplicationField`）には無く、PATCH APIも未実装（Task 010）のため保存はしない。
 * 画面を離れると失われる、閲覧中だけのハイライト解除に留まる。
 */
export interface EditableField extends ApplicationField {
  confirmed: boolean;
}

export interface OcrFieldRowProps {
  field: EditableField;
  index: number;
  isFirst: boolean;
  onChange: (index: number, value: string) => void;
  onConfirm: (index: number) => void;
}

/**
 * 🔵 Intent: `ai-ocr-demo.jsx`の読取確認行（ラベル＋テキスト入力＋確度＋OK）を踏襲する。
 * 500行ルールにより`ocr-page.tsx`から分離した（`match-candidate-card.tsx`と同じ方針）。
 */
export function OcrFieldRow({
  field,
  index,
  isFirst,
  onChange,
  onConfirm,
}: OcrFieldRowProps) {
  const needsCheck =
    field.confidence < CONFIDENCE_HIGHLIGHT_THRESHOLD && !field.confirmed;

  return (
    <div
      data-needs-check={needsCheck}
      style={{
        alignItems: "flex-start",
        background: needsCheck ? "var(--amber-bg)" : "transparent",
        borderLeft: needsCheck
          ? "4px solid var(--amber-border)"
          : "4px solid transparent",
        borderTop: isFirst ? "none" : "1px solid var(--rule)",
        display: "flex",
        gap: 12,
        padding: "10px 14px",
      }}
    >
      <div
        style={{
          color: "var(--ink-soft)",
          flexShrink: 0,
          fontSize: 12,
          lineHeight: 1.5,
          paddingTop: 10,
          width: 96,
        }}
      >
        {field.label}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <input
          aria-label={field.label}
          className="field-input"
          onChange={(event) => onChange(index, event.target.value)}
          placeholder="（空欄）"
          value={field.value}
        />
        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: 8,
            marginTop: 3,
          }}
        >
          <span
            style={{
              color: needsCheck ? "var(--amber-border)" : "var(--ink-soft)",
              fontSize: 11,
            }}
          >
            確度 {Math.round(field.confidence * 100)}%
            {field.edited && (
              <span style={{ color: "var(--vermilion)" }}> ・修正済</span>
            )}
            {!field.edited && field.confirmed && (
              <span style={{ color: "var(--ok-green)" }}> ・確認済</span>
            )}
          </span>
        </div>
      </div>
      {needsCheck && (
        <button
          className="btn"
          onClick={() => onConfirm(index)}
          style={{
            background: "#fff",
            border: "1px solid var(--amber-border)",
            borderRadius: 6,
            color: "var(--amber-border)",
            flexShrink: 0,
            fontSize: 12,
            marginTop: 6,
            padding: "5px 12px",
          }}
          type="button"
        >
          OK
        </button>
      )}
    </div>
  );
}
