import { Hono, type MiddlewareHandler } from "hono";

import {
  type AppHonoEnv,
  requireAdmin,
  requireSession,
} from "../middleware/auth";
import {
  ApiErrorException,
  type ResetPreviewResponse,
  type ResetRequest,
  type ResetResponse,
} from "../types";

function validationError(): ApiErrorException {
  return new ApiErrorException("VALIDATION_ERROR");
}

function parseResetRequest(body: unknown): ResetRequest {
  if (typeof body !== "object" || body === null) {
    throw validationError();
  }
  const { confirmation, snapshotToken } = body as Record<string, unknown>;
  if (typeof confirmation !== "string") {
    throw validationError();
  }
  if (typeof snapshotToken !== "string" || snapshotToken.length === 0) {
    throw validationError();
  }
  return { confirmation, snapshotToken };
}

/**
 * 🔵 Intent: F-9-8。`ALLOW_DATA_RESET`が無効な環境では機能の存在自体を露出させない
 * ため、ロール確認(403)より先に404で弾く(api.mdのdataflow.mdのFLAG→ROLEの順序)。
 * `sessionGuard()`は`index.ts`側で既に全`/api`配下へ適用済みのため、ここでは
 * 「機能フラグ」と「admin」だけを追加で検証する。
 */
function demoResetGuard(): MiddlewareHandler<AppHonoEnv> {
  return async (context, next) => {
    if (!context.get("config").allowDataReset) {
      throw new ApiErrorException("NOT_FOUND");
    }
    requireAdmin(await requireSession(context));
    await next();
  };
}

/**
 * 🔵 Intent: `/api/demo/reset/*`(api.md #27〜28・F-9)。
 */
export function createDemoRoutes(): Hono<AppHonoEnv> {
  const routes = new Hono<AppHonoEnv>();

  routes.use("*", demoResetGuard());

  routes.get("/reset/preview", async (context) => {
    const preview = await context.get("demoReset").preview();
    return context.json<ResetPreviewResponse>(preview);
  });

  routes.post("/reset", async (context) => {
    const actor = await requireSession(context);
    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      throw validationError();
    }
    const input = parseResetRequest(rawBody);
    const result = await context.get("demoReset").reset(input, actor);
    return context.json<ResetResponse>(result);
  });

  return routes;
}
