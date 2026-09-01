import { describe, expect, it, vi } from "vitest";

import { createOcrPipeline } from "../../../src/worker/services/ocr-pipeline";
import {
  ApiErrorException,
  type PreparedImage,
} from "../../../src/worker/types";

const IMAGE: PreparedImage = {
  base64: "ZmFrZS1pbWFnZS1ieXRlcw==",
  mimeType: "image/jpeg",
};

const PIPELINE_CONFIG = {
  aiGatewayAccountId: "test-account",
  aiGatewayId: "test-gateway",
  geminiModel: "gemini-3.1-flash-lite",
  ocrPipelineMode: "gemini" as const,
};

function geminiResponse(body: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }],
    }),
    { status: 200 },
  );
}

function createPipeline(requestFetch: typeof fetch) {
  return createOcrPipeline({
    apiKey: "test-gemini-api-key",
    config: PIPELINE_CONFIG,
    requestFetch,
  });
}

describe("createOcrPipeline (NF-4-5・AI-1・AI-3・AI-8b)", () => {
  it("rejects an OCR pipeline mode that this task does not implement", () => {
    expect(() =>
      createOcrPipeline({
        apiKey: "test-gemini-api-key",
        config: { ...PIPELINE_CONFIG, ocrPipelineMode: "document-ai-gemini" },
      }),
    ).toThrowError("document-ai-gemini");
  });

  it("builds a gemini pipeline without throwing", () => {
    expect(() => createPipeline(vi.fn())).not.toThrow();
  });
});

describe("GeminiPipeline.extract — request shape (AI-1・AI-5・AI-6・AI-7a)", () => {
  it("calls the AI Gateway endpoint with the gateway account/id, model, and payload-log-disable header", async () => {
    const requestFetch = vi.fn(async () =>
      geminiResponse({
        docType: "利用者登録申請書",
        fields: [{ confidence: 0.98, label: "氏名", value: "山田太郎" }],
      }),
    );
    const pipeline = createPipeline(requestFetch as unknown as typeof fetch);

    await pipeline.extract(IMAGE);

    expect(requestFetch).toHaveBeenCalledOnce();
    const [url, init] = requestFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/google-ai-studio/v1/models/gemini-3.1-flash-lite:generateContent",
    );
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-gemini-api-key");
    expect(headers["cf-aig-collect-log-payload"]).toBe("false");

    const body = JSON.parse(init.body as string);
    expect(body.contents[0].parts).toContainEqual({
      inlineData: { data: IMAGE.base64, mimeType: IMAGE.mimeType },
    });
    expect(body.generationConfig.maxOutputTokens).toBe(4_000);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("passes through a blank field value as an empty string (F-2-5)", async () => {
    const requestFetch = vi.fn(async () =>
      geminiResponse({
        docType: "利用者登録申請書",
        fields: [{ confidence: 0.4, label: "電話番号", value: "" }],
      }),
    );
    const pipeline = createPipeline(requestFetch as unknown as typeof fetch);

    const result = await pipeline.extract(IMAGE);

    expect(result.fields).toEqual([
      { confidence: 0.4, label: "電話番号", value: "" },
    ]);
  });
});

describe("GeminiPipeline.extract — output validation (F-2-6)", () => {
  async function expectAiUnavailable(requestFetch: typeof fetch) {
    const pipeline = createPipeline(requestFetch);
    await expect(pipeline.extract(IMAGE)).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
    await expect(pipeline.extract(IMAGE)).rejects.toBeInstanceOf(
      ApiErrorException,
    );
  }

  it("rejects a response missing docType", async () => {
    await expectAiUnavailable(
      vi.fn(async () =>
        geminiResponse({
          fields: [{ confidence: 0.9, label: "氏名", value: "x" }],
        }),
      ) as unknown as typeof fetch,
    );
  });

  it("rejects a response with an empty fields array", async () => {
    await expectAiUnavailable(
      vi.fn(async () =>
        geminiResponse({ docType: "利用者登録申請書", fields: [] }),
      ) as unknown as typeof fetch,
    );
  });

  it.each([-0.1, 1.1])(
    "rejects a field confidence of %s outside the 0-1 range",
    async (confidence) => {
      await expectAiUnavailable(
        vi.fn(async () =>
          geminiResponse({
            docType: "利用者登録申請書",
            fields: [{ confidence, label: "氏名", value: "x" }],
          }),
        ) as unknown as typeof fetch,
      );
    },
  );

  it("rejects a field missing a label", async () => {
    await expectAiUnavailable(
      vi.fn(async () =>
        geminiResponse({
          docType: "利用者登録申請書",
          fields: [{ confidence: 0.9, value: "x" }],
        }),
      ) as unknown as typeof fetch,
    );
  });
});

describe("GeminiPipeline.extract — transport failures (AI-7b)", () => {
  it("rejects with a retryable AI_UNAVAILABLE when the network call throws", async () => {
    const requestFetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const pipeline = createPipeline(requestFetch as unknown as typeof fetch);

    await expect(pipeline.extract(IMAGE)).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
  });

  it("rejects with AI_UNAVAILABLE when the gateway returns a non-2xx status", async () => {
    const requestFetch = vi.fn(
      async () => new Response("upstream error", { status: 503 }),
    );
    const pipeline = createPipeline(requestFetch as unknown as typeof fetch);

    await expect(pipeline.extract(IMAGE)).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
  });

  it("rejects with AI_UNAVAILABLE when the response body has no candidates", async () => {
    const requestFetch = vi.fn(
      async () => new Response(JSON.stringify({}), { status: 200 }),
    );
    const pipeline = createPipeline(requestFetch as unknown as typeof fetch);

    await expect(pipeline.extract(IMAGE)).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
  });
});
