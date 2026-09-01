import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import type { TenantRepository } from "../db/repositories";
import type { OperationTrace } from "../observability/operation-trace";
import type { AuthService, SessionActor } from "../services/auth";
import type { ImageStorage } from "../services/image-storage";
import type { UsageService } from "../services/usage";
import {
  ApiErrorException,
  type AppConfig,
  type OcrPipeline,
  toSessionId,
  type WorkerEnv,
} from "../types";

/** F-1-3: セッションIDを載せる Cookie 名。 */
export const SESSION_COOKIE_NAME = "session";

export type AppHonoEnv = {
  Bindings: WorkerEnv;
  Variables: {
    actor?: SessionActor;
    auth: AuthService;
    config: AppConfig;
    imageStorage: ImageStorage;
    ocrPipeline: OcrPipeline;
    repository: TenantRepository;
    trace: OperationTrace;
    usage: UsageService;
  };
};

/**
 * 🔵 Intent: NF-2-10 に従い、Basic認証を通過していてもアプリ内セッションが無ければ 401 にする。
 * 1リクエスト内では解決結果を再利用し、PBKDF2 以外のD1往復も増やさない。
 */
export async function requireSession(
  context: Context<AppHonoEnv>,
): Promise<SessionActor> {
  const resolved = context.get("actor");
  if (resolved) {
    return resolved;
  }

  const sessionId = getCookie(context, SESSION_COOKIE_NAME);
  if (!sessionId) {
    throw new ApiErrorException("UNAUTHENTICATED");
  }

  const actor = await context
    .get("auth")
    .resolveSession(toSessionId(sessionId));
  if (!actor) {
    throw new ApiErrorException("UNAUTHENTICATED");
  }

  context.set("actor", actor);
  return actor;
}

/**
 * 🔵 Intent: NF-2-11・F-7-2 のロール認可をAPI層で必ず通す。画面側の制御に依存しない。
 */
export function requireAdmin(actor: SessionActor): void {
  if (actor.user.role !== "admin") {
    throw new ApiErrorException("FORBIDDEN");
  }
}

/** 🔵 Intent: 認証済であることだけを要求するルートへ付ける。 */
export function sessionGuard(): MiddlewareHandler<AppHonoEnv> {
  return async (context, next) => {
    await requireSession(context);
    await next();
  };
}

/** 🔵 Intent: admin 専用ルートへ付ける。未認証は 403 より先に 401 とする。 */
export function adminGuard(): MiddlewareHandler<AppHonoEnv> {
  return async (context, next) => {
    requireAdmin(await requireSession(context));
    await next();
  };
}
