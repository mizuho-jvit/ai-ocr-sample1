import type { MiddlewareHandler } from "hono";

import { ApiErrorException } from "../types";
import type { AppHonoEnv } from "./auth";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originOf(headerValue: string | undefined | null): string | null {
  if (!headerValue) {
    return null;
  }
  try {
    return new URL(headerValue).origin;
  } catch {
    return null;
  }
}

/**
 * 🔵 Intent: IPA「安全なウェブサイトの作り方」7.3章のCSRF対策。
 * 主防御はセッションCookieの `SameSite=Lax`(state-changingなクロスサイトリクエストへは
 * 付与されない)。本ガードはOrigin/Refererが送信されている場合に限り、このAPIと
 * 同一オリジンであることを多層防御として検証する(いずれも未送信の場合は
 * SameSite=Laxに委ね、拒否しない。非ブラウザクライアントとの互換性を優先するため)。
 */
export function csrfGuard(): MiddlewareHandler<AppHonoEnv> {
  return async (context, next) => {
    if (UNSAFE_METHODS.has(context.req.method)) {
      const requestOrigin = new URL(context.req.url).origin;
      const sentOrigin =
        originOf(context.req.header("Origin")) ??
        originOf(context.req.header("Referer"));
      if (sentOrigin !== null && sentOrigin !== requestOrigin) {
        throw new ApiErrorException("FORBIDDEN");
      }
    }
    await next();
  };
}
