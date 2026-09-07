import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StaffPage } from "../../../src/react-app/pages/staff-page";
import type { StaffUserSummary } from "../../../src/worker/types/contracts";

const STAFF: StaffUserSummary = {
  email: "staff@example.test",
  id: "staff_1" as StaffUserSummary["id"],
  isActive: true,
  name: "窓口 花子",
  role: "staff",
};

describe("StaffPage", () => {
  it("renders the fetched staff accounts (F-7-1)", async () => {
    const list = vi.fn().mockResolvedValue([STAFF]);
    render(<StaffPage api={{ create: vi.fn(), list, update: vi.fn() }} />);

    expect(await screen.findByText("窓口 花子")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "担当者" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "有効" })).toBeTruthy();
  });

  it("creates a staff account via the inline form and reloads the list (F-7-1)", async () => {
    const list = vi.fn().mockResolvedValue([STAFF]);
    const create = vi.fn().mockResolvedValue({ ...STAFF, id: "staff_2" });
    render(<StaffPage api={{ create, list, update: vi.fn() }} />);
    await screen.findByText("窓口 花子");

    fireEvent.click(screen.getByRole("button", { name: "新規登録" }));
    fireEvent.change(screen.getByRole("textbox", { name: "氏名" }), {
      target: { value: "新人 職員" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "メール" }), {
      target: { value: "new@example.test" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登録する" }));

    await vi.waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        email: "new@example.test",
        name: "新人 職員",
        password: "correct horse battery staple",
        role: "staff",
      });
    });
    await vi.waitFor(() => {
      expect(list).toHaveBeenCalledTimes(2);
    });
  });

  it("edits a staff account inline and sends only the changed intent (F-7-1)", async () => {
    const list = vi.fn().mockResolvedValue([STAFF]);
    const update = vi.fn().mockResolvedValue({ ...STAFF, isActive: false });
    render(<StaffPage api={{ create: vi.fn(), list, update }} />);
    await screen.findByText("窓口 花子");

    fireEvent.click(screen.getByRole("button", { name: "編集" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));

    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledWith("staff_1", {
        isActive: false,
        name: "窓口 花子",
        password: undefined,
        role: "staff",
      });
    });
    await vi.waitFor(() => {
      expect(list).toHaveBeenCalledTimes(2);
    });
  });

  it("omits the password from the update when left blank (F-7-1)", async () => {
    const list = vi.fn().mockResolvedValue([STAFF]);
    const update = vi.fn().mockResolvedValue(STAFF);
    render(<StaffPage api={{ create: vi.fn(), list, update }} />);
    await screen.findByText("窓口 花子");

    fireEvent.click(screen.getByRole("button", { name: "編集" }));
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));

    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledWith(
        "staff_1",
        expect.objectContaining({ password: undefined }),
      );
    });
  });

  it("cancels an in-progress edit without calling update", async () => {
    const list = vi.fn().mockResolvedValue([STAFF]);
    const update = vi.fn();
    render(<StaffPage api={{ create: vi.fn(), list, update }} />);
    await screen.findByText("窓口 花子");

    fireEvent.click(screen.getByRole("button", { name: "編集" }));
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(screen.getByRole("button", { name: "編集" })).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it("shows an error message when the API call fails", async () => {
    const list = vi.fn().mockRejectedValue(new Error("boom"));
    render(<StaffPage api={{ create: vi.fn(), list, update: vi.fn() }} />);

    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
