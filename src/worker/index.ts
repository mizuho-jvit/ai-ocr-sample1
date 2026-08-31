import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";

import { loadConfig } from "./config/load-config";
import {
  createTenantRepository,
  initializeTenantRepository,
  type TenantRepository,
} from "./db/repositories";
import { type AppHonoEnv, sessionGuard } from "./middleware/auth";
import { emitRequestLog } from "./observability/logger";
import {
  createOperationTrace,
  executeOperation,
  finalizeOperationTrace,
  type OperationTrace,
} from "./observability/operation-trace";
import {
  createProtectedAuthRoutes,
  createPublicAuthRoutes,
} from "./routes/auth";
import { createAuthService } from "./services/auth";
import {
  type AppConfig,
  apiErrorStatus,
  toApiError,
  type WorkerEnv,
} from "./types";

export type { WorkerEnv } from "./types";

const databaseInitialization = new WeakMap<D1Database, Promise<void>>();

function initializeDatabase(
  database: D1Database,
  config: AppConfig,
  trace?: OperationTrace,
): Promise<void> {
  const existing = databaseInitialization.get(database);
  if (existing) {
    return existing;
  }

  const initialization = initializeTenantRepository(database, config, trace)
    .then(() => undefined)
    .catch((error) => {
      databaseInitialization.delete(database);
      throw error;
    });
  databaseInitialization.set(database, initialization);
  return initialization;
}

function errorResponse(error: unknown): Response {
  return new Response(JSON.stringify(toApiError(error)), {
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    status: apiErrorStatus(error),
  });
}

function withRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Request-Id", requestId);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

/**
 * 🔵 Intent: ルート登録前に設定を検証し、Basic認証と共通エラー処理を全経路へ適用する。
 */
export function createApp(
  env: WorkerEnv,
  config: AppConfig = loadConfig(env),
  providedTrace?: OperationTrace,
  providedRepository?: TenantRepository,
): Hono<AppHonoEnv> {
  const app = new Hono<AppHonoEnv>();

  app.use("*", async (context, next) => {
    const trace = providedTrace ?? createOperationTrace(context.req.raw);
    const repository =
      providedRepository ?? createTenantRepository(env.DB, trace);
    context.set("config", config);
    context.set("trace", trace);
    context.set("auth", createAuthService({ config, repository }));
    try {
      await executeOperation(
        trace,
        {
          component: "worker",
          completedStage: "response.created",
          errorType: "INTERNAL",
          operation: "request.handle",
          startedStage: "route.executing",
        },
        next,
      );
    } finally {
      context.header("X-Request-Id", trace.requestId);
      if (!trace.failure) {
        finalizeOperationTrace(trace, "response.created");
      }
    }
  });

  app.use(
    "*",
    basicAuth({
      password: env.BASIC_AUTH_PASSWORD,
      username: env.BASIC_AUTH_USERNAME,
    }),
  );

  // 認証不要なのはログインだけ。ここへ足すとBasic認証だけで到達できるようになる。
  app.route("/api/auth", createPublicAuthRoutes());

  // sessionGuard() をハンドラより先に登録することで、この配下へ足したAPIは
  // 構成上必ずアプリ内セッションを要求する（NF-2-10・F-1-12）。
  // 今後の業務API（/usage・/ocr/*・/applications/* など）はすべてここへ足す。
  const protectedApi = new Hono<AppHonoEnv>();
  protectedApi.use("*", sessionGuard());
  protectedApi.route("/auth", createProtectedAuthRoutes());
  // app.route はサブアプリのスナップショットを再生するため、搭載は登録の後に行う。
  app.route("/api", protectedApi);

  app.onError((error, context) => {
    const trace = context.get("trace");
    if (error instanceof HTTPException && error.status === 401) {
      finalizeOperationTrace(trace, "request.failed");
      return withRequestId(error.getResponse(), trace.requestId);
    }
    const response = errorResponse(error);
    emitRequestLog(trace, {
      errorCode: toApiError(error).error.code,
      httpMethod: context.req.method,
      httpStatus: response.status,
      routePattern: routePath(context),
    });
    finalizeOperationTrace(trace, "request.failed");
    return withRequestId(response, trace.requestId);
  });

  app.notFound((context) => context.env.ASSETS.fetch(context.req.raw));

  return app;
}

export default {
  async fetch(request, env, executionContext) {
    const trace = createOperationTrace(request);
    try {
      const config = await executeOperation(
        trace,
        {
          component: "worker",
          completedStage: "config.validated",
          errorType: "CONFIG_INVALID",
          operation: "config.load",
          startedStage: "config.validating",
        },
        () => loadConfig(env),
      );
      await executeOperation(
        trace,
        {
          component: "worker",
          completedStage: "tenant.initialized",
          errorType: "CONFIG_INVALID",
          operation: "tenant.initialize",
          startedStage: "tenant.initializing",
        },
        () => initializeDatabase(env.DB, config, trace),
      );
      const response = await createApp(env, config, trace).fetch(
        request,
        env,
        executionContext,
      );
      return withRequestId(response, trace.requestId);
    } catch (error) {
      const response = errorResponse(error);
      emitRequestLog(trace, {
        errorCode: toApiError(error).error.code,
        httpMethod: request.method,
        httpStatus: response.status,
      });
      return withRequestId(response, trace.requestId);
    } finally {
      finalizeOperationTrace(
        trace,
        trace.failure ? "request.failed" : "response.created",
      );
    }
  },
} satisfies ExportedHandler<WorkerEnv>;
