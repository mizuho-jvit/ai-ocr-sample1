import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DemoResetApiError,
  demoResetApi,
} from "../../../src/react-app/api/demo-reset";

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

describe("demoResetApi.preview", () => {
  it("returns the parsed preview response", async () => {
    const preview = {
      applications: 2,
      confirmationWord: "RESET",
      images: 1,
      members: 1,
      snapshotToken: "snapshot-token-abc",
    };
    mockFetch(jsonResponse(preview, 200));

    await expect(demoResetApi.preview()).resolves.toEqual(preview);
  });

  it("throws NOT_FOUND when the feature is disabled", async () => {
    mockFetch(
      jsonResponse(
        { error: { code: "NOT_FOUND", message: "対象が見つかりません。" } },
        404,
      ),
    );

    await expect(demoResetApi.preview()).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});

describe("demoResetApi.reset", () => {
  it("POSTs the confirmation as JSON and returns the result", async () => {
    const result = {
      deleted: { applications: 1, images: 1, members: 1 },
      usageCounterReset: false,
    };
    const fetchMock = mockFetch(jsonResponse(result, 200));

    await expect(
      demoResetApi.reset({
        confirmation: "RESET",
        snapshotToken: "snapshot-token-abc",
      }),
    ).resolves.toEqual(result);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/demo/reset",
      expect.objectContaining({
        body: JSON.stringify({
          confirmation: "RESET",
          snapshotToken: "snapshot-token-abc",
        }),
        method: "POST",
      }),
    );
  });

  it("throws VALIDATION_ERROR for a mismatched confirmation word", async () => {
    mockFetch(
      jsonResponse(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "入力内容を確認してください。",
          },
        },
        422,
      ),
    );

    await expect(
      demoResetApi.reset({
        confirmation: "wrong",
        snapshotToken: "snapshot-token-abc",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  });

  it("throws INVALID_TRANSITION when the snapshot token is stale", async () => {
    mockFetch(
      jsonResponse(
        {
          error: {
            code: "INVALID_TRANSITION",
            message: "現在の状態ではこの操作を実行できません。",
          },
        },
        409,
      ),
    );

    await expect(
      demoResetApi.reset({
        confirmation: "RESET",
        snapshotToken: "stale-token",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION", status: 409 });
  });
});

describe("DemoResetApiError", () => {
  it("is thrown for a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const error = await demoResetApi
      .preview()
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(DemoResetApiError);
    expect((error as DemoResetApiError).code).toBe("INTERNAL");
  });
});
