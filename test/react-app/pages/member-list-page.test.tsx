import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemberListPage } from "../../../src/react-app/pages/member-list-page";
import type {
  MemberListResponse,
  MemberSummary,
} from "../../../src/worker/types/contracts";

const ITEM: MemberSummary = {
  birthDate: "1980-01-01",
  id: "member_1" as MemberSummary["id"],
  memberNumber: "1",
  name: "山田太郎",
  nameKana: "ヤマダタロウ",
  phone: "09012345678",
  status: "active",
};

function listResponse(
  overrides: Partial<MemberListResponse> = {},
): MemberListResponse {
  return { items: [ITEM], page: 1, perPage: 20, total: 1, ...overrides };
}

describe("MemberListPage", () => {
  it("renders the fetched items (F-5-1)", async () => {
    const list = vi.fn().mockResolvedValue(listResponse());
    render(
      <MemberListPage
        api={{ create: vi.fn(), list }}
        onSelectMember={vi.fn()}
      />,
    );

    expect(await screen.findByText("山田太郎")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "利用資格あり" })).toBeTruthy();
    expect(list).toHaveBeenCalledWith({ page: 1 });
  });

  it("passes q through to the API (F-5-4)", async () => {
    const list = vi.fn().mockResolvedValue(listResponse());
    render(
      <MemberListPage
        api={{ create: vi.fn(), list }}
        onSelectMember={vi.fn()}
      />,
    );
    await screen.findByText("山田太郎");

    fireEvent.change(screen.getByLabelText("氏名・カナで検索"), {
      target: { value: "山田" },
    });

    await vi.waitFor(() => {
      expect(list).toHaveBeenLastCalledWith({ page: 1, q: "山田" });
    });
  });

  it("passes the status filter through to the API (F-5-4)", async () => {
    const list = vi.fn().mockResolvedValue(listResponse());
    render(
      <MemberListPage
        api={{ create: vi.fn(), list }}
        onSelectMember={vi.fn()}
      />,
    );
    await screen.findByText("山田太郎");

    fireEvent.change(screen.getByLabelText("状態で絞り込み"), {
      target: { value: "suspended" },
    });

    await vi.waitFor(() => {
      expect(list).toHaveBeenLastCalledWith({ page: 1, status: "suspended" });
    });
  });

  it("does not let a slower, stale search response overwrite a newer one (コードレビュー指摘)", async () => {
    let resolveFirst: (value: MemberListResponse) => void = () => {};
    let resolveSecond: (value: MemberListResponse) => void = () => {};
    const list = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<MemberListResponse>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<MemberListResponse>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    render(
      <MemberListPage
        api={{ create: vi.fn(), list }}
        onSelectMember={vi.fn()}
      />,
    );
    await vi.waitFor(() => {
      expect(list).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByLabelText("氏名・カナで検索"), {
      target: { value: "鈴木" },
    });
    await vi.waitFor(() => {
      expect(list).toHaveBeenCalledTimes(2);
    });

    // 新しい検索(鈴木)の応答を先に返す。
    resolveSecond(listResponse({ items: [{ ...ITEM, name: "鈴木花子" }] }));
    expect(await screen.findByText("鈴木花子")).toBeTruthy();

    // 古い検索(初期表示・条件なし)の応答が遅れて返っても、最新の結果を上書きしない。
    resolveFirst(listResponse());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByText("鈴木花子")).toBeTruthy();
    expect(screen.queryByText("山田太郎")).toBeNull();
  });

  it("calls onSelectMember with the row's id", async () => {
    const list = vi.fn().mockResolvedValue(listResponse());
    const onSelectMember = vi.fn();
    render(
      <MemberListPage
        api={{ create: vi.fn(), list }}
        onSelectMember={onSelectMember}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "詳細" }));

    expect(onSelectMember).toHaveBeenCalledWith("member_1");
  });

  it("creates a member via the inline form and reloads the list (F-5-1)", async () => {
    const list = vi.fn().mockResolvedValue(listResponse());
    const create = vi.fn().mockResolvedValue({ id: "member_2" });
    render(<MemberListPage api={{ create, list }} onSelectMember={vi.fn()} />);
    await screen.findByText("山田太郎");

    fireEvent.click(screen.getByRole("button", { name: "新規登録" }));
    fireEvent.change(screen.getByRole("textbox", { name: "氏名" }), {
      target: { value: "佐藤花子" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "電話番号" }), {
      target: { value: "08000000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登録する" }));

    await vi.waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        address: undefined,
        birthDate: undefined,
        email: undefined,
        name: "佐藤花子",
        nameKana: undefined,
        phone: "08000000000",
        postalCode: undefined,
        status: "pending",
      });
    });
    await vi.waitFor(() => {
      expect(list).toHaveBeenCalledTimes(2);
    });
  });

  it("shows an error message when the API call fails", async () => {
    const list = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <MemberListPage
        api={{ create: vi.fn(), list }}
        onSelectMember={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
