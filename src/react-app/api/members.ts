import type {
  ChangeMemberStatusRequest,
  CreateMemberRequest,
  ErrorCode,
  MatchCandidateView,
  MemberDetail,
  MemberListQuery,
  MemberListResponse,
  UpdateMemberRequest,
} from "../../worker/types/contracts";

const FALLBACK_MESSAGE = "予期しないエラーが発生しました。";
const OFFLINE_MESSAGE =
  "サーバーへ接続できません。通信環境を確認してください。";

/** 🔵 Intent: api/applications.tsのApplicationsApiErrorと同じ方針。画面はcodeだけで分岐する。 */
export class MembersApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, status: number, message: string) {
    super(message);
    this.name = "MembersApiError";
    this.code = code;
    this.status = status;
  }
}

export function toErrorMessage(error: unknown): string {
  return error instanceof MembersApiError ? error.message : FALLBACK_MESSAGE;
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

async function toMembersApiError(response: Response): Promise<MembersApiError> {
  const body = await response.json().catch(() => null);
  const parsed = readApiError(body);
  if (parsed === null) {
    return new MembersApiError("INTERNAL", response.status, FALLBACK_MESSAGE);
  }
  return new MembersApiError(parsed.code, response.status, parsed.message);
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new MembersApiError("INTERNAL", 0, OFFLINE_MESSAGE);
  }
  if (!response.ok) {
    throw await toMembersApiError(response);
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

/** 🟡 Intent: api.md #19のクエリパラメータへ、未指定のフィルタを含めずに変換する。 */
function toSearchParams(query: MemberListQuery): string {
  const params = new URLSearchParams();
  if (query.q) {
    params.set("q", query.q);
  }
  if (query.birthDate) {
    params.set("birthDate", query.birthDate);
  }
  if (query.phone) {
    params.set("phone", query.phone);
  }
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.page) {
    params.set("page", String(query.page));
  }
  if (query.perPage) {
    params.set("perPage", String(query.perPage));
  }
  const search = params.toString();
  return search.length > 0 ? `?${search}` : "";
}

export interface MembersApi {
  list(query: MemberListQuery): Promise<MemberListResponse>;
  get(id: string): Promise<MemberDetail>;
  create(input: CreateMemberRequest): Promise<MemberDetail>;
  update(id: string, input: UpdateMemberRequest): Promise<MemberDetail>;
  changeStatus(
    id: string,
    input: ChangeMemberStatusRequest,
  ): Promise<MemberDetail>;
  listMatchCandidates(): Promise<MatchCandidateView[]>;
}

/** 🔵 Intent: SPAはWorker実装をimportせず`/api/members/*`だけを叩く。 */
export const membersApi: MembersApi = {
  async changeStatus(id, input) {
    const response = await jsonRequest(
      "POST",
      `/api/members/${id}/status`,
      input,
    );
    return (await response.json()) as MemberDetail;
  },

  async create(input) {
    const response = await jsonRequest("POST", "/api/members", input);
    return (await response.json()) as MemberDetail;
  },

  async get(id) {
    const response = await request(`/api/members/${id}`);
    return (await response.json()) as MemberDetail;
  },

  async list(query) {
    const response = await request(`/api/members${toSearchParams(query)}`);
    return (await response.json()) as MemberListResponse;
  },

  async listMatchCandidates() {
    const response = await request("/api/members/match-candidates");
    return (await response.json()) as MatchCandidateView[];
  },

  async update(id, input) {
    const response = await jsonRequest("PATCH", `/api/members/${id}`, input);
    return (await response.json()) as MemberDetail;
  },
};
