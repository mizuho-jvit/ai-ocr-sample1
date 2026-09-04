import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApplicationsApiError,
  applicationsApi,
} from "../../../src/react-app/api/applications";

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

describe("applicationsApi.list", () => {
  it("omits unset filters from the query string", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ items: [], page: 1, perPage: 20, total: 0 }, 200),
    );

    await applicationsApi.list({});

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/applications",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("encodes the given filters and pagination", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ items: [], page: 2, perPage: 10, total: 0 }, 200),
    );

    await applicationsApi.list({
      appStatus: "under_review",
      linked: true,
      needsReviewOnly: true,
      page: 2,
      perPage: 10,
      triage: "needs_review",
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const params = new URL(url, "https://example.test").searchParams;
    expect(params.get("appStatus")).toBe("under_review");
    expect(params.get("triage")).toBe("needs_review");
    expect(params.get("linked")).toBe("true");
    expect(params.get("needsReviewOnly")).toBe("true");
    expect(params.get("page")).toBe("2");
    expect(params.get("perPage")).toBe("10");
  });
});

describe("applicationsApi.get", () => {
  it("returns the parsed application on 200", async () => {
    const application = { id: "app-1" };
    mockFetch(jsonResponse(application, 200));

    await expect(applicationsApi.get("app-1")).resolves.toEqual(application);
  });

  it("throws NOT_FOUND for a missing application", async () => {
    mockFetch(
      jsonResponse(
        { error: { code: "NOT_FOUND", message: "対象が見つかりません。" } },
        404,
      ),
    );

    await expect(applicationsApi.get("missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});

describe("applicationsApi.updateFields", () => {
  it("PATCHes the fields as JSON", async () => {
    const fetchMock = mockFetch(jsonResponse({ id: "app-1" }, 200));

    await applicationsApi.updateFields("app-1", {
      fields: [{ label: "氏名", value: "山田太郎" }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/applications/app-1/fields",
      expect.objectContaining({
        body: JSON.stringify({
          fields: [{ label: "氏名", value: "山田太郎" }],
        }),
        method: "PATCH",
      }),
    );
  });
});

describe("applicationsApi.changeStatus", () => {
  it("POSTs toStatus as JSON", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ application: { id: "app-1" }, promotedMember: null }, 200),
    );

    await applicationsApi.changeStatus("app-1", { toStatus: "under_review" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/applications/app-1/status",
      expect.objectContaining({
        body: JSON.stringify({ toStatus: "under_review" }),
        method: "POST",
      }),
    );
  });
});

describe("applicationsApi.decideMatch", () => {
  it("PATCHes the decision as JSON", async () => {
    const fetchMock = mockFetch(
      jsonResponse(
        { application: { id: "app-1" }, candidate: { id: "cand-1" } },
        200,
      ),
    );

    await applicationsApi.decideMatch("app-1", "cand-1", {
      decision: "merged",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/applications/app-1/match-candidates/cand-1",
      expect.objectContaining({
        body: JSON.stringify({ decision: "merged" }),
        method: "PATCH",
      }),
    );
  });
});

describe("applicationsApi.listCheckRuns", () => {
  it("returns the parsed history", async () => {
    const history = [{ id: "check-run-1" }];
    mockFetch(jsonResponse(history, 200));

    await expect(applicationsApi.listCheckRuns("app-1")).resolves.toEqual(
      history,
    );
  });
});

describe("applicationsApi.imageUrl", () => {
  it("returns the signed URL", async () => {
    const signed = {
      expiresAt: "2026-01-01T00:15:00.000Z",
      url: "https://r2.example/x",
    };
    const fetchMock = mockFetch(jsonResponse(signed, 200));

    await expect(applicationsApi.imageUrl("app-1")).resolves.toEqual(signed);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/images/app-1",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });
});

describe("ApplicationsApiError", () => {
  it("is thrown for a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const error = await applicationsApi
      .get("app-1")
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApplicationsApiError);
    expect((error as ApplicationsApiError).code).toBe("INTERNAL");
  });
});
