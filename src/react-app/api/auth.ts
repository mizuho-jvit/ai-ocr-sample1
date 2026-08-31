import type {
  ErrorCode,
  LoginRequest,
  LoginResponse,
  SessionResponse,
} from "../../worker/types/contracts";

const FALLBACK_MESSAGE = "予期しないエラーが発生しました。";
const OFFLINE_MESSAGE =
  "サーバーへ接続できません。通信環境を確認してください。";

/**
 * 🔵 Intent: 画面が分岐に使えるのは `code` だけ。HTTPステータスは補助情報として持つ。
 * 401 は「アプリ内セッション切れ(UNAUTHENTICATED)」「資格情報の誤り
 * (INVALID_CREDENTIALS)」「Basic認証のチャレンジ」の3種が同居するため、
 * ステータスでの分岐は誤誘導になる。
 */
export class AuthApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, status: number, message: string) {
    super(message);
    this.name = "AuthApiError";
    this.code = code;
    this.status = status;
  }
}

export interface AuthApi {
  session(): Promise<SessionResponse>;
  login(input: LoginRequest): Promise<LoginResponse>;
  logout(): Promise<void>;
}

/** 🟡 Intent: 例外の由来を問わず画面に出せる文言へ落とす。 */
export function toErrorMessage(error: unknown): string {
  return error instanceof AuthApiError ? error.message : FALLBACK_MESSAGE;
}

/**
 * 🟡 Intent: 応答本文を信用せずに検証する。Basic認証のチャレンジのように
 * JSONでない401が届くため、パースできない応答を未認証と解釈してはいけない。
 */
function readApiError(
  body: unknown,
): { code: ErrorCode; message: string } | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const { error } = body as Record<string, unknown>;
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const { code, message } = error as Record<string, unknown>;
  if (typeof code !== "string" || typeof message !== "string") {
    return null;
  }

  return { code: code as ErrorCode, message };
}

async function toAuthApiError(response: Response): Promise<AuthApiError> {
  const body = await response.json().catch(() => null);
  const parsed = readApiError(body);
  if (parsed === null) {
    // 未認証と誤判定するとログイン画面へ誘導し続けるため、INTERNALへ寄せる。
    return new AuthApiError("INTERNAL", response.status, FALLBACK_MESSAGE);
  }
  return new AuthApiError(parsed.code, response.status, parsed.message);
}

/** セッションCookieはHTTPOnlyのため、JS側は保持せず毎回Cookieを送るだけにする。 */
async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new AuthApiError("INTERNAL", 0, OFFLINE_MESSAGE);
  }

  if (!response.ok) {
    throw await toAuthApiError(response);
  }
  return response;
}

/**
 * 🔵 Intent: SPAはWorker実装をimportせず `/api/auth/*` の3エンドポイントだけを叩く。
 * トークンをJS側へ保存しないため、認証状態の唯一の情報源は `session()` の結果。
 */
export const authApi: AuthApi = {
  async login(input) {
    const response = await request("/api/auth/login", {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return (await response.json()) as LoginResponse;
  },

  async logout() {
    await request("/api/auth/logout", { method: "POST" });
  },

  async session() {
    const response = await request("/api/auth/session");
    return (await response.json()) as SessionResponse;
  },
};
