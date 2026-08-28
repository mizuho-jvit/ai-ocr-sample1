import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { HTTPException } from "hono/http-exception";

import { loadConfig } from "./config/load-config";
import {
  type AppConfig,
  apiErrorStatus,
  toApiError,
  type WorkerEnv,
} from "./types";

export type { WorkerEnv } from "./types";

type HonoEnvironment = {
  Bindings: WorkerEnv;
  Variables: { config: AppConfig };
};

/**
 * 🔵 Intent: ルート登録前に設定を検証し、Basic認証と共通エラー処理を全経路へ適用する。
 */
export function createApp(env: WorkerEnv): Hono<HonoEnvironment> {
  const config = loadConfig(env);

  const app = new Hono<HonoEnvironment>();

  app.use("*", async (context, next) => {
    context.set("config", config);
    await next();
  });

  app.use(
    "*",
    basicAuth({
      password: env.BASIC_AUTH_PASSWORD,
      username: env.BASIC_AUTH_USERNAME,
    }),
  );

  app.onError((error) => {
    if (error instanceof HTTPException && error.status === 401) {
      return error.getResponse();
    }
    return new Response(JSON.stringify(toApiError(error)), {
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      status: apiErrorStatus(error),
    });
  });

  app.notFound((context) => context.env.ASSETS.fetch(context.req.raw));

  return app;
}

export default {
  fetch(request, env, executionContext) {
    return createApp(env).fetch(request, env, executionContext);
  },
} satisfies ExportedHandler<WorkerEnv>;
