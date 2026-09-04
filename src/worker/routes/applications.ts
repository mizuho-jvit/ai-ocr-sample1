import { Hono } from "hono";

import type { AppHonoEnv } from "../middleware/auth";
import { requireSession } from "../middleware/auth";
import {
  ApiErrorException,
  type ApplicationDetail,
  type ApplicationListQuery,
  type ApplicationListResponse,
  type ChangeAppStatusRequest,
  type ChangeAppStatusResponse,
  type CheckRunView,
  type DecideMatchRequest,
  type DecideMatchResponse,
  type MatchStatus,
  toApplicationId,
  toMatchCandidateId,
  toStaffUserId,
  type UpdateFieldsRequest,
} from "../types";

const APP_STATUS_VALUES = new Set([
  "received",
  "under_review",
  "approved",
  "returned",
]);
const TRIAGE_VALUES = new Set([
  "approval_candidate",
  "needs_review",
  "return_candidate",
]);
/** F-6-8・DecideMatchRequest: `stale`は職員が選べる決定に含めない（システム内部状態）。 */
const DECIDABLE_MATCH_STATUS_VALUES = new Set(["merged", "rejected", "hold"]);

function validationError(): ApiErrorException {
  return new ApiErrorException("VALIDATION_ERROR");
}

/**
 * 🟡 Intent: `ApplicationListQuery`は要件に422の定めが無い（api.md #7は200/401のみ）ため、
 * 未知・不正な値は無視してフィルタなし相当にする（他画面のドロップダウン由来を想定し、
 * 直接クエリを叩く場合の422より一覧の可用性を優先する）。
 */
function parseApplicationListQuery(
  raw: Record<string, string>,
): ApplicationListQuery {
  const query: ApplicationListQuery = {};
  if (raw.appStatus && APP_STATUS_VALUES.has(raw.appStatus)) {
    query.appStatus = raw.appStatus as ApplicationListQuery["appStatus"];
  }
  if (raw.triage && TRIAGE_VALUES.has(raw.triage)) {
    query.triage = raw.triage as ApplicationListQuery["triage"];
  }
  if (raw.createdById) {
    query.createdById = toStaffUserId(raw.createdById);
  }
  if (raw.linked === "true" || raw.linked === "false") {
    query.linked = raw.linked === "true";
  }
  if (raw.needsReviewOnly === "true") {
    query.needsReviewOnly = true;
  }
  const page = Number.parseInt(raw.page ?? "", 10);
  if (Number.isInteger(page) && page > 0) {
    query.page = page;
  }
  const perPage = Number.parseInt(raw.perPage ?? "", 10);
  if (Number.isInteger(perPage) && perPage > 0) {
    query.perPage = perPage;
  }
  return query;
}

function parseUpdateFieldsRequest(body: unknown): UpdateFieldsRequest {
  if (typeof body !== "object" || body === null) {
    throw validationError();
  }
  const { fields } = body as Record<string, unknown>;
  if (!Array.isArray(fields)) {
    throw validationError();
  }
  const parsed = fields.map((field) => {
    if (typeof field !== "object" || field === null) {
      throw validationError();
    }
    const { label, value } = field as Record<string, unknown>;
    if (typeof label !== "string" || typeof value !== "string") {
      throw validationError();
    }
    return { label, value };
  });
  return { fields: parsed };
}

function parseChangeAppStatusRequest(body: unknown): ChangeAppStatusRequest {
  if (typeof body !== "object" || body === null) {
    throw validationError();
  }
  const { toStatus, note } = body as Record<string, unknown>;
  if (typeof toStatus !== "string" || !APP_STATUS_VALUES.has(toStatus)) {
    throw validationError();
  }
  if (note !== undefined && typeof note !== "string") {
    throw validationError();
  }
  return {
    note,
    toStatus: toStatus as ChangeAppStatusRequest["toStatus"],
  };
}

function parseDecideMatchRequest(body: unknown): DecideMatchRequest {
  if (typeof body !== "object" || body === null) {
    throw validationError();
  }
  const { decision } = body as Record<string, unknown>;
  if (
    typeof decision !== "string" ||
    !DECIDABLE_MATCH_STATUS_VALUES.has(decision)
  ) {
    throw validationError();
  }
  return { decision: decision as Exclude<MatchStatus, "pending" | "stale"> };
}

/**
 * 🔵 Intent: `/api/applications`配下のCRUD（api.md #7・#9〜#13）。状態遷移・名寄せ判断の
 * 整合はcreateApplicationServiceへ委ね、ここではリクエストの検証とセッション解決だけを行う
 * （routes/checks.tsと同じ方針）。`DELETE /:id/image`（api.md #15）はTask 007由来の
 * `createApplicationImageRoutes`（routes/ocr.ts）に残し、index.tsで同じ`/applications`prefixへ
 * 併せて登録する。
 */
export function createApplicationRoutes(): Hono<AppHonoEnv> {
  const routes = new Hono<AppHonoEnv>();

  routes.get("/", async (context) => {
    await requireSession(context);
    const query = parseApplicationListQuery(context.req.query());
    const result = await context.get("applicationService").list(query);
    return context.json<ApplicationListResponse>(result);
  });

  routes.get("/:id", async (context) => {
    await requireSession(context);
    const applicationId = toApplicationId(context.req.param("id"));
    const application = await context
      .get("applicationService")
      .get(applicationId);
    return context.json<ApplicationDetail>(application);
  });

  routes.patch("/:id/fields", async (context) => {
    const actor = await requireSession(context);
    const applicationId = toApplicationId(context.req.param("id"));
    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      throw validationError();
    }
    const input = parseUpdateFieldsRequest(rawBody);
    const application = await context
      .get("applicationService")
      .updateFields(applicationId, actor, input);
    return context.json<ApplicationDetail>(application);
  });

  routes.post("/:id/status", async (context) => {
    const actor = await requireSession(context);
    const applicationId = toApplicationId(context.req.param("id"));
    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      throw validationError();
    }
    const input = parseChangeAppStatusRequest(rawBody);
    const result = await context
      .get("applicationService")
      .changeStatus(applicationId, actor, input);
    return context.json<ChangeAppStatusResponse>(result);
  });

  routes.get("/:id/check-runs", async (context) => {
    await requireSession(context);
    const applicationId = toApplicationId(context.req.param("id"));
    const checkRuns = await context
      .get("applicationService")
      .listCheckRuns(applicationId);
    return context.json<CheckRunView[]>(checkRuns);
  });

  routes.patch("/:id/match-candidates/:candidateId", async (context) => {
    const actor = await requireSession(context);
    const applicationId = toApplicationId(context.req.param("id"));
    const candidateId = toMatchCandidateId(context.req.param("candidateId"));
    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      throw validationError();
    }
    const input = parseDecideMatchRequest(rawBody);
    const result = await context
      .get("applicationService")
      .decideMatch(applicationId, candidateId, actor, input);
    return context.json<DecideMatchResponse>(result);
  });

  return routes;
}
