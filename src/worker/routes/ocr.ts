import { Hono } from "hono";

import { whereFieldEquals } from "../db/repositories";
import { currentTenantId } from "../db/tenant-context";
import { type AppHonoEnv, requireSession } from "../middleware/auth";
import {
  ApiErrorException,
  type ApplicationDetail,
  type ApplicationField,
  type ExtractedApplication,
  type OcrExtractRequest,
  type OcrExtractResponse,
  type PreparedImage,
  toApplicationId,
} from "../types";

/** F-2-2・contracts.ts の PreparedImage と一致させる、受理する画像形式。 */
const ALLOWED_MIME_TYPES = new Set<PreparedImage["mimeType"]>([
  "image/jpeg",
  "image/png",
]);

/** 15分固定(NF-2-14)。リクエスト単位・画面単位で上書きする手段は設けない(NF-2-38と同じ扱い)。 */
const SIGNED_URL_EXPIRES_IN_SECONDS = 900;

function validationError(): ApiErrorException {
  return new ApiErrorException("VALIDATION_ERROR");
}

/**
 * 🔵 Intent: 本文の不備を500ではなく422にする(auth.tsのparseLoginRequestと同じ方針)。
 * 未対応形式はここで弾き、Usage加算・AI呼び出しの前に止める。
 */
function parseOcrExtractRequest(body: unknown): OcrExtractRequest {
  if (typeof body !== "object" || body === null) {
    throw validationError();
  }
  const { image } = body as Record<string, unknown>;
  if (typeof image !== "object" || image === null) {
    throw validationError();
  }
  const { base64, mimeType } = image as Record<string, unknown>;
  if (typeof base64 !== "string" || base64.length === 0) {
    throw validationError();
  }
  if (
    typeof mimeType !== "string" ||
    !ALLOWED_MIME_TYPES.has(mimeType as PreparedImage["mimeType"])
  ) {
    throw validationError();
  }
  return { image: { base64, mimeType: mimeType as PreparedImage["mimeType"] } };
}

/** F-2-5: AI出力の値をそのまま保存する。編集は別APIの専管とし、ここではedited=falseで初期化する。 */
function toApplicationFields(
  extracted: ExtractedApplication,
): ApplicationField[] {
  return extracted.fields.map((field) => ({ ...field, edited: false }));
}

/**
 * 🔵 Intent: F-2-8・F-2-9に従い、読取完了と同時に受付状態のApplicationを保存する。
 * 画像はR2への保存に成功した後にのみDBへ書き込み(データフロー図の順序)、
 * 途中で失敗した場合は未完成のApplication行を作らない。
 */
export function createOcrRoutes(): Hono<AppHonoEnv> {
  const routes = new Hono<AppHonoEnv>();

  routes.post("/extract", async (context) => {
    const actor = await requireSession(context);
    const config = context.get("config");
    const trace = context.get("trace");

    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      throw validationError();
    }
    const { image } = parseOcrExtractRequest(rawBody);

    // NF-2-39: Usage加算はAI呼び出しの前。加算後に失敗しても枠は戻さない(fail closed)。
    // NF-2-17・NF-2-34: 読取(Pass①)もGemini呼び出し回数の合算対象。ocrPages・geminiCalls
    // の両方を、AIを呼ぶ前に加算する(片方でも上限到達なら以降を実行しない)。
    const startedAt = performance.now();
    await context.get("usage").consumeOcr();
    const usage = await context.get("usage").consumeGemini();
    const extracted = await context.get("ocrPipeline").extract(image);

    const tenantId = currentTenantId(config);
    const applicationId = toApplicationId(crypto.randomUUID());
    const imageKey = await context
      .get("imageStorage")
      .put(tenantId, applicationId, image, trace);

    const now = new Date().toISOString();
    // 🔴 Intent: processingSecの計測範囲は前工程に指定がない。Usage加算〜R2保存直前までの
    // AI・ストレージ待機時間を対象とし、進捗表示(F-2-10)の目安値として使う想定。
    const processingSec = (performance.now() - startedAt) / 1_000;
    const fields = toApplicationFields(extracted);

    const repositories = context.get("repository").forTenant(tenantId);
    await repositories.applications.insert({
      appStatus: "received",
      createdAt: now,
      createdById: actor.user.id,
      docType: extracted.docType,
      editedCount: 0,
      fieldsJson: JSON.stringify(fields),
      id: applicationId,
      imageKey,
      latestCheckRunId: null,
      memberId: null,
      processingSec,
      updatedAt: now,
      updatedById: null,
    });

    const application: ApplicationDetail = {
      appStatus: "received",
      createdAt: now,
      createdBy: actor.user,
      docType: extracted.docType,
      editedCount: 0,
      fields,
      hasImage: true,
      id: applicationId,
      latestCheckRun: null,
      matchCandidates: [],
      member: null,
      processingSec,
      statusHistory: [],
      triage: null,
      updatedBy: null,
    };

    return context.json<OcrExtractResponse>({ application, usage });
  });

  return routes;
}

/**
 * 🔵 Intent: 原本画像の一時配信(NF-2-14・判断記録 #18)。`GET /api/images/:applicationId`。
 * 直接URLでは配信せず、都度発行する署名付きURLだけを返す。
 */
export function createImageRoutes(): Hono<AppHonoEnv> {
  const routes = new Hono<AppHonoEnv>();

  routes.get("/:applicationId", async (context) => {
    await requireSession(context);
    const tenantId = currentTenantId(context.get("config"));
    const applicationId = toApplicationId(context.req.param("applicationId"));

    const application = await context
      .get("repository")
      .forTenant(tenantId)
      .applications.findOne(
        whereFieldEquals("applications", "id", applicationId),
      );
    if (!application?.imageKey) {
      throw new ApiErrorException("NOT_FOUND");
    }

    const signed = await context
      .get("imageStorage")
      .createSignedUrl(
        tenantId,
        application.imageKey,
        SIGNED_URL_EXPIRES_IN_SECONDS,
        context.get("trace"),
      );
    return context.json(signed);
  });

  return routes;
}

/**
 * 🔵 Intent: `DELETE /api/applications/:id/image`（NF-3-2）。この1エンドポイントだけを
 * ここへ置き、Task 010で`/api/applications`配下の残りのCRUDを追加する際に統合する。
 */
export function createApplicationImageRoutes(): Hono<AppHonoEnv> {
  const routes = new Hono<AppHonoEnv>();

  routes.delete("/:id/image", async (context) => {
    await requireSession(context);
    const tenantId = currentTenantId(context.get("config"));
    const applicationId = toApplicationId(context.req.param("id"));

    const repositories = context.get("repository").forTenant(tenantId);
    const application = await repositories.applications.findOne(
      whereFieldEquals("applications", "id", applicationId),
    );
    if (!application?.imageKey) {
      throw new ApiErrorException("NOT_FOUND");
    }

    await context
      .get("imageStorage")
      .delete(application.imageKey, context.get("trace"));
    await repositories.applications.update(
      { imageKey: null },
      whereFieldEquals("applications", "id", applicationId),
    );

    return context.body(null, 204);
  });

  return routes;
}
