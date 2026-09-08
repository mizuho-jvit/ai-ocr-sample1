import { useCallback, useEffect, useState } from "react";

import type {
  ResetPreviewResponse,
  ResetResponse,
} from "../../worker/types/contracts";
import type { DemoResetApi } from "../api/demo-reset";
import { toErrorMessage } from "../api/demo-reset";

export interface ResetPageProps {
  api: Pick<DemoResetApi, "preview" | "reset">;
}

/**
 * F-9-9。デモデータを削除しても月次のAI呼び出し上限は回復しない。
 * 実行結果に併せて表示することで、件数が消えたことで枠が戻ったと誤解させない。
 */
const USAGE_COUNTER_NOTICE = "当月のAI呼び出し上限は回復しません。";

/**
 * 🔵 Intent: F-9の唯一の画面(screen-list.md「デモデータ初期化」)。
 * 削除対象の件数表示(F-9-7)・確認語の入力(F-9-7)・実行結果の表示(F-9-9)を1画面で完結させる。
 */
export function ResetPage({ api }: ResetPageProps) {
  const [preview, setPreview] = useState<ResetPreviewResponse | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [confirmationInput, setConfirmationInput] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<ResetResponse | null>(null);

  const loadPreview = useCallback(async () => {
    setIsLoadingPreview(true);
    setPreviewError(null);
    try {
      const result = await api.preview();
      setPreview(result);
    } catch (error) {
      setPreviewError(toErrorMessage(error));
    } finally {
      setIsLoadingPreview(false);
    }
  }, [api]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  async function handleReset() {
    if (preview === null || confirmationInput !== preview.confirmationWord) {
      return;
    }
    setIsResetting(true);
    setResetError(null);
    try {
      const result = await api.reset({
        confirmation: confirmationInput,
        snapshotToken: preview.snapshotToken,
      });
      setResetResult(result);
      setConfirmationInput("");
      await loadPreview();
    } catch (error) {
      setResetError(toErrorMessage(error));
      // コードレビュー指摘・P2: 確認後に対象が変わっていた場合(409)、最新の件数を
      // 取り直させて再確認を促す。それ以外の失敗でも表示中の件数を古いままにしない。
      await loadPreview();
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <div className="goth reset-page">
      <h2 className="serif page-heading">デモデータ初期化</h2>

      {previewError !== null && (
        <p className="alert" role="alert" style={{ marginBottom: 14 }}>
          {previewError}
        </p>
      )}

      {isLoadingPreview && (
        <p className="status-message" role="status">
          読み込んでいます…
        </p>
      )}

      {!isLoadingPreview && preview !== null && (
        <div className="card card-section">
          <h3 className="card-section-title">削除対象の件数</h3>
          <ul>
            <li>申請: {preview.applications}件</li>
            <li>原本画像: {preview.images}件</li>
            <li>会員（シードを除く）: {preview.members}件</li>
          </ul>
          <p>この操作は取り消せません。</p>
          <p>{USAGE_COUNTER_NOTICE}</p>

          <div className="field-grid">
            <label className="field-label">
              確認のため「{preview.confirmationWord}」と入力してください
              <input
                className="field-input"
                onChange={(event) => setConfirmationInput(event.target.value)}
                value={confirmationInput}
              />
            </label>
          </div>

          {resetError !== null && (
            <p className="alert" role="alert" style={{ marginBottom: 10 }}>
              {resetError}
            </p>
          )}

          <button
            className="btn btn-primary"
            disabled={
              isResetting || confirmationInput !== preview.confirmationWord
            }
            onClick={() => void handleReset()}
            type="button"
          >
            初期化を実行する
          </button>
        </div>
      )}

      {resetResult !== null && (
        <div
          className="card card-section"
          role="status"
          style={{ marginTop: 14 }}
        >
          <h3 className="card-section-title">実行結果</h3>
          <ul>
            <li>削除した申請: {resetResult.deleted.applications}件</li>
            <li>削除した原本画像: {resetResult.deleted.images}件</li>
            <li>削除した会員: {resetResult.deleted.members}件</li>
          </ul>
          <p>{USAGE_COUNTER_NOTICE}</p>
        </div>
      )}
    </div>
  );
}
