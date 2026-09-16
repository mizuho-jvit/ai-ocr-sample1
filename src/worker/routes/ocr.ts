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

/**
 * 🔴 Intent: セッションを保持する攻撃者・改造クライアントが、クライアント側リサイズ
 * (長辺1568px・JPEG品質0.85・`react-app/api/ocr.ts`)を経由せず任意のbase64を直接送る
 * 経路への防御。ユーザー確認済みの上限値(2MB・長辺2000px)。サーバー側では画像デコード・
 * リサイズは行わない(CPU時間10ms/リクエスト制約により画像処理はクライアント専任・
 * docs/dev/context.md)ため、マジックナンバーとヘッダー内の寸法フィールドだけを読む
 * 軽量な検証に限定する。
 */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_LONG_EDGE_PX = 2000;
const MAX_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

/** 4文字単位・末尾パディング(0/1/2個の`=`)のみを許可する厳格なBase64形式チェック。 */
const STRICT_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;

const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** JPEGのSOFxマーカー(DHT/JPG/DACを除く0xC0-0xCF)。SOSより前に必ず1つ現れ、高さ・幅を持つ。 */
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
/** マーカーを無制限に走査しないための上限(通常のJPEGはSOF出現までごく少数)。 */
const JPEG_MAX_MARKERS_SCANNED = 64;

function validationError(): ApiErrorException {
  return new ApiErrorException("VALIDATION_ERROR");
}

function matchesMagicNumber(
  bytes: Uint8Array,
  magic: readonly number[],
): boolean {
  if (bytes.length < magic.length) {
    return false;
  }
  return magic.every((byte, index) => bytes[index] === byte);
}

function decodeBase64Image(base64: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw validationError();
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

/** PNG: 8バイト署名の直後に必ずIHDRチャンクが続き、幅・高さは16-19・20-23バイト目(Big Endian)。 */
function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { height: view.getUint32(20), width: view.getUint32(16) };
}

/** JPEG: SOIの直後からマーカーを順に走査し、最初のSOFxセグメントから高さ・幅を読む。 */
function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2;
  for (
    let scanned = 0;
    scanned < JPEG_MAX_MARKERS_SCANNED && offset + 4 <= bytes.length;
    scanned += 1
  ) {
    if (bytes[offset] !== 0xff) {
      return null;
    }
    const marker = bytes[offset + 1];
    // スタンドアロンマーカー(付随データを持たない)は長さフィールドを持たない。
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      return null; // EOI・SOSに達した = SOFが見つからなかった
    }
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) {
      return null;
    }
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) {
        return null;
      }
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
      };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function readImageDimensions(
  mimeType: PreparedImage["mimeType"],
  bytes: Uint8Array,
): ImageDimensions | null {
  return mimeType === "image/png"
    ? readPngDimensions(bytes)
    : readJpegDimensions(bytes);
}

/**
 * 🔴 Intent: サイズ・Base64形式・マジックナンバー・寸法上限の4点をAI Gateway・R2へ渡す前に
 * 検証する(IPA診断・OCR入力検証不足の指摘対応)。いずれかに違反すれば422で拒否する。
 */
function validateImageBytes(
  base64: string,
  mimeType: PreparedImage["mimeType"],
): void {
  if (
    base64.length > MAX_BASE64_LENGTH ||
    !STRICT_BASE64_PATTERN.test(base64)
  ) {
    throw validationError();
  }
  const bytes = decodeBase64Image(base64);
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw validationError();
  }
  const magic = mimeType === "image/png" ? PNG_MAGIC : JPEG_MAGIC;
  if (!matchesMagicNumber(bytes, magic)) {
    throw validationError();
  }
  const dimensions = readImageDimensions(mimeType, bytes);
  if (
    dimensions === null ||
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    Math.max(dimensions.width, dimensions.height) > MAX_IMAGE_LONG_EDGE_PX
  ) {
    throw validationError();
  }
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
  const preparedMimeType = mimeType as PreparedImage["mimeType"];
  validateImageBytes(base64, preparedMimeType);
  return { image: { base64, mimeType: preparedMimeType } };
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
