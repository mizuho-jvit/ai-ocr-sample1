import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemberDetailPage } from "../../../src/react-app/pages/member-detail-page";
import type { MemberDetail } from "../../../src/worker/types/contracts";

const STAFF = {
  email: "staff@example.com",
  id: "stf_1" as MemberDetail["applications"][number]["createdBy"]["id"],
  isActive: true,
  name: "窓口 花子",
  role: "staff" as const,
};

function detail(overrides: Partial<MemberDetail> = {}): MemberDetail {
  return {
    address: "仙台市青葉区1-1-1",
    applications: [],
    birthDate: "1980-01-01",
    createdAt: "2026-08-01T00:00:00.000Z",
    email: null,
    id: "member_1" as MemberDetail["id"],
    memberNumber: "1",
    name: "山田太郎",
    nameKana: "ヤマダタロウ",
    phone: "09012345678",
    postalCode: "980-0000",
    status: "active",
    statusHistory: [],
    ...overrides,
  };
}

describe("MemberDetailPage", () => {
  it("renders the member's basic info (F-5-6)", async () => {
    const get = vi.fn().mockResolvedValue(detail());
    render(
      <MemberDetailPage
        api={{ changeStatus: vi.fn(), get, update: vi.fn() }}
        memberId="member_1"
        onBack={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: /山田太郎/ }),
    ).toBeTruthy();
    expect(get).toHaveBeenCalledWith("member_1");
  });

  it("renders application history with a link to view the original image (F-5-6)", async () => {
    const get = vi.fn().mockResolvedValue(
      detail({
        applications: [
          {
            appStatus: "received",
            createdAt: "2026-08-01T09:00:00.000Z",
            createdBy: STAFF,
            docType: "利用者登録申請書",
            hasImage: true,
            id: "app_1" as MemberDetail["applications"][number]["id"],
            member: null,
            triage: null,
          },
        ],
      }),
    );
    const imageUrl = vi
      .fn()
      .mockResolvedValue({ expiresAt: "x", url: "https://r2.example/x" });
    render(
      <MemberDetailPage
        api={{ changeStatus: vi.fn(), get, update: vi.fn() }}
        imageApi={{ imageUrl }}
        memberId="member_1"
        onBack={vi.fn()}
      />,
    );
    await screen.findByText("利用者登録申請書");

    fireEvent.click(screen.getByRole("button", { name: "原本を表示" }));

    expect(
      await screen.findByRole("link", { name: "新しいタブで開く" }),
    ).toBeTruthy();
    expect(imageUrl).toHaveBeenCalledWith("app_1");
  });

  it("re-fetches a fresh signed URL on every click, since the previous one may have expired (コードレビュー指摘)", async () => {
    const get = vi.fn().mockResolvedValue(
      detail({
        applications: [
          {
            appStatus: "received",
            createdAt: "2026-08-01T09:00:00.000Z",
            createdBy: STAFF,
            docType: "利用者登録申請書",
            hasImage: true,
            id: "app_1" as MemberDetail["applications"][number]["id"],
            member: null,
            triage: null,
          },
        ],
      }),
    );
    const imageUrl = vi
      .fn()
      .mockResolvedValueOnce({ expiresAt: "x", url: "https://r2.example/old" })
      .mockResolvedValueOnce({ expiresAt: "y", url: "https://r2.example/new" });
    render(
      <MemberDetailPage
        api={{ changeStatus: vi.fn(), get, update: vi.fn() }}
        imageApi={{ imageUrl }}
        memberId="member_1"
        onBack={vi.fn()}
      />,
    );
    await screen.findByText("利用者登録申請書");

    fireEvent.click(screen.getByRole("button", { name: "原本を表示" }));
    await screen.findByRole("link", { name: "新しいタブで開く" });

    fireEvent.click(screen.getByRole("button", { name: "原本を表示" }));

    await vi.waitFor(() => {
      expect(
        screen.getByRole("link", { name: "新しいタブで開く" }),
      ).toHaveProperty("href", "https://r2.example/new");
    });
    expect(imageUrl).toHaveBeenCalledTimes(2);
  });

  it("saves the edited fields (F-5-1)", async () => {
    const get = vi.fn().mockResolvedValue(detail());
    const update = vi.fn().mockResolvedValue(detail({ name: "山田次郎" }));
    render(
      <MemberDetailPage
        api={{ changeStatus: vi.fn(), get, update }}
        memberId="member_1"
        onBack={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: /山田太郎/ });

    fireEvent.change(screen.getByRole("textbox", { name: "氏名" }), {
      target: { value: "山田次郎" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));

    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledWith("member_1", {
        address: "仙台市青葉区1-1-1",
        birthDate: "1980-01-01",
        email: "",
        name: "山田次郎",
        nameKana: "ヤマダタロウ",
        phone: "09012345678",
        postalCode: "980-0000",
      });
    });
    expect(
      await screen.findByRole("heading", { name: /山田次郎/ }),
    ).toBeTruthy();
  });

  it("sends an empty string (not undefined) when an optional field is cleared, so the server can erase it (コードレビュー指摘)", async () => {
    const get = vi.fn().mockResolvedValue(detail());
    const update = vi.fn().mockResolvedValue(detail({ address: null }));
    render(
      <MemberDetailPage
        api={{ changeStatus: vi.fn(), get, update }}
        memberId="member_1"
        onBack={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: /山田太郎/ });

    fireEvent.change(screen.getByRole("textbox", { name: "住所" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));

    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledWith("member_1", {
        address: "",
        birthDate: "1980-01-01",
        email: "",
        name: "山田太郎",
        nameKana: "ヤマダタロウ",
        phone: "09012345678",
        postalCode: "980-0000",
      });
    });
    expect(
      (screen.getByRole("textbox", { name: "住所" }) as HTMLInputElement).value,
    ).toBe("");
  });

  it("changes the member's status with a reason (F-5-7・F-5-8)", async () => {
    const get = vi.fn().mockResolvedValue(detail());
    const changeStatus = vi
      .fn()
      .mockResolvedValue(detail({ status: "inactive" }));
    render(
      <MemberDetailPage
        api={{ changeStatus, get, update: vi.fn() }}
        memberId="member_1"
        onBack={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: /山田太郎/ });

    fireEvent.change(screen.getByLabelText("変更後の状態"), {
      target: { value: "inactive" },
    });
    fireEvent.change(screen.getByLabelText("状態変更の理由"), {
      target: { value: "退会申し出のため" },
    });
    fireEvent.click(screen.getByRole("button", { name: "変更する" }));

    await vi.waitFor(() => {
      expect(changeStatus).toHaveBeenCalledWith("member_1", {
        reason: "退会申し出のため",
        toStatus: "inactive",
      });
    });
  });

  it("rejects a blank reason on the client before calling the API (F-5-7)", async () => {
    const get = vi.fn().mockResolvedValue(detail());
    const changeStatus = vi.fn();
    render(
      <MemberDetailPage
        api={{ changeStatus, get, update: vi.fn() }}
        memberId="member_1"
        onBack={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: /山田太郎/ });

    fireEvent.click(screen.getByRole("button", { name: "変更する" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(changeStatus).not.toHaveBeenCalled();
  });

  it("shows an error message when the API call fails", async () => {
    const get = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <MemberDetailPage
        api={{ changeStatus: vi.fn(), get, update: vi.fn() }}
        memberId="member_1"
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
