import { describe, expect, it, vi } from "vitest";

import { createImageStorage } from "../../../src/worker/services/image-storage";
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
