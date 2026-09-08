import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DemoResetApiError } from "../../../src/react-app/api/demo-reset";
import { ResetPage } from "../../../src/react-app/pages/reset-page";
import type {
  ResetPreviewResponse,
  ResetResponse,
} from "../../../src/worker/types/contracts";

const PREVIEW: ResetPreviewResponse = {
  applications: 3,
  confirmationWord: "RESET",
  images: 2,
  members: 1,
  snapshotToken: "snapshot-token-abc",
};

describe("ResetPage (F-9)", () => {
  it("shows the counts to be deleted and the confirmation word (F-9-7)", async () => {
    const preview = vi.fn().mockResolvedValue(PREVIEW);
    render(<ResetPage api={{ preview, reset: vi.fn() }} />);

    expect(await screen.findByText("申請: 3件")).toBeTruthy();
    expect(screen.getByText("原本画像: 2件")).toBeTruthy();
    expect(screen.getByText("会員（シードを除く）: 1件")).toBeTruthy();
    expect(screen.getByText(/「RESET」と入力してください/)).toBeTruthy();
  });

  it("disables the execute button until the confirmation word matches exactly (F-9-7)", async () => {
    const preview = vi.fn().mockResolvedValue(PREVIEW);
    render(<ResetPage api={{ preview, reset: vi.fn() }} />);
    await screen.findByText("申請: 3件");

    const button = screen.getByRole("button", {
      name: "初期化を実行する",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "reset" },
    });
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "RESET" },
    });
    expect(button.disabled).toBe(false);
  });

  it("submits the confirmation, shows the result, and refreshes the preview (F-9-9)", async () => {
    const preview = vi
      .fn()
      .mockResolvedValueOnce(PREVIEW)
      .mockResolvedValueOnce({
        ...PREVIEW,
        applications: 0,
        images: 0,
        members: 0,
      });
    const result: ResetResponse = {
      deleted: { applications: 3, images: 2, members: 1 },
      usageCounterReset: false,
    };
    const reset = vi.fn().mockResolvedValue(result);
    render(<ResetPage api={{ preview, reset }} />);
    await screen.findByText("申請: 3件");

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "RESET" },
    });
    fireEvent.click(screen.getByRole("button", { name: "初期化を実行する" }));

    await vi.waitFor(() => {
      expect(reset).toHaveBeenCalledWith({
        confirmation: "RESET",
        snapshotToken: "snapshot-token-abc",
      });
    });
    expect(await screen.findByText("削除した申請: 3件")).toBeTruthy();
    expect(screen.getByText("削除した原本画像: 2件")).toBeTruthy();
    expect(screen.getByText("削除した会員: 1件")).toBeTruthy();
    await vi.waitFor(() => {
      expect(preview).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(
        screen.getAllByText("当月のAI呼び出し上限は回復しません。").length,
      ).toBe(2);
    });
  });

  it("shows an error message when the confirmation word is rejected by the server", async () => {
    const preview = vi.fn().mockResolvedValue(PREVIEW);
    const reset = vi
      .fn()
      .mockRejectedValue(
        new DemoResetApiError(
          "VALIDATION_ERROR",
          422,
          "入力内容を確認してください。",
        ),
      );
    render(<ResetPage api={{ preview, reset }} />);
    await screen.findByText("申請: 3件");

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "RESET" },
    });
    fireEvent.click(screen.getByRole("button", { name: "初期化を実行する" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("入力内容を確認してください。")).toBeTruthy();
  });

  // コードレビュー指摘・P2・決定#51: preview表示後に対象集合が変わっていた場合、
  // 削除せず最新の件数を再取得して再確認させる。
  it("shows the server's rejection and refreshes to the latest counts when the target set changed since the preview", async () => {
    const preview = vi
      .fn()
      .mockResolvedValueOnce(PREVIEW)
      .mockResolvedValueOnce({
        ...PREVIEW,
        applications: 4,
        snapshotToken: "snapshot-token-new",
      });
    const reset = vi
      .fn()
      .mockRejectedValue(
        new DemoResetApiError(
          "INVALID_TRANSITION",
          409,
          "現在の状態ではこの操作を実行できません。",
        ),
      );
    render(<ResetPage api={{ preview, reset }} />);
    await screen.findByText("申請: 3件");

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "RESET" },
    });
    fireEvent.click(screen.getByRole("button", { name: "初期化を実行する" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen.getByText("現在の状態ではこの操作を実行できません。"),
    ).toBeTruthy();
    await vi.waitFor(() => {
      expect(screen.getByText("申請: 4件")).toBeTruthy();
    });
    expect(preview).toHaveBeenCalledTimes(2);
  });
});
