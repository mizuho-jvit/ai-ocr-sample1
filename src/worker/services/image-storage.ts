import {
  executeOperation,
  type OperationTrace,
} from "../observability/operation-trace";
import {
  ApiErrorException,
  type ApplicationId,
  type ImageKey,
  type PreparedImage,
  type TenantId,
  toImageKey,
} from "../types";

export interface SignedImageUrl {
  readonly url: string;
  readonly expiresAt: string;
}

export interface ImageStorage {
  put(
    tenantId: TenantId,
    applicationId: ApplicationId,
    image: PreparedImage,
    trace?: OperationTrace,
  ): Promise<ImageKey>;
  delete(imageKey: ImageKey, trace?: OperationTrace): Promise<void>;
  createSignedUrl(
    tenantId: TenantId,
    imageKey: ImageKey,
    expiresInSeconds: number,
    trace?: OperationTrace,
  ): Promise<SignedImageUrl>;
}

export interface ImageStorageOptions {
  readonly bucket: R2Bucket;
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly clock?: () => Date;
}

/**
 * 🔴 Intent: `wrangler.toml` の `[[r2_buckets]] bucket_name` はWorkerの `env` から
 * 読めないため、署名URL生成用に定数として持つ(ユーザー判断。R2_BUCKET_NAME環境変数は追加しない)。
 * バケット名を変更する場合は両方を同時に書き換える必要がある。
 */
const R2_BUCKET_NAME = "ai-ocr-sample1-images";

const R2_SIGNING_REGION = "auto";
const R2_SIGNING_SERVICE = "s3";

const EXTENSION_BY_MIME_TYPE: Record<PreparedImage["mimeType"], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

const textEncoder = new TextEncoder();

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(
  key: BufferSource,
  message: string,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, textEncoder.encode(message));
}

async function sha256Hex(message: string): Promise<string> {
  return toHex(
    await crypto.subtle.digest("SHA-256", textEncoder.encode(message)),
  );
}

/** AWS SigV4の鍵導出チェーン（AWS4 + secret → date → region → service → aws4_request）。 */
async function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(
    textEncoder.encode(`AWS4${secretAccessKey}`),
    dateStamp,
  );
  const kRegion = await hmacSha256(kDate, R2_SIGNING_REGION);
  const kService = await hmacSha256(kRegion, R2_SIGNING_SERVICE);
  return hmacSha256(kService, "aws4_request");
}

/** RFC 3986準拠のパーセントエンコード。`encodeURIComponent` が素通りする記号も個別に置換する。 */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalUriFor(bucket: string, key: string): string {
  return `/${[bucket, ...key.split("/")].map(uriEncode).join("/")}`;
}

function formatAmzDate(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = `${now.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * 🟡 Intent: R2のS3互換APIに対しAWS Signature Version 4でGET用の署名付きURLを都度発行する
 * (判断記録 #18)。npmパッケージを追加できない実行環境のため、WebCryptoで手組みする。
 * ライブラリを使わない実装のため、AWSの公式アルゴリズム仕様に基づき自前で検証が必要。
 */
async function buildSignedUrl(options: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  key: ImageKey;
  expiresInSeconds: number;
  now: Date;
}): Promise<string> {
  const host = `${options.accountId}.r2.cloudflarestorage.com`;
  const { amzDate, dateStamp } = formatAmzDate(options.now);
  const credentialScope = `${dateStamp}/${R2_SIGNING_REGION}/${R2_SIGNING_SERVICE}/aws4_request`;
  const canonicalUri = canonicalUriFor(R2_BUCKET_NAME, options.key);

  const queryParams: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${options.accessKeyId}/${credentialScope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(options.expiresInSeconds)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  queryParams.sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const canonicalQueryString = queryParams
    .map(([name, value]) => `${uriEncode(name)}=${uriEncode(value)}`)
    .join("&");

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQueryString,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await deriveSigningKey(options.secretAccessKey, dateStamp);
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

const R2_OPERATION_BASE = {
  completedStage: "repository.completed",
  component: "r2",
  errorType: "R2_OPERATION_FAILED",
  startedStage: "repository.executing",
} as const;

/**
 * 🔵 Intent: 原本画像の保存・削除・一時配信をここへ閉じ込める(F-2-9・NF-3-2・NF-2-14・判断記録 #18)。
 * 配信は都度発行する署名付きURL経由のみとし、直接URLやR2の生ハンドルを呼び出し側へ渡さない。
 */
export function createImageStorage(options: ImageStorageOptions): ImageStorage {
  const clock = options.clock ?? (() => new Date());

  return Object.freeze({
    async put(tenantId, applicationId, image, trace) {
      const key = toImageKey(
        `${tenantId}/${applicationId}.${EXTENSION_BY_MIME_TYPE[image.mimeType]}`,
      );
      await executeOperation(
        trace,
        { ...R2_OPERATION_BASE, operation: "image.put" },
        () =>
          options.bucket.put(key, base64ToBytes(image.base64), {
            httpMetadata: { contentType: image.mimeType },
          }),
      );
      return key;
    },

    async delete(imageKey, trace) {
      await executeOperation(
        trace,
        { ...R2_OPERATION_BASE, operation: "image.delete" },
        () => options.bucket.delete(imageKey),
      );
    },

    /**
     * 🔵 Intent: 発行前に`{tenantId}/`プレフィックスを検証し、他テナントのオブジェクトへは
     * 署名を発行しない(NF-5-19)。存在の開示を防ぐため403ではなく404とする(NF-5-16と同じ扱い)。
     */
    async createSignedUrl(tenantId, imageKey, expiresInSeconds) {
      if (!imageKey.startsWith(`${tenantId}/`)) {
        throw new ApiErrorException("NOT_FOUND");
      }
      const now = clock();
      const url = await buildSignedUrl({
        accessKeyId: options.accessKeyId,
        accountId: options.accountId,
        expiresInSeconds,
        key: imageKey,
        now,
        secretAccessKey: options.secretAccessKey,
      });
      return {
        expiresAt: new Date(
          now.getTime() + expiresInSeconds * 1_000,
        ).toISOString(),
        url,
      };
    },
  } satisfies ImageStorage);
}
