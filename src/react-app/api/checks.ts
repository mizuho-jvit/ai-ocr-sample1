import type { ErrorCode, RunCheckResponse } from "../../worker/types/contracts";

const FALLBACK_MESSAGE = "予期しないエラーが発生しました。";
const OFFLINE_MESSAGE =
  "サーバーへ接続できません。通信環境を確認してください。";

/** 🔵 Intent: api/ocr.tsのOcrApiErrorと同じ方針。retryableはAI_UNAVAILABLE(503)の再試行可否を画面が判断する材料。 */
export class ChecksApiError extends Error {
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
    this.name = "ChecksApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function toErrorMessage(error: unknown): string {
  return error instanceof ChecksApiError ? error.message : FALLBACK_MESSAGE;
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

async function toChecksApiError(response: Response): Promise<ChecksApiError> {
  const body = await response.json().catch(() => null);
  const parsed = readApiError(body);
  if (parsed === null) {
    return new ChecksApiError(
      "INTERNAL",
      response.status,
      FALLBACK_MESSAGE,
      false,
    );
  }
  return new ChecksApiError(
    parsed.code,
    response.status,
    parsed.message,
    parsed.retryable,
  );
}

/** 🔵 Intent: `RunCheckRequest.applicationId`はWorker側のbranded型のため、
 * `ApplicationsApi`と同じくSPA境界では素の`string`を受け取る（`applications.ts`のidと同じ方針）。 */
export interface RunCheckInput {
  applicationId: string;
}

export interface ChecksApi {
  run(input: RunCheckInput): Promise<RunCheckResponse>;
}

/** 🔵 Intent: SPAはWorker実装をimportせず`POST /api/checks/run`（api.md #6）だけを叩く。 */
export const checksApi: ChecksApi = {
  async run(input) {
    let response: Response;
    try {
      response = await fetch("/api/checks/run", {
        body: JSON.stringify(input),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    } catch {
      throw new ChecksApiError("INTERNAL", 0, OFFLINE_MESSAGE, true);
    }
    if (!response.ok) {
      throw await toChecksApiError(response);
    }
    return (await response.json()) as RunCheckResponse;
  },
};
