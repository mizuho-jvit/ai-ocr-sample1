import type {
  CreateStaffRequest,
  ErrorCode,
  StaffUserSummary,
  UpdateStaffRequest,
} from "../../worker/types/contracts";

const FALLBACK_MESSAGE = "予期しないエラーが発生しました。";
const OFFLINE_MESSAGE =
  "サーバーへ接続できません。通信環境を確認してください。";

/** 🔵 Intent: api/members.tsのMembersApiErrorと同じ方針。画面はcodeだけで分岐する。 */
export class StaffApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, status: number, message: string) {
    super(message);
    this.name = "StaffApiError";
    this.code = code;
    this.status = status;
  }
}

export function toErrorMessage(error: unknown): string {
  return error instanceof StaffApiError ? error.message : FALLBACK_MESSAGE;
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

async function toStaffApiError(response: Response): Promise<StaffApiError> {
  const body = await response.json().catch(() => null);
  const parsed = readApiError(body);
  if (parsed === null) {
    return new StaffApiError("INTERNAL", response.status, FALLBACK_MESSAGE);
  }
  return new StaffApiError(parsed.code, response.status, parsed.message);
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new StaffApiError("INTERNAL", 0, OFFLINE_MESSAGE);
  }
  if (!response.ok) {
    throw await toStaffApiError(response);
  }
  return response;
}

function jsonRequest(
  method: string,
  path: string,
  body: unknown,
): Promise<Response> {
  return request(path, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
}

export interface StaffApi {
  list(): Promise<StaffUserSummary[]>;
  create(input: CreateStaffRequest): Promise<StaffUserSummary>;
  update(id: string, input: UpdateStaffRequest): Promise<StaffUserSummary>;
}

/** 🔵 Intent: SPAはWorker実装をimportせず`/api/staff/*`だけを叩く。 */
export const staffApi: StaffApi = {
  async create(input) {
    const response = await jsonRequest("POST", "/api/staff", input);
    return (await response.json()) as StaffUserSummary;
  },

  async list() {
    const response = await request("/api/staff");
    return (await response.json()) as StaffUserSummary[];
  },

  async update(id, input) {
    const response = await jsonRequest("PATCH", `/api/staff/${id}`, input);
    return (await response.json()) as StaffUserSummary;
  },
};
