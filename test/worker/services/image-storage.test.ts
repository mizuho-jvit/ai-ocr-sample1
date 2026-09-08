import { describe, expect, it, vi } from "vitest";

import {
  createImageStorage,
  PartialImageDeleteError,
} from "../../../src/worker/services/image-storage";
import {
  ApiErrorException,
  toApplicationId,
  toImageKey,
  toTenantId,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-a");
const APPLICATION_ID = toApplicationId("app-1");
const FIXED_NOW = new Date("2026-09-01T00:00:00.000Z");

function createBucket() {
  return {
    delete: vi.fn(async () => undefined),
    list: vi.fn(),
    put: vi.fn(async () => undefined),
  } as unknown as R2Bucket;
}

function createStorage(bucket: R2Bucket) {
  return createImageStorage({
    accessKeyId: "test-r2-access-key",
    accountId: "test-r2-account",
    bucket,
    clock: () => FIXED_NOW,
    secretAccessKey: "test-r2-secret-key",
  });
}

describe("createImageStorage.put (F-2-9・NF-5-21)", () => {
  it("writes the image to R2 under {tenantId}/{applicationId}.jpg for JPEG", async () => {
    const bucket = createBucket();
    const storage = createStorage(bucket);

    const key = await storage.put(TENANT_ID, APPLICATION_ID, {
      base64: "ZmFrZS1pbWFnZS1ieXRlcw==",
      mimeType: "image/jpeg",
    });

    expect(key).toBe("tenant-a/app-1.jpg");
    expect(bucket.put).toHaveBeenCalledOnce();
    const [putKey, , putOptions] = (bucket.put as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, Uint8Array, R2PutOptions];
    expect(putKey).toBe("tenant-a/app-1.jpg");
    expect(putOptions.httpMetadata).toEqual({ contentType: "image/jpeg" });
  });

  it("uses the .png extension for PNG images", async () => {
    const bucket = createBucket();
    const storage = createStorage(bucket);

    const key = await storage.put(TENANT_ID, APPLICATION_ID, {
      base64: "ZmFrZS1pbWFnZS1ieXRlcw==",
      mimeType: "image/png",
    });

    expect(key).toBe("tenant-a/app-1.png");
  });
});

describe("createImageStorage.delete (NF-3-2)", () => {
  it("deletes the object at the given key", async () => {
    const bucket = createBucket();
    const storage = createStorage(bucket);

    await storage.delete(toImageKey("tenant-a/app-1.jpg"));

    expect(bucket.delete).toHaveBeenCalledWith("tenant-a/app-1.jpg");
  });
});

describe("createImageStorage.deleteMany (F-9-11・F-9-12・決定#50)", () => {
  it("deletes exactly the given keys in a single call when within the batch limit", async () => {
    const bucket = createBucket();
    const storage = createStorage(bucket);
    const keys = [
      toImageKey("tenant-a/app-1.jpg"),
      toImageKey("tenant-a/app-2.png"),
    ];

    const deletedCount = await storage.deleteMany(keys);

    expect(bucket.delete).toHaveBeenCalledOnce();
    expect(bucket.delete).toHaveBeenCalledWith([
      "tenant-a/app-1.jpg",
      "tenant-a/app-2.png",
    ]);
    expect(deletedCount).toBe(2);
    // 決定#50: prefixの事後列挙(list)は使わない。
    expect(bucket.list).not.toHaveBeenCalled();
  });

  it("splits more than 1000 keys into multiple delete calls", async () => {
    const bucket = createBucket();
    const storage = createStorage(bucket);
    const keys = Array.from({ length: 1500 }, (_, index) =>
      toImageKey(`tenant-a/app-${index}.jpg`),
    );

    const deletedCount = await storage.deleteMany(keys);

    expect(bucket.delete).toHaveBeenCalledTimes(2);
    expect(
      (bucket.delete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    ).toHaveLength(1000);
    expect(
      (bucket.delete as ReturnType<typeof vi.fn>).mock.calls[1]?.[0],
    ).toHaveLength(500);
    expect(deletedCount).toBe(1500);
  });

  it("does nothing for an empty key list", async () => {
    const bucket = createBucket();
    const storage = createStorage(bucket);

    const deletedCount = await storage.deleteMany([]);

    expect(bucket.delete).not.toHaveBeenCalled();
    expect(deletedCount).toBe(0);
  });

  // コードレビュー指摘・P2・決定#52: 複数バッチの途中で失敗した場合、そこまでに
  // 確定した件数を呼び出し側が監査ログへ残せるよう、失敗にその件数を持たせる。
  it("throws PartialImageDeleteError carrying the count deleted before a mid-batch failure", async () => {
    const keys = Array.from({ length: 1500 }, (_, index) =>
      toImageKey(`tenant-a/app-${index}.jpg`),
    );
    const bucketError = new Error("R2 unavailable");
    const bucket = {
      delete: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(bucketError),
      list: vi.fn(),
      put: vi.fn(async () => undefined),
    } as unknown as R2Bucket;
    const storage = createStorage(bucket);

    const error = await storage
      .deleteMany(keys)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PartialImageDeleteError);
    expect((error as PartialImageDeleteError).deletedCount).toBe(1000);
    expect((error as PartialImageDeleteError).cause).toBe(bucketError);
    expect(bucket.delete).toHaveBeenCalledTimes(2);
  });

  it("reports zero deleted when the very first batch fails", async () => {
    const bucketError = new Error("R2 unavailable");
    const bucket = {
      delete: vi.fn().mockRejectedValue(bucketError),
      list: vi.fn(),
      put: vi.fn(async () => undefined),
    } as unknown as R2Bucket;
    const storage = createStorage(bucket);

    const error = await storage
      .deleteMany([toImageKey("tenant-a/app-1.jpg")])
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PartialImageDeleteError);
    expect((error as PartialImageDeleteError).deletedCount).toBe(0);
  });
});

describe("createImageStorage.createSignedUrl (NF-2-14・判断記録 #18)", () => {
  it("returns an S3-compatible presigned GET URL that expires in 900 seconds", async () => {
    const storage = createStorage(createBucket());

    const signed = await storage.createSignedUrl(
      TENANT_ID,
      toImageKey("tenant-a/app-1.jpg"),
      900,
    );

    expect(signed.url).toMatch(
      /^https:\/\/test-r2-account\.r2\.cloudflarestorage\.com\/ai-ocr-sample1-images\/tenant-a\/app-1\.jpg\?/,
    );
    expect(signed.url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(signed.url).toContain("X-Amz-Expires=900");
    expect(signed.url).toContain("X-Amz-SignedHeaders=host");
    expect(signed.url).toContain("X-Amz-Credential=test-r2-access-key%2F");
    expect(signed.url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
    expect(signed.expiresAt).toBe("2026-09-01T00:15:00.000Z");
  });

  it("never places the secret access key in the URL", async () => {
    const storage = createStorage(createBucket());

    const signed = await storage.createSignedUrl(
      TENANT_ID,
      toImageKey("tenant-a/app-1.jpg"),
      900,
    );

    expect(signed.url).not.toContain("test-r2-secret-key");
  });

  it("rejects an image key that does not belong to the requesting tenant (NF-5-19)", async () => {
    const storage = createStorage(createBucket());

    await expect(
      storage.createSignedUrl(TENANT_ID, toImageKey("tenant-b/app-9.jpg"), 900),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      storage.createSignedUrl(TENANT_ID, toImageKey("tenant-b/app-9.jpg"), 900),
    ).rejects.toBeInstanceOf(ApiErrorException);
  });
});
