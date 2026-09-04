import type {
  ApplicationDetail,
  ApplicationListQuery,
  ApplicationListResponse,
  ChangeAppStatusRequest,
  ChangeAppStatusResponse,
  CheckRunView,
  DecideMatchRequest,
  DecideMatchResponse,
  ErrorCode,
  UpdateFieldsRequest,
} from "../../worker/types/contracts";

const FALLBACK_MESSAGE = "予期しないエラーが発生しました。";
const OFFLINE_MESSAGE =
  "サーバーへ接続できません。通信環境を確認してください。";

/** 🔵 Intent: api/auth.tsのAuthApiErrorと同じ方針。画面はcodeだけで分岐する。 */
export class ApplicationsApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, status: number, message: string) {
    super(message);
    this.name = "ApplicationsApiError";
    this.code = code;
    this.status = status;
  }
}

export function toErrorMessage(error: unknown): string {
  return error instanceof ApplicationsApiError
    ? error.message
    : FALLBACK_MESSAGE;
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

async function toApplicationsApiError(
  response: Response,
): Promise<ApplicationsApiError> {
  const body = await response.json().catch(() => null);
  const parsed = readApiError(body);
  if (parsed === null) {
    return new ApplicationsApiError(
      "INTERNAL",
      response.status,
      FALLBACK_MESSAGE,
    );
  }
  return new ApplicationsApiError(parsed.code, response.status, parsed.message);
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new ApplicationsApiError("INTERNAL", 0, OFFLINE_MESSAGE);
  }
  if (!response.ok) {
    throw await toApplicationsApiError(response);
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

/** 🟡 Intent: api.md #7のクエリパラメータへ、未指定のフィルタを含めずに変換する。 */
function toSearchParams(query: ApplicationListQuery): string {
  const params = new URLSearchParams();
  if (query.appStatus) {
    params.set("appStatus", query.appStatus);
  }
  if (query.triage) {
    params.set("triage", query.triage);
  }
  if (query.createdById) {
    params.set("createdById", query.createdById);
  }
  if (query.linked !== undefined) {
    params.set("linked", String(query.linked));
  }
  if (query.needsReviewOnly) {
    params.set("needsReviewOnly", "true");
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

export interface SignedImageUrl {
  url: string;
  expiresAt: string;
}

export interface ApplicationsApi {
  list(query: ApplicationListQuery): Promise<ApplicationListResponse>;
  get(id: string): Promise<ApplicationDetail>;
  updateFields(
    id: string,
    input: UpdateFieldsRequest,
  ): Promise<ApplicationDetail>;
  changeStatus(
    id: string,
    input: ChangeAppStatusRequest,
  ): Promise<ChangeAppStatusResponse>;
  listCheckRuns(id: string): Promise<CheckRunView[]>;
  decideMatch(
    id: string,
    candidateId: string,
    input: DecideMatchRequest,
  ): Promise<DecideMatchResponse>;
  imageUrl(id: string): Promise<SignedImageUrl>;
}

/** 🔵 Intent: SPAはWorker実装をimportせず`/api/applications/*`・`/api/images/*`だけを叩く。 */
export const applicationsApi: ApplicationsApi = {
  async changeStatus(id, input) {
    const response = await jsonRequest(
      "POST",
      `/api/applications/${id}/status`,
      input,
    );
    return (await response.json()) as ChangeAppStatusResponse;
  },

  async decideMatch(id, candidateId, input) {
    const response = await jsonRequest(
      "PATCH",
      `/api/applications/${id}/match-candidates/${candidateId}`,
      input,
    );
    return (await response.json()) as DecideMatchResponse;
  },

  async get(id) {
    const response = await request(`/api/applications/${id}`);
    return (await response.json()) as ApplicationDetail;
  },

  async imageUrl(id) {
    const response = await request(`/api/images/${id}`);
    return (await response.json()) as SignedImageUrl;
  },

  async list(query) {
    const response = await request(`/api/applications${toSearchParams(query)}`);
    return (await response.json()) as ApplicationListResponse;
  },

  async listCheckRuns(id) {
    const response = await request(`/api/applications/${id}/check-runs`);
    return (await response.json()) as CheckRunView[];
  },

  async updateFields(id, input) {
    const response = await jsonRequest(
      "PATCH",
      `/api/applications/${id}/fields`,
      input,
    );
    return (await response.json()) as ApplicationDetail;
  },
};
