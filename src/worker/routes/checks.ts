import { Hono } from "hono";

import type { AppHonoEnv } from "../middleware/auth";
import { requireSession } from "../middleware/auth";
import {
  ApiErrorException,
  type RunCheckRequest,
  type RunCheckResponse,
  toApplicationId,
} from "../types";

function validationError(): ApiErrorException {
  return new ApiErrorException("VALIDATION_ERROR");
}

/** 🔵 Intent: ocr.tsのparseOcrExtractRequestと同じ方針で本文の不備を422にする。 */
function parseRunCheckRequest(body: unknown): RunCheckRequest {
  if (typeof body !== "object" || body === null) {
    throw validationError();
  }
  const { applicationId } = body as Record<string, unknown>;
  if (typeof applicationId !== "string" || applicationId.length === 0) {
    throw validationError();
  }
  return { applicationId: toApplicationId(applicationId) };
}

/**
 * 🔵 Intent: `POST /api/checks/run`（api.md #6・F-3・F-4-6）。状態遷移・Usage・CheckRun・
 * MatchCandidateの整合はcreateBusinessCheckServiceへ委ね、ここではリクエストの検証と
 * セッション解決だけを行う。
 */
export function createCheckRoutes(): Hono<AppHonoEnv> {
  const routes = new Hono<AppHonoEnv>();

  routes.post("/run", async (context) => {
    const actor = await requireSession(context);

    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      throw validationError();
    }
    const { applicationId } = parseRunCheckRequest(rawBody);

    const result = await context.get("businessCheck").run(actor, applicationId);

    return context.json<RunCheckResponse>(result);
  });

  return routes;
}
