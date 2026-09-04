import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LetterDraftEditor } from "../../../src/react-app/components/letter-draft-editor";

const DRAFT =
  "【宛名】様\n\nご提出いただいた申請書に不備がございました。\n\n【差出人】";

describe("LetterDraftEditor (F-3-5・決定#34)", () => {
  it("shows the AI draft in an editable textarea with the not-saved notice", () => {
    render(<LetterDraftEditor draft={DRAFT} writeClipboard={vi.fn()} />);

    const textarea = screen.getByLabelText(
      "差戻し文面案",
    ) as HTMLTextAreaElement;
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea.value).toBe(DRAFT);
    expect(screen.getByText(/編集内容は保存されません/)).toBeTruthy();
  });

  it("copies the edited text (not the original draft) to the clipboard and reports success", async () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    render(<LetterDraftEditor draft={DRAFT} writeClipboard={writeClipboard} />);

    fireEvent.change(screen.getByLabelText("差戻し文面案"), {
      target: { value: "山田様\n\n修正後の文面です。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "コピー" }));

    expect(writeClipboard).toHaveBeenCalledWith("山田様\n\n修正後の文面です。");
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      expect.stringContaining("コピーしました"),
    );
  });

  it("asks for manual copy when the clipboard write fails", async () => {
    const writeClipboard = vi
      .fn()
      .mockRejectedValue(new Error("clipboard unavailable"));
    render(<LetterDraftEditor draft={DRAFT} writeClipboard={writeClipboard} />);

    fireEvent.click(screen.getByRole("button", { name: "コピー" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("コピーできませんでした"),
    );
    // 失敗しても編集中の文面はそのまま残る
    expect(
      (screen.getByLabelText("差戻し文面案") as HTMLTextAreaElement).value,
    ).toBe(DRAFT);
  });

  it("fails explicitly (no fallback) when navigator.clipboard is unavailable and no writer is injected", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    try {
      render(<LetterDraftEditor draft={DRAFT} />);
      fireEvent.click(screen.getByRole("button", { name: "コピー" }));
      expect(await screen.findByRole("alert")).toBeTruthy();
    } finally {
      if (original) {
        Object.defineProperty(navigator, "clipboard", original);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
  });
});
