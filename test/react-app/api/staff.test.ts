import { afterEach, describe, expect, it, vi } from "vitest";
import { StaffApiError, staffApi } from "../../../src/react-app/api/staff";

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

describe("staffApi.list", () => {
  it("returns the parsed staff summaries", async () => {
    const staff = [{ id: "staff-1" }];
    mockFetch(jsonResponse(staff, 200));

    await expect(staffApi.list()).resolves.toEqual(staff);
  });

  it("throws FORBIDDEN for a staff-role caller", async () => {
    mockFetch(
      jsonResponse(
        { error: { code: "FORBIDDEN", message: "権限がありません。" } },
        403,
      ),
    );

    await expect(staffApi.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });
});

describe("staffApi.create", () => {
  it("POSTs the input as JSON and returns 201", async () => {
    const fetchMock = mockFetch(jsonResponse({ id: "staff-1" }, 201));

    await staffApi.create({
      email: "new@example.test",
      name: "新人",
      password: "correct horse battery staple",
      role: "staff",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/staff",
      expect.objectContaining({
        body: JSON.stringify({
          email: "new@example.test",
          name: "新人",
          password: "correct horse battery staple",
          role: "staff",
        }),
        method: "POST",
      }),
    );
  });
});

describe("staffApi.update", () => {
  it("PATCHes the partial input as JSON", async () => {
    const fetchMock = mockFetch(jsonResponse({ id: "staff-1" }, 200));

    await staffApi.update("staff-1", { isActive: false });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/staff/staff-1",
      expect.objectContaining({
        body: JSON.stringify({ isActive: false }),
        method: "PATCH",
      }),
    );
  });
});

describe("StaffApiError", () => {
  it("is thrown for a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const error = await staffApi.list().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(StaffApiError);
    expect((error as StaffApiError).code).toBe("INTERNAL");
  });
});
