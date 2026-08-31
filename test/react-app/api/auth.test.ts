import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, authApi } from "../../../src/react-app/api/auth";
import type {
  SessionResponse,
  StaffUserSummary,
} from "../../../src/worker/types/contracts";

const USER: StaffUserSummary = {
  email: "staff@example.com",
  id: "stf_staff" as StaffUserSummary["id"],
  isActive: true,
  name: "担当者",
  role: "staff",
};

const SESSION: SessionResponse = {
  features: { dataReset: false },
  user: USER,
};

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

describe("authApi.session", () => {
  it("returns the parsed session on 200", async () => {
    const fetchMock = mockFetch(jsonResponse(SESSION, 200));

    await expect(authApi.session()).resolves.toEqual(SESSION);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/session",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("throws UNAUTHENTICATED when the API reports a missing session", async () => {
    mockFetch(
      jsonResponse(
        { error: { code: "UNAUTHENTICATED", message: "ログインが必要です。" } },
        401,
      ),
    );

    await expect(authApi.session()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
    });
  });

  // Basic認証のチャレンジ応答はJSONではない。statusだけで未認証と判定すると
  // ログイン画面へ誘導され、Cookieを得られないまま再試行を繰り返す。
  it("does not report UNAUTHENTICATED for a non-JSON 401", async () => {
    mockFetch(
      new Response("Unauthorized", {
        headers: { "WWW-Authenticate": 'Basic realm="Secure Area"' },
        status: 401,
      }),
    );

    const error = await authApi.session().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AuthApiError);
    expect((error as AuthApiError).code).toBe("INTERNAL");
  });
});

describe("authApi.login", () => {
  it("posts the credentials as JSON", async () => {
    const fetchMock = mockFetch(jsonResponse({ user: USER }, 200));

    await expect(
      authApi.login({ email: "staff@example.com", password: "demo1234" }),
    ).resolves.toEqual({ user: USER });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        body: JSON.stringify({
          email: "staff@example.com",
          password: "demo1234",
        }),
        method: "POST",
      }),
    );
  });

  it("surfaces the API message for invalid credentials", async () => {
    mockFetch(
      jsonResponse(
        {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "メールまたはパスワードが違います。",
          },
        },
        401,
      ),
    );

    await expect(
      authApi.login({ email: "staff@example.com", password: "wrong" }),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "メールまたはパスワードが違います。",
    });
  });
});

describe("authApi.logout", () => {
  it("resolves on 204 without parsing a body", async () => {
    mockFetch(new Response(null, { status: 204 }));

    await expect(authApi.logout()).resolves.toBeUndefined();
  });
});
