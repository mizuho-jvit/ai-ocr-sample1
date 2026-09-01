import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeResizedDimensions,
  JPEG_QUALITY,
  MAX_LONG_EDGE_PX,
  OcrApiError,
  ocrApi,
} from "../../../src/react-app/api/ocr";
import type {
  ApplicationDetail,
  UsageResponse,
} from "../../../src/worker/types/contracts";

const APPLICATION = {
  appStatus: "received",
  createdAt: "2026-09-01T00:00:00Z",
  createdBy: {
    email: "staff@example.com",
    id: "stf_1",
    isActive: true,
    name: "担当者",
    role: "staff",
  },
  docType: "利用者登録申請書",
  editedCount: 0,
  fields: [],
  hasImage: true,
  id: "app_1",
  latestCheckRun: null,
  matchCandidates: [],
  member: null,
  processingSec: 1.2,
  statusHistory: [],
  triage: null,
  updatedBy: null,
} as unknown as ApplicationDetail;

const USAGE = {
  geminiCalls: 1,
  geminiCallsLimit: 720,
  ocrPages: 1,
  ocrPagesLimit: 120,
  ocrPagesRemaining: 119,
  period: "2026-09",
} as unknown as UsageResponse;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function mockFetch(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ocrApi.extract", () => {
  it("posts the prepared image and returns the parsed response", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ application: APPLICATION, usage: USAGE }, 200),
    );

    const image = { base64: "abc", mimeType: "image/jpeg" as const };
    await expect(ocrApi.extract({ image })).resolves.toEqual({
      application: APPLICATION,
      usage: USAGE,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ocr/extract",
      expect.objectContaining({
        body: JSON.stringify({ image }),
        method: "POST",
      }),
    );
  });

  it("throws USAGE_LIMIT_EXCEEDED for a 429 response", async () => {
    mockFetch(
      jsonResponse(
        {
          error: {
            code: "USAGE_LIMIT_EXCEEDED",
            message: "今月の利用上限に達しました。",
          },
        },
        429,
      ),
    );

    await expect(
      ocrApi.extract({ image: { base64: "abc", mimeType: "image/jpeg" } }),
    ).rejects.toMatchObject({
      code: "USAGE_LIMIT_EXCEEDED",
      status: 429,
    });
  });

  it("surfaces retryable on a 503 AI_UNAVAILABLE response", async () => {
    mockFetch(
      jsonResponse(
        {
          error: {
            code: "AI_UNAVAILABLE",
            message:
              "AIサービスを利用できません。時間をおいて再試行してください。",
            retryable: true,
          },
        },
        503,
      ),
    );

    const error = await ocrApi
      .extract({ image: { base64: "abc", mimeType: "image/jpeg" } })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(OcrApiError);
    expect((error as OcrApiError).retryable).toBe(true);
  });

  it("reports an offline error when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const error = await ocrApi
      .extract({ image: { base64: "abc", mimeType: "image/jpeg" } })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(OcrApiError);
    expect((error as OcrApiError).code).toBe("INTERNAL");
  });
});

describe("computeResizedDimensions (F-2-2)", () => {
  it("scales the long edge down to 1568px, preserving aspect ratio", () => {
    expect(computeResizedDimensions(3136, 2352)).toEqual({
      height: 1176,
      width: 1568,
    });
  });

  it("does not upscale an image whose long edge is already within the limit", () => {
    expect(computeResizedDimensions(800, 600)).toEqual({
      height: 600,
      width: 800,
    });
  });

  it("exposes the target long edge and JPEG quality as constants", () => {
    expect(MAX_LONG_EDGE_PX).toBe(1568);
    expect(JPEG_QUALITY).toBe(0.85);
  });
});
