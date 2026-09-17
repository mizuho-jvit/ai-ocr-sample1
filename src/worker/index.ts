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
import { csrfGuard } from "./middleware/csrf";
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
import { createDemoRoutes } from "./routes/demo";
import { createMemberRoutes } from "./routes/members";
import {
  createApplicationImageRoutes,
  createImageRoutes,
  createOcrRoutes,
} from "./routes/ocr";
import { createStaffRoutes } from "./routes/staff";
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
  createDemoResetService,
  type DemoResetService,
} from "./services/demo-reset";
import {
  createImageStorage,
  type ImageStorage,
} from "./services/image-storage";
import {
  createMemberService,
  type MemberService,
} from "./services/member-service";
import { createOcrPipeline } from "./services/ocr-pipeline";
import {
  createStaffService,
  type StaffService,
} from "./services/staff-service";
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

// クリックジャッキング対策(IPA「安全なウェブサイトの作り方」7.6章)に加え、
// 本アプリが読み込むスクリプト・スタイル・接続先を自己オリジンのみへ制限し、
// <object>/<base>タグの悪用を防ぐ(7.7章 XSSの多層防御)。本番ビルドはインライン
// スクリプトや外部CDNを使用していないため、script-srcへの'unsafe-inline'等の緩和は不要。
// img-src は帳票原本プレビュー用に data: (OCR直後の即時プレビュー)と
// R2署名付きURL(申請詳細画面。image-storage.ts の *.r2.cloudflarestorage.com)を許可する。
// style-src は React の style={{...}} が style 属性としてレンダリングされ、CSPの
// style-src はインラインstyle属性にも適用されるため 'unsafe-inline' が必須(全画面で使用)。
// <style>/style属性の注入はCSS injectionに限られスクリプト実行には至らないため、
// script-src は 'self' のまま緩めない。
//
// isDevOnly(`vite build`では静的にfalseへ畳み込まれ、本番バンドルには現れない)の
// 場合のみ script-src に 'unsafe-inline' を足す。`vite`(pnpm dev)は
// @vitejs/plugin-react のFast Refreshプリアンブルをインラインscriptとしてindex.htmlへ
// 注入するため、これが無いとローカル開発でログイン画面が真っ白になる
// (`pnpm dev:remote`はビルド済み資産を配信するため本来この緩和は不要)。
export function buildContentSecurityPolicy(isDevOnly: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self'${isDevOnly ? " 'unsafe-inline'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://*.r2.cloudflarestorage.com",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

const CONTENT_SECURITY_POLICY = buildContentSecurityPolicy(import.meta.env.DEV);

function setSecurityHeaders(headers: Headers): void {
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  // MIMEスニッフィング対策(IPA「安全なウェブサイトの作り方」7.7章)。
  headers.set("X-Content-Type-Options", "nosniff");
}

function withRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Request-Id", requestId);
  setSecurityHeaders(headers);
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
  providedStaffService?: StaffService,
  providedDemoResetService?: DemoResetService,
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
    const imageStorage =
      providedImageStorage ??
      createImageStorage({
        accessKeyId: env.R2_S3_ACCESS_KEY_ID,
        accountId: config.r2AccountId,
        bucket: env.BUCKET,
        secretAccessKey: env.R2_S3_SECRET_ACCESS_KEY,
      });
    context.set("imageStorage", imageStorage);
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
    context.set(
      "staffService",
      providedStaffService ?? createStaffService({ config, repository }),
    );
    context.set(
      "demoReset",
      providedDemoResetService ??
        createDemoResetService({ config, imageStorage, repository }),
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
      // withRequestId()側にも同じセキュリティヘッダー設定があるが、成功パスは
      // このミドルウェアのcontext.header()を経由するため、ここでも同じ値を付与する。
      context.header("X-Frame-Options", "SAMEORIGIN");
      context.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
      context.header("X-Content-Type-Options", "nosniff");
      if (context.req.path.startsWith("/api/")) {
        // 認証済みAPI・ログアウト応答をブラウザ/中間キャッシュへ残さない
        // (IPA「安全なウェブサイトの作り方」7.4章)。静的アセットには適用しない。
        context.header("Cache-Control", "no-store");
      }
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
  // sessionGuard()より後段に置き、未認証リクエストは従来どおり401を返す
  // (認証チェックの網羅性を検証するテストの前提を変えないため)。
  protectedApi.use("*", csrfGuard());
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
  // api.md #24〜26（スタッフ管理）。adminのみ(F-7-2)はcreateStaffRoutes内のadminGuardで検証する。
  protectedApi.route("/staff", createStaffRoutes());
  // api.md #27〜28（デモデータリセット）。ALLOW_DATA_RESET未設定なら404(F-9-8)は
  // createDemoRoutes内のdemoResetGuardで検証する。
  protectedApi.route("/demo", createDemoRoutes());
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
