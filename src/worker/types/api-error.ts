import type { ApiError, ErrorCode } from "./contracts";

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  AI_UNAVAILABLE:
    "AIサービスを利用できません。時間をおいて再試行してください。",
  CHECK_RUN_LIMIT: "業務チェックの実施回数が上限に達しました。",
  FORBIDDEN: "この操作を実行する権限がありません。",
  INTERNAL: "予期しないエラーが発生しました。",
  INVALID_CREDENTIALS: "メールまたはパスワードが違います。",
  INVALID_TRANSITION: "現在の状態ではこの操作を実行できません。",
  NOT_FOUND: "対象が見つかりません。",
  UNAUTHENTICATED: "ログインが必要です。",
  USAGE_LIMIT_EXCEEDED: "今月の利用上限に達しました。",
  VALIDATION_ERROR: "入力内容を確認してください。",
};

const ERROR_STATUS: Record<ErrorCode, number> = {
  AI_UNAVAILABLE: 503,
  CHECK_RUN_LIMIT: 409,
  FORBIDDEN: 403,
  INTERNAL: 500,
  INVALID_CREDENTIALS: 401,
  INVALID_TRANSITION: 409,
  NOT_FOUND: 404,
  UNAUTHENTICATED: 401,
  USAGE_LIMIT_EXCEEDED: 429,
  VALIDATION_ERROR: 422,
};

export class ApiErrorException extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ApiErrorException";
    this.code = code;
  }
}

/**
 * 🔵 Intent: 予期しない例外のmessageやstackをAPI応答へコピーせず、秘密値の露出を防ぐ。
 */
export function toApiError(error: unknown): ApiError {
  const code = error instanceof ApiErrorException ? error.code : "INTERNAL";
  return {
    error: {
      code,
      message: ERROR_MESSAGES[code],
      ...(code === "AI_UNAVAILABLE" ? { retryable: true } : {}),
    },
  };
}

/**
 * 🔵 Intent: 共通エラーコードとHTTPステータスの対応を1箇所に集約する。
 */
export function apiErrorStatus(error: unknown): number {
  const code = error instanceof ApiErrorException ? error.code : "INTERNAL";
  return ERROR_STATUS[code];
}
