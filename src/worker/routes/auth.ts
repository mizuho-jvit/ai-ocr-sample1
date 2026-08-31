import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";

import {
  type AppHonoEnv,
  requireSession,
  SESSION_COOKIE_NAME,
} from "../middleware/auth";
import {
  ApiErrorException,
  type LoginRequest,
  type LoginResponse,
  type SessionResponse,
} from "../types";

/** F-1-3: Cookie 属性は全経路で同一にし、失効時も同じ属性で上書きする。 */
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  path: "/",
  sameSite: "Lax",
  secure: true,
} as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** 🔵 Intent: 本文の不備を 500 ではなく 422 にし、内部例外の文言を応答へ出さない。 */
async function parseLoginRequest(request: Request): Promise<LoginRequest> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiErrorException("VALIDATION_ERROR");
  }

  if (typeof body !== "object" || body === null) {
    throw new ApiErrorException("VALIDATION_ERROR");
  }

  const { email, password } = body as Record<string, unknown>;
  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    throw new ApiErrorException("VALIDATION_ERROR");
  }

  return { email, password };
}

/**
 * 🔵 Intent: **アプリ内セッションを要求しない唯一のAPI**をここへ閉じ込める。
 * 追加するとBasic認証だけで到達できるようになるため、routes/auth.test.ts の
 * 公開ルート許可リストを併せて更新しない限りテストが落ちる。
 */
export function createPublicAuthRoutes(): Hono<AppHonoEnv> {
  const routes = new Hono<AppHonoEnv>();

  routes.post("/login", async (context) => {
    const input = await parseLoginRequest(context.req.raw);
    const result = await context.get("auth").login(input);

    setCookie(
      context,
      SESSION_COOKIE_NAME,
      result.sessionId,
      SESSION_COOKIE_OPTIONS,
    );
    return context.json<LoginResponse>({ user: result.user });
  });

  return routes;
}

/**
 * 🔵 Intent: 認証済を前提とする認証系API。保護ルーター配下へ搭載されるため、
 * `sessionGuard()` が既に適用済みである（NF-2-10）。
 */
export function createProtectedAuthRoutes(): Hono<AppHonoEnv> {
  const routes = new Hono<AppHonoEnv>();

  routes.post("/logout", async (context) => {
    const actor = await requireSession(context);
    await context.get("auth").logout(actor.sessionId);

    deleteCookie(context, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS);
    return context.body(null, 204);
  });

  routes.get("/session", async (context) => {
    const actor = await requireSession(context);

    return context.json<SessionResponse>({
      // F-9-8: 画面の出し分け専用。認可は F-9 の各APIで必ず検証する。
      features: { dataReset: context.get("config").allowDataReset },
      user: actor.user,
    });
  });

  return routes;
}
