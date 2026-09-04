import { useId, useState } from "react";

/**
 * 🔵 Intent: 既定のクリップボード書き込み。`navigator.clipboard`が無い環境（非HTTPS等）では
 * `execCommand`等へフォールバックせず明示的に失敗させ、画面側で手動コピーを促す（決定#34）。
 */
function writeToNavigatorClipboard(text: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return Promise.reject(new Error("Clipboard API is unavailable"));
  }
  return navigator.clipboard.writeText(text);
}

export interface LetterDraftEditorProps {
  /** `CheckRun.letterDraft`（非null）。再実施で変わったら親が`key`で再マウントする。 */
  draft: string;
  writeClipboard?: (text: string) => Promise<void>;
}

/**
 * 🔵 Intent: F-3-5「差戻し文面は職員が編集・コピー可能であること」を満たす。
 * 編集はこのコンポーネント内の状態に限り、どこにも保存しない（`CheckRun`は追記専用・決定#34）。
 * 職員は「コピー」でクリップボードへ写し、メールソフト等へ貼り付けて送付する（自動送信はスコープ外）。
 */
export function LetterDraftEditor({
  draft,
  writeClipboard = writeToNavigatorClipboard,
}: LetterDraftEditorProps) {
  const textareaId = useId();
  const [text, setText] = useState(draft);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const handleCopy = async () => {
    try {
      await writeClipboard(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div
      style={{
        background: "var(--amber-bg)",
        border: "1px solid var(--amber-border)",
        borderRadius: 6,
        fontSize: 12,
        padding: 8,
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <label htmlFor={textareaId} style={{ fontWeight: 600 }}>
          差戻し文面案
        </label>
        <button
          className="btn btn-ghost btn-small"
          onClick={() => void handleCopy()}
          type="button"
        >
          コピー
        </button>
      </div>
      <textarea
        id={textareaId}
        onChange={(event) => {
          setText(event.target.value);
          setCopyState("idle");
        }}
        rows={6}
        style={{
          boxSizing: "border-box",
          fontFamily: "inherit",
          fontSize: 12,
          width: "100%",
        }}
        value={text}
      />
      <p style={{ color: "var(--ink-soft)", margin: "6px 0 0" }}>
        編集内容は保存されません。コピーしてメール等へ貼り付けてください。
      </p>
      {copyState === "copied" && (
        <p
          className="status-message"
          role="status"
          style={{ margin: "6px 0 0" }}
        >
          コピーしました。
        </p>
      )}
      {copyState === "failed" && (
        <p className="alert" role="alert" style={{ margin: "6px 0 0" }}>
          コピーできませんでした。文面を選択して手動でコピーしてください。
        </p>
      )}
    </div>
  );
}
