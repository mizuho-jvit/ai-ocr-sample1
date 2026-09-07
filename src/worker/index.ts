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
import { createApplicationRoutes } from "./routes/applications";
import {
  createProtectedAuthRoutes,
  createPublicAuthRoutes,
} from "./routes/auth";
import { createCheckRoutes } from "./routes/checks";
import { createMemberRoutes } from "./routes/members";
import {
  createApplicationImageRoutes,
  createImageRoutes,
  createOcrRoutes,
} from "./routes/ocr";
import { createUsageRoutes } from "./routes/usage";
import {
  type ApplicationService,
  createApplicationService,
} from "./services/application-service";
import { createAuthService } from "./services/auth";
import {
  type BusinessCheckService,
  createBusinessCheckService,
} from "./services/business-check";
import {
  createImageStorage,
  type ImageStorage,
} from "./services/image-storage";
import {
  createMemberService,
  type MemberService,
} from "./services/member-service";
import { createOcrPipeline } from "./services/ocr-pipeline";
import { createUsageService } from "./services/usage";
import {
  type AppConfig,
  apiErrorStatus,
  type OcrPipeline,
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
  providedOcrPipeline?: OcrPipeline,
  providedImageStorage?: ImageStorage,
  providedBusinessCheck?: BusinessCheckService,
  providedApplicationService?: ApplicationService,
  providedMemberService?: MemberService,
): Hono<AppHonoEnv> {
  const app = new Hono<AppHonoEnv>();

  app.use("*", async (context, next) => {
    const trace = providedTrace ?? createOperationTrace(context.req.raw);
    const repository =
      providedRepository ?? createTenantRepository(env.DB, trace);
    const usage = createUsageService({ config, database: env.DB, trace });
    context.set("config", config);
    context.set("trace", trace);
    context.set("repository", repository);
    context.set("auth", createAuthService({ config, repository }));
    context.set("usage", usage);
    context.set(
      "ocrPipeline",
      providedOcrPipeline ??
        createOcrPipeline({ apiKey: env.GEMINI_API_KEY, config, trace }),
    );
    context.set(
      "imageStorage",
      providedImageStorage ??
        createImageStorage({
          accessKeyId: env.R2_S3_ACCESS_KEY_ID,
          accountId: config.r2AccountId,
          bucket: env.BUCKET,
          secretAccessKey: env.R2_S3_SECRET_ACCESS_KEY,
        }),
    );
    context.set(
      "businessCheck",
      providedBusinessCheck ??
        createBusinessCheckService({
          apiKey: env.GEMINI_API_KEY,
          config,
          repository,
          trace,
          usage,
        }),
    );
    context.set(
      "applicationService",
      providedApplicationService ??
        createApplicationService({ config, repository }),
    );
    context.set(
      "memberService",
      providedMemberService ?? createMemberService({ config, repository }),
    );
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
  protectedApi.route("/usage", createUsageRoutes());
  protectedApi.route("/ocr", createOcrRoutes());
  protectedApi.route("/checks", createCheckRoutes());
  protectedApi.route("/images", createImageRoutes());
  // api.md #7〜13（一覧・詳細・項目編集・状態遷移・CheckRun履歴・名寄せ判断）と、
  // Task 007由来の #15（DELETE .../image）を同じ `/applications` prefixへ併せて登録する。
  // どちらも `/:id` 配下の具体パスのみで、export.csv（Task 013・#8）のような
  // `/:id` と衝突する静的パスは無いため登録順序に依存しない。
  protectedApi.route("/applications", createApplicationRoutes());
  protectedApi.route("/applications", createApplicationImageRoutes());
  // api.md #16・#19〜23（会員管理・重複疑いリスト）。`/match-candidates`を`/:id`より
  // 先に登録する順序はcreateMemberRoutes側で担保済み。
  protectedApi.route("/members", createMemberRoutes());
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
