import { type ChangeEvent, type DragEvent, useState } from "react";

import type {
  ApplicationDetail,
  UsageResponse,
} from "../../worker/types/contracts";
import {
  type ApplicationsApi,
  ApplicationsApiError,
  applicationsApi as defaultApplicationsApi,
} from "../api/applications";
import {
  type ChecksApi,
  ChecksApiError,
  checksApi as defaultChecksApi,
} from "../api/checks";
import {
  type OcrApi,
  OcrApiError,
  resizeImageToJpeg,
  toErrorMessage,
} from "../api/ocr";
import {
  CONFIDENCE_HIGHLIGHT_THRESHOLD,
  type EditableField,
  OcrFieldRow,
} from "../components/ocr-field-row";

/** Task 004の慣習（E2Eテストからの参照を安定させる固定id）に合わせる。 */
const FILE_INPUT_ID = "ocr-file-input";

/** F-2-3: 1申請=1画像。複数枚・両面は対象外。 */
const MULTIPLE_FILES_MESSAGE = "1回につき1枚の画像のみ選択できます。";

type Stage = "idle" | "resizing" | "uploading" | "success" | "error";

const STAGE_MESSAGE: Partial<Record<Stage, string>> = {
  resizing: "画像を処理しています…",
  uploading: "AIが読み取っています…",
};

export interface OcrPageProps {
  api: Pick<OcrApi, "extract">;
  applicationsApi?: Pick<ApplicationsApi, "updateFields">;
  checksApi?: Pick<ChecksApi, "run">;
  onProceedToCheck?: (applicationId: string) => void;
  resizeImage?: (
    file: File,
  ) => Promise<Parameters<OcrApi["extract"]>[0]["image"]>;
}

/** 🔵 Intent: `api/ocr.ts`のOcrApiErrorと同じFALLBACK_MESSAGEを踏襲する。 */
const PROCEED_FALLBACK_MESSAGE = "予期しないエラーが発生しました。";

/**
 * 🔵 Intent: この画面は`OcrApi`・`ApplicationsApi`・`ChecksApi`の3つのAPIモジュールを跨ぐため、
 * それぞれ独自のエラークラス（`OcrApiError`/`ApplicationsApiError`/`ChecksApiError`）を
 * 横断して扱う。各モジュールのメッセージはサーバーの`ERROR_MESSAGES`（日本語）をそのまま
 * 転記しているため、ここでは型を判定してmessageを取り出すだけでよい。
 */
function toProceedErrorMessage(error: unknown): string {
  if (
    error instanceof OcrApiError ||
    error instanceof ApplicationsApiError ||
    error instanceof ChecksApiError
  ) {
    return error.message;
  }
  return PROCEED_FALLBACK_MESSAGE;
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}分${remaining}秒` : `${remaining}秒`;
}

/**
 * 🔴 Intent: 画面一覧の「ホーム（アップロード＋台帳）」のうちアップロード部分と
 * 「読取確認」の結果表示を1画面にまとめた。台帳（申請状況一覧）は後続タスク
 * （申請管理画面）の範囲。
 */
export function OcrPage({
  api,
  applicationsApi = defaultApplicationsApi,
  checksApi = defaultChecksApi,
  onProceedToCheck = () => {},
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
  const [isProceeding, setIsProceeding] = useState(false);
  const [proceedErrorMessage, setProceedErrorMessage] = useState<string | null>(
    null,
  );

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
    setProceedErrorMessage(null);
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
   * 🔵 Intent: F-4-6「業務チェックの再実施は編集内容を含む現在の抽出データで行う」の趣旨に
   * 沿い、この画面でその場修正した値を`updateFields`で保存してから`checksApi.run`を呼ぶ
   * （ユーザー判断・決定#33）。保存に失敗した場合は業務チェックを実行しない。成功後は
   * 申請詳細画面（`onProceedToCheck`）へ遷移し、結果表示はその画面に委ねる。
   */
  async function handleProceedToCheck() {
    if (application === null || isProceeding) {
      return;
    }
    setIsProceeding(true);
    setProceedErrorMessage(null);
    try {
      await applicationsApi.updateFields(application.id, {
        fields: fields.map((field) => ({
          label: field.label,
          value: field.value,
        })),
      });
      await checksApi.run({ applicationId: application.id });
      onProceedToCheck(application.id);
    } catch (error) {
      setProceedErrorMessage(toProceedErrorMessage(error));
    } finally {
      setIsProceeding(false);
    }
  }

  /**
   * 🔵 Intent: `ai-ocr-demo.jsx`のresetScanと同じく、申請は既に「受付」で保存済みのため
   * （F-2-8）中断してもデータは失われない。画面をホーム（アップロード待ち）へ戻すだけ。
   */
  function handleAbort() {
    setStage("idle");
    setErrorMessage(null);
    setProceedErrorMessage(null);
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

          {proceedErrorMessage !== null && (
            <p className="alert" role="alert" style={{ marginTop: 16 }}>
              {proceedErrorMessage}
            </p>
          )}

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
              disabled={isProceeding}
              onClick={() => void handleProceedToCheck()}
              style={{ flex: "1 1 200px", fontSize: 15 }}
              type="button"
            >
              業務チェックへ進む(整合性・不備・重複・判定)
            </button>
            <button
              className="btn btn-ghost"
              disabled={isProceeding}
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
