import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthApiError } from "../../../src/react-app/api/auth";
import { LoginPage } from "../../../src/react-app/pages/login-page";
import type { StaffUserSummary } from "../../../src/worker/types/contracts";

const USER: StaffUserSummary = {
  email: "staff@example.com",
  id: "stf_staff" as StaffUserSummary["id"],
  isActive: true,
  name: "担当者",
  role: "staff",
};

function submitCredentials(email = "staff@example.com", password = "demo1234") {
  fireEvent.change(screen.getByLabelText("メールアドレス"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText("パスワード"), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: "ログイン" }));
}

describe("LoginPage", () => {
  it("sends the entered credentials and notifies the parent on success", async () => {
    const login = vi.fn().mockResolvedValue({ user: USER });
    const onAuthenticated = vi.fn();

    render(<LoginPage api={{ login }} onAuthenticated={onAuthenticated} />);
    submitCredentials();

    await vi.waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalledTimes(1);
    });
    expect(login).toHaveBeenCalledWith({
      email: "staff@example.com",
      password: "demo1234",
    });
  });

  // F-1-7: 文言はAPI側で統一されているため、画面は受け取った文言をそのまま出す。
  it("shows the API message and stays on the form when the credentials are rejected", async () => {
    const login = vi
      .fn()
      .mockRejectedValue(
        new AuthApiError(
          "INVALID_CREDENTIALS",
          401,
          "メールまたはパスワードが違います。",
        ),
      );
    const onAuthenticated = vi.fn();

    render(<LoginPage api={{ login }} onAuthenticated={onAuthenticated} />);
    submitCredentials("staff@example.com", "wrong");

    expect(
      await screen.findByText("メールまたはパスワードが違います。"),
    ).toBeTruthy();
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "ログイン" })).toBeTruthy();
  });

  it("disables the submit button while the request is in flight", async () => {
    const login = vi.fn(() => new Promise<never>(() => {}));

    render(<LoginPage api={{ login }} onAuthenticated={vi.fn()} />);
    submitCredentials();

    await vi.waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: "ログイン" })
          .hasAttribute("disabled"),
      ).toBe(true);
    });
    expect(login).toHaveBeenCalledTimes(1);
  });

  // 画面一覧: 「テナントコード入力欄は設けない」
  it("does not render a tenant code field", () => {
    render(<LoginPage api={{ login: vi.fn() }} onAuthenticated={vi.fn()} />);

    expect(screen.queryByLabelText(/テナント/)).toBeNull();
  });
});
