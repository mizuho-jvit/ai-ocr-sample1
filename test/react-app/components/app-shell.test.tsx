import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// 注記の文面の正典。テスト専用の突合であり、SPAのバンドルには入らない
// （`seed.test.ts` が README.md を突き合わせているのと同じ方式）。
import screenList from "../../../knowledge/wiki/screens/screen-list.md?raw";
import { type AuthApi, AuthApiError } from "../../../src/react-app/api/auth";
import {
  AppNav,
  AppShell,
  LOGOUT_FAILED_MESSAGE,
  MANDATORY_NOTICES,
} from "../../../src/react-app/components/app-shell";
import { AuthGuard } from "../../../src/react-app/components/auth-guard";
import type {
  SessionResponse,
  StaffUserSummary,
} from "../../../src/worker/types/contracts";

const ADMIN_ONLY_LABELS = ["スタッフ管理", "デモデータ初期化"];

function user(role: StaffUserSummary["role"]): StaffUserSummary {
  return {
    email: `${role}@example.com`,
    id: `stf_${role}` as StaffUserSummary["id"],
    isActive: true,
    name: role === "admin" ? "管理者" : "担当者",
    role,
  };
}

function session(
  role: StaffUserSummary["role"],
  dataReset: boolean,
): SessionResponse {
  return { features: { dataReset }, user: user(role) };
}

function renderShell(value: SessionResponse, overrides: Partial<AuthApi> = {}) {
  const api: AuthApi = {
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    session: vi.fn().mockResolvedValue(value),
    ...overrides,
  };

  render(
    <AuthGuard api={api}>
      <AppShell />
    </AuthGuard>,
  );

  return api;
}

describe("AppNav", () => {
  // F-9-8: 出し分けは表示上の配慮であり、APIのロール認可を代替しない。
  it("hides the admin-only entries from staff", () => {
    render(<AppNav session={session("staff", true)} />);

    for (const label of ADMIN_ONLY_LABELS) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
    expect(screen.getByRole("button", { name: "ホーム" })).toBeTruthy();
  });

  it("shows the admin-only entries to admin", () => {
    render(<AppNav session={session("admin", true)} />);

    for (const label of ADMIN_ONLY_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  // 画面一覧: ALLOW_DATA_RESET 未設定時はメニューに表示しない。
  it("hides the data reset entry when the feature is disabled", () => {
    render(<AppNav session={session("admin", false)} />);

    expect(screen.getByRole("button", { name: "スタッフ管理" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "デモデータ初期化" }),
    ).toBeNull();
  });
});

describe("AppShell", () => {
  it("shows the signed-in staff member", async () => {
    renderShell(session("staff", false));

    expect(await screen.findByText(/担当者/)).toBeTruthy();
  });

  // 画面一覧: 営業戦略に直結するため機能追加・改修時も失わない注記。
  it("always renders the mandatory notices verbatim", async () => {
    renderShell(session("staff", false));

    expect(await screen.findByText(MANDATORY_NOTICES[0])).toBeTruthy();
    for (const notice of MANDATORY_NOTICES.slice(1)) {
      expect(screen.getByText(notice)).toBeTruthy();
    }
  });

  // 上のテストは描画元と同じ定数を期待値に使うため、定数そのものが正典から
  // 離れても検出できない。正典の本文と直接突き合わせて言い換えを禁止する。
  it("keeps the notice wording identical to the canonical screen list", () => {
    for (const notice of MANDATORY_NOTICES) {
      expect(screenList).toContain(notice);
    }
  });

  it("returns to the login screen after logging out", async () => {
    const api = renderShell(session("staff", false));

    fireEvent.click(await screen.findByRole("button", { name: "ログアウト" }));

    expect(
      await screen.findByRole("heading", { name: "ログイン" }),
    ).toBeTruthy();
    expect(api.logout).toHaveBeenCalledTimes(1);
  });

  // 失敗時に未認証へ遷移させると、サーバー側セッションが残っているのに
  // 画面はログアウト済みという取り違えが起きる。認証済みのまま留まること。
  it("stays signed in and reports the failure when logout fails", async () => {
    renderShell(session("staff", false), {
      logout: vi
        .fn()
        .mockRejectedValue(
          new AuthApiError("INTERNAL", 500, "予期しないエラーが発生しました。"),
        ),
    });

    fireEvent.click(await screen.findByRole("button", { name: "ログアウト" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(LOGOUT_FAILED_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "ログイン" })).toBeNull();
    expect(
      screen.getByRole("navigation", { name: "メインメニュー" }),
    ).toBeTruthy();
  });

  it("logs out on a retry after a failed attempt", async () => {
    const logout = vi
      .fn()
      .mockRejectedValueOnce(new AuthApiError("INTERNAL", 500, "失敗"))
      .mockResolvedValueOnce(undefined);
    renderShell(session("staff", false), { logout });

    fireEvent.click(await screen.findByRole("button", { name: "ログアウト" }));
    fireEvent.click(await screen.findByRole("button", { name: "再試行" }));

    expect(
      await screen.findByRole("heading", { name: "ログイン" }),
    ).toBeTruthy();
    expect(logout).toHaveBeenCalledTimes(2);
  });

  // Task 010: ルーターは導入しないが、ホーム・申請状況一覧はナビメニューから
  // 切り替え表示できる（他の項目はまだ画面が無いためdisabledのまま）。
  it("switches the main screen between home and the application list via the nav menu", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ items: [], page: 1, perPage: 20, total: 0 }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        ),
      ),
    );
    try {
      renderShell(session("staff", false));
      await screen.findByText(/担当者/);
      expect(screen.getByText("帳票の画像を選択")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "申請状況一覧" }));

      expect(
        await screen.findByRole("heading", { name: "申請状況一覧" }),
      ).toBeTruthy();
      expect(screen.queryByText("帳票の画像を選択")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "ホーム" }));

      expect(await screen.findByText("帳票の画像を選択")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // Task 011: 会員一覧・検索と重複疑いリストは画面が揃ったためナビメニューから遷移できる。
  it("switches the main screen to the member list and the duplicates list via the nav menu", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        const body = url.includes("/api/members/match-candidates")
          ? []
          : { items: [], page: 1, perPage: 20, total: 0 };
        return new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }),
    );
    try {
      renderShell(session("staff", false));
      await screen.findByText(/担当者/);

      fireEvent.click(screen.getByRole("button", { name: "会員一覧・検索" }));
      expect(
        await screen.findByRole("heading", { name: "会員一覧・検索" }),
      ).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "重複疑いリスト" }));
      expect(
        await screen.findByRole("heading", { name: "重複疑いリスト" }),
      ).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
