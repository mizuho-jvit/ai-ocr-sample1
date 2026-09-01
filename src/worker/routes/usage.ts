import { Hono } from "hono";

import type { AppHonoEnv } from "../middleware/auth";
import type { UsageResponse } from "../types";

/**
 * 🔵 Intent: ホーム画面の当月残量表示専用（NF-2-18）。読み取りのみでカウンタを加算しない。
 * `sessionGuard()` は搭載元（index.ts）の保護ルーターで既に適用済み。
 */
export function createUsageRoutes(): Hono<AppHonoEnv> {
  const routes = new Hono<AppHonoEnv>();

  routes.get("/", async (context) => {
    const usage = await context.get("usage").getUsage();
    return context.json<UsageResponse>(usage);
  });

  return routes;
}
