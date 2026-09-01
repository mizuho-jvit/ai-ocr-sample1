import { type ChangeEvent, type DragEvent, useState } from "react";

import type {
  ApplicationDetail,
  ApplicationField,
  UsageResponse,
} from "../../worker/types/contracts";
import { type OcrApi, resizeImageToJpeg, toErrorMessage } from "../api/ocr";

/** NF-4-3: 確信度閾値は定数として一元管理する（環境変数では変更しない）。 */
const CONFIDENCE_HIGHLIGHT_THRESHOLD = 0.85;

/** Task 004の慣習（E2Eテストからの参照を安定させる固定id）に合わせる。 */
const FILE_INPUT_ID = "ocr-file-input";

/** F-2-3: 1申請=1画像。複数枚・両面は対象外。 */
const MULTIPLE_FILES_MESSAGE = "1回につき1枚の画像のみ選択できます。";

type Stage = "idle" | "resizing" | "uploading" | "success" | "error";

const STAGE_MESSAGE: Partial<Record<Stage, string>> = {
  resizing: "画像を処理しています…",
  uploading: "AIが読み取っています…",
};

/**
 * 🟡 Intent: 読取確認画面だけのUI状態（確認済みかどうか）。サーバー契約
 * （`ApplicationField`）には無く、PATCH APIも未実装（Task 010）のため保存はしない。
 * 画面を離れると失われる、閲覧中だけのハイライト解除に留まる。
 */
interface EditableField extends ApplicationField {
  confirmed: boolean;
}

export interface OcrPageProps {
  api: Pick<OcrApi, "extract">;
  resizeImage?: (
    file: File,
  ) => Promise<Parameters<OcrApi["extract"]>[0]["image"]>;
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}分${remaining}秒` : `${remaining}秒`;
}

interface OcrFieldRowProps {
  field: EditableField;
  index: number;
  isFirst: boolean;
  onChange: (index: number, value: string) => void;
  onConfirm: (index: number) => void;
}

/** 🔵 Intent: `ai-ocr-demo.jsx`の読取確認行（ラベル＋テキスト入力＋確度＋OK）を踏襲する。 */
function OcrFieldRow({
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

/**
 * 🔴 Intent: 画面一覧の「ホーム（アップロード＋台帳）」のうちアップロード部分と
 * 「読取確認」の結果表示を1画面にまとめた。台帳（申請状況一覧）は後続タスク
 * （申請管理画面）の範囲。「業務チェックへ進む」ボタンはデザイン一致のため設置するが
 * 機能はTask 009の範囲でまだ無く、押しても何も行わない（ユーザー指示）。
 */
export function OcrPage({
  api,
  resizeImage = resizeImageToJpeg,
}: OcrPageProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [application, setApplication] = useState<ApplicationDetail | null>(
    null,
  );
  const [fields, setFields] = useState<EditableField[]>([]);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  const isProcessing = stage === "resizing" || stage === "uploading";
  const lowConfidenceCount = fields.filter(
    (field) =>
      field.confidence < CONFIDENCE_HIGHLIGHT_THRESHOLD && !field.confirmed,
  ).length;

  async function handleFile(file: File) {
    if (isProcessing) {
      return;
    }

    setErrorMessage(null);
    setApplication(null);
    setFields([]);
    setImagePreviewUrl(null);
    setStage("resizing");
    try {
      const image = await resizeImage(file);
      setImagePreviewUrl(`data:${image.mimeType};base64,${image.base64}`);
      setStage("uploading");
      const response = await api.extract({ image });
      setApplication(response.application);
      setFields(
        response.application.fields.map((field) => ({
          ...field,
          confirmed: false,
        })),
      );
      setUsage(response.usage);
      setStage("success");
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
      setStage("error");
    }
  }

  /** 🔵 Intent: `ai-ocr-demo.jsx`のupdateFieldと同じく、修正した項目は同時に確認済み扱いにする。 */
  function updateField(index: number, value: string) {
    setFields((current) =>
      current.map((field, i) =>
        i === index
          ? { ...field, confirmed: true, edited: true, value }
          : field,
      ),
    );
  }

  function confirmField(index: number) {
    setFields((current) =>
      current.map((field, i) =>
        i === index ? { ...field, confirmed: true } : field,
      ),
    );
  }

  /**
   * 🔴 Intent: 業務チェック(F-3)はTask 009の範囲でまだ実装がない。
   * `ai-ocr-demo.jsx`とのデザイン一致のためボタンは設置するが、押しても何も行わない
   * （ユーザー指示）。
   */
  function handleProceedToCheck() {}

  /**
   * 🔵 Intent: `ai-ocr-demo.jsx`のresetScanと同じく、申請は既に「受付」で保存済みのため
   * （F-2-8）中断してもデータは失われない。画面をホーム（アップロード待ち）へ戻すだけ。
   */
  function handleAbort() {
    setStage("idle");
    setErrorMessage(null);
    setApplication(null);
    setFields([]);
    setUsage(null);
    setImagePreviewUrl(null);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 同じファイルを続けて選び直せるよう、選択後に値をクリアする。
    event.target.value = "";
    if (file) {
      void handleFile(file);
    }
  }

  /** F-2-3: 1申請=1画像。複数枚がドロップされたら送信せず理由を表示する。 */
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (isProcessing) {
      return;
    }
    const files = event.dataTransfer.files;
    if (files.length === 0) {
      return;
    }
    if (files.length > 1) {
      setApplication(null);
      setErrorMessage(MULTIPLE_FILES_MESSAGE);
      setStage("error");
      return;
    }
    const file = files[0];
    if (file) {
      void handleFile(file);
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  return (
    <div className="goth ocr-page">
      {/*
       * 🔵 Intent: `ai-ocr-demo.jsx`と同じくアップロード画面と読取結果画面は排他表示。
       * successの間はドロップゾーンを隠す（読取結果の下にもう一つ読取エリアが
       * 出てしまう不具合を修正）。errorのときはこの場で再試行できるよう表示を続ける。
       */}
      {(stage === "idle" || stage === "error") && (
        // biome-ignore lint/a11y/noStaticElementInteractions: D&Dは補助的な導線。主経路は下のlabel/inputによるファイル選択で、キーボード操作でも完結する。
        <div
          className="ocr-dropzone"
          data-disabled={isProcessing}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div
            className="serif"
            style={{ fontSize: 19, letterSpacing: "0.08em", marginBottom: 6 }}
          >
            帳票の画像を選択
          </div>
          <div
            style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.8 }}
          >
            ドラッグ＆ドロップでも選択できます。
            <br />
            読取が完了すると申請データは自動保存されます。
          </div>
          <input
            accept="image/jpeg,image/png"
            capture="environment"
            disabled={isProcessing}
            id={FILE_INPUT_ID}
            onChange={handleInputChange}
            style={{ display: "none" }}
            type="file"
          />
          <label
            className="btn btn-primary"
            htmlFor={FILE_INPUT_ID}
            style={{
              display: "inline-block",
              marginTop: 18,
              padding: "10px 28px",
              ...(isProcessing ? { cursor: "not-allowed", opacity: 0.5 } : {}),
            }}
          >
            画像を選ぶ・撮影する
          </label>
        </div>
      )}

      {stage !== "idle" && stage !== "error" && STAGE_MESSAGE[stage] && (
        <p className="status-message" role="status">
          {STAGE_MESSAGE[stage]}
        </p>
      )}

      {stage === "error" && errorMessage !== null && (
        <p className="alert" role="alert" style={{ marginTop: 16 }}>
          {errorMessage}
        </p>
      )}

      {stage === "success" && application !== null && (
        <section style={{ marginTop: 16 }}>
          <div
            style={{
              alignItems: "baseline",
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <h2
              className="serif"
              style={{ fontSize: 19, letterSpacing: "0.1em", margin: 0 }}
            >
              読取結果の確認{" "}
              <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                — {application.docType}（自動判別）
              </span>
            </h2>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
              読取時間 {formatSeconds(application.processingSec)}
            </span>
          </div>

          <p
            style={{
              color: "var(--ok-green)",
              fontSize: 12,
              margin: "0 0 12px",
            }}
          >
            ✓ 申請データは「受付」として保存済みです。
          </p>

          <div
            style={{
              background:
                lowConfidenceCount > 0
                  ? "var(--amber-bg)"
                  : "var(--ok-green-bg)",
              border: `1px solid ${lowConfidenceCount > 0 ? "var(--amber-border)" : "var(--ok-green)"}`,
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.7,
              marginBottom: 16,
              padding: "10px 14px",
            }}
          >
            {lowConfidenceCount > 0 ? (
              <>
                黄色の {lowConfidenceCount}{" "}
                項目だけご確認ください。正しければ「OK」を押し、読み間違いがあれば
                <strong>入力欄をタップしてその場で修正</strong>できます。
              </>
            ) : (
              <>
                すべての項目を高い確度で読み取りました。読み間違いがあれば入力欄を修正してください。
              </>
            )}
          </div>

          {usage !== null && (
            <p
              className="field-label"
              id="ocr-usage-remaining"
              style={{ margin: "0 0 16px" }}
            >
              今月の残り読取可能枚数: {usage.ocrPagesRemaining} /{" "}
              {usage.ocrPagesLimit}
            </p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {imagePreviewUrl !== null && (
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
                  alt="アップロードされた帳票の原本"
                  src={imagePreviewUrl}
                  style={{ borderRadius: 4, maxHeight: 420, maxWidth: "100%" }}
                />
              </div>
            )}

            <div className="card" style={{ overflow: "hidden" }}>
              {fields.map((field, index) => (
                <OcrFieldRow
                  field={field}
                  index={index}
                  isFirst={index === 0}
                  key={field.label}
                  onChange={updateField}
                  onConfirm={confirmField}
                />
              ))}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              marginTop: 18,
            }}
          >
            <button
              className="btn btn-primary"
              onClick={handleProceedToCheck}
              style={{ flex: "1 1 200px", fontSize: 15 }}
              type="button"
            >
              業務チェックへ進む(整合性・不備・重複・判定)
            </button>
            <button
              className="btn btn-ghost"
              onClick={handleAbort}
              type="button"
            >
              中断する(受付のまま保存)
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
