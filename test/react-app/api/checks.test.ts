import { afterEach, describe, expect, it, vi } from "vitest";
import { ChecksApiError, checksApi } from "../../../src/react-app/api/checks";

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

describe("checksApi.run", () => {
  it("posts the applicationId and returns the parsed response on 200", async () => {
    const body = {
      application: { id: "app-1" },
      checkRun: { id: "check-1" },
      matchCandidates: [],
      remainingRuns: 4,
      usage: { geminiCallsRemaining: 700 },
    };
    const fetchMock = mockFetch(jsonResponse(body, 200));

    await expect(checksApi.run({ applicationId: "app-1" })).resolves.toEqual(
      body,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/checks/run",
      expect.objectContaining({
        body: JSON.stringify({ applicationId: "app-1" }),
        credentials: "same-origin",
        method: "POST",
      }),
    );
  });

  it("throws CHECK_RUN_LIMIT (409) with the server message", async () => {
    mockFetch(
      jsonResponse(
        {
          error: {
            code: "CHECK_RUN_LIMIT",
            message: "業務チェックの実施回数が上限に達しました。",
          },
        },
        409,
      ),
    );

    await expect(
      checksApi.run({ applicationId: "app-1" }),
    ).rejects.toMatchObject({
      code: "CHECK_RUN_LIMIT",
      message: "業務チェックの実施回数が上限に達しました。",
      retryable: false,
      status: 409,
    });
  });

  it("throws USAGE_LIMIT_EXCEEDED (429) with the server message", async () => {
    mockFetch(
      jsonResponse(
        {
          error: {
            code: "USAGE_LIMIT_EXCEEDED",
            message:
              "今月の利用上限に達しました。翌月まで待つか、上限値を引き上げて再デプロイする必要があります。",
          },
        },
        429,
      ),
    );

    await expect(
      checksApi.run({ applicationId: "app-1" }),
    ).rejects.toMatchObject({
      code: "USAGE_LIMIT_EXCEEDED",
      retryable: false,
      status: 429,
    });
  });

  it("marks AI_UNAVAILABLE (503) as retryable", async () => {
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

    await expect(
      checksApi.run({ applicationId: "app-1" }),
    ).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      retryable: true,
      status: 503,
    });
  });

  it("throws INTERNAL with an offline message when fetch itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await expect(
      checksApi.run({ applicationId: "app-1" }),
    ).rejects.toMatchObject({ code: "INTERNAL", status: 0 });
  });

  it("falls back to a generic message when the error body is unparseable", async () => {
    mockFetch(new Response("not json", { status: 500 }));

    const error = await checksApi
      .run({ applicationId: "app-1" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ChecksApiError);
    expect((error as ChecksApiError).code).toBe("INTERNAL");
  });
});
