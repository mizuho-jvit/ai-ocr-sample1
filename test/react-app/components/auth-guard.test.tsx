import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type AuthApi, AuthApiError } from "../../../src/react-app/api/auth";
import { AuthGuard } from "../../../src/react-app/components/auth-guard";
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

const CHILD_TEXT = "認証済みコンテンツ";

function createApi(overrides: Partial<AuthApi>): AuthApi {
  return {
    login: vi.fn(),
    logout: vi.fn(),
    session: vi.fn(),
    ...overrides,
  };
}

function renderGuard(api: AuthApi) {
  return render(
    <AuthGuard api={api}>
      <p>{CHILD_TEXT}</p>
    </AuthGuard>,
  );
}

describe("AuthGuard", () => {
  it("does not render children while the session is being resolved", () => {
    const api = createApi({
      session: vi.fn(() => new Promise<SessionResponse>(() => {})),
    });

    renderGuard(api);

    expect(screen.queryByText(CHILD_TEXT)).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("renders children when a session already exists", async () => {
    const api = createApi({ session: vi.fn().mockResolvedValue(SESSION) });

    renderGuard(api);

    expect(await screen.findByText(CHILD_TEXT)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "ログイン" })).toBeNull();
  });

  it("shows the login screen when the session API reports UNAUTHENTICATED", async () => {
    const api = createApi({
      session: vi
        .fn()
        .mockRejectedValue(
          new AuthApiError("UNAUTHENTICATED", 401, "ログインが必要です。"),
        ),
    });

    renderGuard(api);

    expect(
      await screen.findByRole("heading", { name: "ログイン" }),
    ).toBeTruthy();
    expect(screen.queryByText(CHILD_TEXT)).toBeNull();
  });

  it("renders children after a successful login", async () => {
    const api = createApi({
      login: vi.fn().mockResolvedValue({ user: USER }),
      session: vi
        .fn()
        .mockRejectedValueOnce(
          new AuthApiError("UNAUTHENTICATED", 401, "ログインが必要です。"),
        )
        .mockResolvedValueOnce(SESSION),
    });

    renderGuard(api);

    fireEvent.change(await screen.findByLabelText("メールアドレス"), {
      target: { value: "staff@example.com" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "demo1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ログイン" }));

    expect(await screen.findByText(CHILD_TEXT)).toBeTruthy();
    expect(api.login).toHaveBeenCalledWith({
      email: "staff@example.com",
      password: "demo1234",
    });
  });

  // 500をUNAUTHENTICATEDと同じ扱いにすると、バックエンド障害がログイン画面の
  // 無限ループに化ける。障害はログイン画面ではなく再試行可能なエラーとして出す。
  it("shows a retryable error instead of the login screen when the session API fails", async () => {
    const api = createApi({
      session: vi
        .fn()
        .mockRejectedValue(
          new AuthApiError("INTERNAL", 500, "予期しないエラーが発生しました。"),
        ),
    });

    renderGuard(api);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "ログイン" })).toBeNull();
    expect(screen.queryByText(CHILD_TEXT)).toBeNull();
    expect(screen.getByRole("button", { name: "再試行" })).toBeTruthy();
  });
});
