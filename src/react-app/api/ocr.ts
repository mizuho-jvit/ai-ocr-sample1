import type {
  ErrorCode,
  OcrExtractRequest,
  OcrExtractResponse,
  PreparedImage,
} from "../../worker/types/contracts";

const FALLBACK_MESSAGE = "予期しないエラーが発生しました。";
const OFFLINE_MESSAGE =
  "サーバーへ接続できません。通信環境を確認してください。";

/** F-2-2: クライアント側リサイズの目標値（定数。環境変数では変更しない）。 */
export const MAX_LONG_EDGE_PX = 1568;
export const JPEG_QUALITY = 0.85;

/** 🔵 Intent: `retryable` はAI_UNAVAILABLE(503)の再試行可否を画面が判断する材料。 */
export class OcrApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "OcrApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export interface OcrApi {
  extract(input: OcrExtractRequest): Promise<OcrExtractResponse>;
}

export function toErrorMessage(error: unknown): string {
  return error instanceof OcrApiError ? error.message : FALLBACK_MESSAGE;
}

function readApiError(
  body: unknown,
): { code: ErrorCode; message: string; retryable: boolean } | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { error } = body as Record<string, unknown>;
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const { code, message, retryable } = error as Record<string, unknown>;
  if (typeof code !== "string" || typeof message !== "string") {
    return null;
  }
  return { code: code as ErrorCode, message, retryable: retryable === true };
}

async function toOcrApiError(response: Response): Promise<OcrApiError> {
  const body = await response.json().catch(() => null);
  const parsed = readApiError(body);
  if (parsed === null) {
    return new OcrApiError(
      "INTERNAL",
      response.status,
      FALLBACK_MESSAGE,
      false,
    );
  }
  return new OcrApiError(
    parsed.code,
    response.status,
    parsed.message,
    parsed.retryable,
  );
}

export const ocrApi: OcrApi = {
  async extract(input) {
    let response: Response;
    try {
      response = await fetch("/api/ocr/extract", {
        body: JSON.stringify(input),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    } catch {
      throw new OcrApiError("INTERNAL", 0, OFFLINE_MESSAGE, true);
    }
    if (!response.ok) {
      throw await toOcrApiError(response);
    }
    return (await response.json()) as OcrExtractResponse;
  },
};

/**
 * 🔵 Intent: F-2-2の縮小先サイズの計算だけを純関数として切り出す。
 * Canvas描画そのものはhappy-domで検証できないため、ここを単体テストの対象にする。
 * 既に長辺がmaxLongEdgePx以下の画像は拡大しない（劣化を避けるための🔴判断）。
 */
export function computeResizedDimensions(
  width: number,
  height: number,
  maxLongEdgePx: number = MAX_LONG_EDGE_PX,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdgePx) {
    return { width, height };
  }
  const scale = maxLongEdgePx / longEdge;
  return {
    height: Math.round(height * scale),
    width: Math.round(width * scale),
  };
}

/**
 * 🔴 Intent: F-2-1/F-2-2。選択・撮影・D&Dされた画像ファイルを、Worker側では
 * 画像処理を行わない前提（api.md「帳票読取」節）に沿ってブラウザ側でリサイズする。
 * ライブラリを追加せず標準のCanvas APIで完結させる。
 */
export async function resizeImageToJpeg(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = computeResizedDimensions(
      bitmap.width,
      bitmap.height,
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is not available");
    }
    context.drawImage(bitmap, 0, 0, width, height);

    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return { base64, mimeType: "image/jpeg" };
  } finally {
    bitmap.close();
  }
}
