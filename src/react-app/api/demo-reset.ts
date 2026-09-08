import type {
  ErrorCode,
  ResetPreviewResponse,
  ResetRequest,
  ResetResponse,
} from "../../worker/types/contracts";

const FALLBACK_MESSAGE = "予期しないエラーが発生しました。";
const OFFLINE_MESSAGE =
  "サーバーへ接続できません。通信環境を確認してください。";

/** 🔵 Intent: api/staff.tsのStaffApiErrorと同じ方針。画面はcodeだけで分岐する。 */
export class DemoResetApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, status: number, message: string) {
    super(message);
    this.name = "DemoResetApiError";
    this.code = code;
    this.status = status;
  }
}

export function toErrorMessage(error: unknown): string {
  return error instanceof DemoResetApiError ? error.message : FALLBACK_MESSAGE;
}

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

async function toDemoResetApiError(
  response: Response,
): Promise<DemoResetApiError> {
  const body = await response.json().catch(() => null);
  const parsed = readApiError(body);
  if (parsed === null) {
    return new DemoResetApiError("INTERNAL", response.status, FALLBACK_MESSAGE);
  }
  return new DemoResetApiError(parsed.code, response.status, parsed.message);
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new DemoResetApiError("INTERNAL", 0, OFFLINE_MESSAGE);
  }
  if (!response.ok) {
    throw await toDemoResetApiError(response);
  }
  return response;
}

export interface DemoResetApi {
  preview(): Promise<ResetPreviewResponse>;
  reset(input: ResetRequest): Promise<ResetResponse>;
}

/** 🔵 Intent: SPAはWorker実装をimportせず`/api/demo/reset/*`だけを叩く。 */
export const demoResetApi: DemoResetApi = {
  async preview() {
    const response = await request("/api/demo/reset/preview");
    return (await response.json()) as ResetPreviewResponse;
  },

  async reset(input) {
    const response = await request("/api/demo/reset", {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return (await response.json()) as ResetResponse;
  },
};
