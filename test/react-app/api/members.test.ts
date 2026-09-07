import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MembersApiError,
  membersApi,
} from "../../../src/react-app/api/members";

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

describe("membersApi.list", () => {
  it("omits unset filters from the query string", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ items: [], page: 1, perPage: 20, total: 0 }, 200),
    );

    await membersApi.list({});

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/members",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("encodes the given filters and pagination", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ items: [], page: 2, perPage: 10, total: 0 }, 200),
    );

    await membersApi.list({
      birthDate: "1980-01-01",
      page: 2,
      perPage: 10,
      phone: "090-1234-5678",
      q: "山田",
      status: "active",
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const params = new URL(url, "https://example.test").searchParams;
    expect(params.get("q")).toBe("山田");
    expect(params.get("birthDate")).toBe("1980-01-01");
    expect(params.get("phone")).toBe("090-1234-5678");
    expect(params.get("status")).toBe("active");
    expect(params.get("page")).toBe("2");
    expect(params.get("perPage")).toBe("10");
  });
});

describe("membersApi.get", () => {
  it("returns the parsed member on 200", async () => {
    const member = { id: "member-1" };
    mockFetch(jsonResponse(member, 200));

    await expect(membersApi.get("member-1")).resolves.toEqual(member);
  });

  it("throws NOT_FOUND for a missing member", async () => {
    mockFetch(
      jsonResponse(
        { error: { code: "NOT_FOUND", message: "対象が見つかりません。" } },
        404,
      ),
    );

    await expect(membersApi.get("missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});

describe("membersApi.create", () => {
  it("POSTs the input as JSON and returns 201", async () => {
    const fetchMock = mockFetch(jsonResponse({ id: "member-1" }, 201));

    await membersApi.create({
      name: "会員",
      phone: "09000000000",
      status: "pending",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/members",
      expect.objectContaining({
        body: JSON.stringify({
          name: "会員",
          phone: "09000000000",
          status: "pending",
        }),
        method: "POST",
      }),
    );
  });
});

describe("membersApi.update", () => {
  it("PATCHes the partial input as JSON", async () => {
    const fetchMock = mockFetch(jsonResponse({ id: "member-1" }, 200));

    await membersApi.update("member-1", { address: "仙台市青葉区1-1-1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/members/member-1",
      expect.objectContaining({
        body: JSON.stringify({ address: "仙台市青葉区1-1-1" }),
        method: "PATCH",
      }),
    );
  });
});

describe("membersApi.changeStatus", () => {
  it("POSTs toStatus/reason as JSON", async () => {
    const fetchMock = mockFetch(jsonResponse({ id: "member-1" }, 200));

    await membersApi.changeStatus("member-1", {
      reason: "退会申し出のため",
      toStatus: "inactive",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/members/member-1/status",
      expect.objectContaining({
        body: JSON.stringify({
          reason: "退会申し出のため",
          toStatus: "inactive",
        }),
        method: "POST",
      }),
    );
  });
});

describe("membersApi.listMatchCandidates", () => {
  it("returns the parsed candidate list", async () => {
    const candidates = [{ id: "candidate-1" }];
    const fetchMock = mockFetch(jsonResponse(candidates, 200));

    await expect(membersApi.listMatchCandidates()).resolves.toEqual(candidates);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/members/match-candidates",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });
});

describe("MembersApiError", () => {
  it("is thrown for a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const error = await membersApi
      .get("member-1")
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(MembersApiError);
    expect((error as MembersApiError).code).toBe("INTERNAL");
  });
});
