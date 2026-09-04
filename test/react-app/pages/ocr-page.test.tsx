import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApplicationsApiError } from "../../../src/react-app/api/applications";
import { ChecksApiError } from "../../../src/react-app/api/checks";
import { OcrApiError } from "../../../src/react-app/api/ocr";
import { OcrPage } from "../../../src/react-app/pages/ocr-page";
import type {
  ApplicationDetail,
  UsageResponse,
} from "../../../src/worker/types/contracts";

const IMAGE = { base64: "resized-base64", mimeType: "image/jpeg" as const };

const USAGE = {
  geminiCalls: 1,
  geminiCallsLimit: 720,
  ocrPages: 1,
  ocrPagesLimit: 120,
  ocrPagesRemaining: 119,
  period: "2026-09",
} as unknown as UsageResponse;

const APPLICATION = {
  appStatus: "received",
  createdAt: "2026-09-01T00:00:00Z",
  createdBy: {
    email: "staff@example.com",
    id: "stf_1",
    isActive: true,
    name: "担当者",
    role: "staff",
  },
  docType: "利用者登録申請書",
  editedCount: 0,
  fields: [
    { confidence: 0.98, edited: false, label: "氏名", value: "山田太郎" },
    { confidence: 0.4, edited: false, label: "電話番号", value: "" },
  ],
  hasImage: true,
  id: "app_1",
  latestCheckRun: null,
  matchCandidates: [],
  member: null,
  processingSec: 1.2,
  statusHistory: [],
  triage: null,
  updatedBy: null,
} as unknown as ApplicationDetail;

describe("OcrPage", () => {
  it("resizes the selected file and shows the extracted result (F-2-1・F-2-10)", async () => {
    type ExtractResult = {
      application: ApplicationDetail;
      usage: UsageResponse;
    };
    let resolveExtract: (value: ExtractResult) => void = () => {};
    const extract = vi.fn(
      () =>
        new Promise<ExtractResult>((resolve) => {
          resolveExtract = resolve;
        }),
    );
    const resizeImage = vi.fn().mockResolvedValue(IMAGE);

    render(<OcrPage api={{ extract }} resizeImage={resizeImage} />);
    const input = document.getElementById("ocr-file-input");
    expect(input).not.toBeNull();
    fireEvent.change(input as Element, {
      target: {
        files: [new File(["fake-bytes"], "form.jpg", { type: "image/jpeg" })],
      },
    });

    await vi.waitFor(() => {
      expect(screen.getByText("AIが読み取っています…")).toBeTruthy();
    });
    expect(resizeImage).toHaveBeenCalledOnce();
    expect(extract).toHaveBeenCalledWith({ image: IMAGE });

    resolveExtract({ application: APPLICATION, usage: USAGE });

    expect(await screen.findByText(/利用者登録申請書/)).toBeTruthy();
    // 手動で直せるよう、値はラベル表示ではなくテキストボックスで表示する。
    expect(screen.getByLabelText("氏名")).toHaveProperty("value", "山田太郎");
    // NF-2-18・screen-list.md: 応答に含まれるusageから残り読取可能枚数を表示する。
    expect(screen.getByText(/今月の残り読取可能枚数/)).toBeTruthy();
    expect(document.getElementById("ocr-usage-remaining")?.textContent).toBe(
      "今月の残り読取可能枚数: 119 / 120",
    );
    // アップロード画面と読取結果画面は排他表示。結果表示中はドロップゾーンを隠す。
    expect(document.getElementById("ocr-file-input")).toBeNull();
  });

  it("highlights fields below the 85% confidence threshold and clears on confirm (NF-4-3)", async () => {
    const extract = vi
      .fn()
      .mockResolvedValue({ application: APPLICATION, usage: USAGE });
    const resizeImage = vi.fn().mockResolvedValue(IMAGE);

    render(<OcrPage api={{ extract }} resizeImage={resizeImage} />);
    const input = document.getElementById("ocr-file-input") as Element;
    fireEvent.change(input, {
      target: {
        files: [new File(["fake-bytes"], "form.jpg", { type: "image/jpeg" })],
      },
    });

    await screen.findByText(/利用者登録申請書/);
    const lowConfidenceLabel = screen.getByText("電話番号");
    const row = lowConfidenceLabel.parentElement;
    expect(row?.getAttribute("data-needs-check")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(row?.getAttribute("data-needs-check")).toBe("false");
  });

  it("lets staff correct a misread value in the text box (F-2 手動修正)", async () => {
    const extract = vi
      .fn()
      .mockResolvedValue({ application: APPLICATION, usage: USAGE });
    const resizeImage = vi.fn().mockResolvedValue(IMAGE);

    render(<OcrPage api={{ extract }} resizeImage={resizeImage} />);
    const input = document.getElementById("ocr-file-input") as Element;
    fireEvent.change(input, {
      target: {
        files: [new File(["fake-bytes"], "form.jpg", { type: "image/jpeg" })],
      },
    });

    await screen.findByText(/利用者登録申請書/);
    const nameField = screen.getByLabelText("氏名") as HTMLInputElement;
    fireEvent.change(nameField, { target: { value: "山田次郎" } });

    expect(nameField.value).toBe("山田次郎");
    expect(screen.getByText("・修正済")).toBeTruthy();
  });

  describe("'業務チェックへ進む' (F-4-6・決定#33)", () => {
    async function renderWithExtractedApplication() {
      const extract = vi
        .fn()
        .mockResolvedValue({ application: APPLICATION, usage: USAGE });
      const resizeImage = vi.fn().mockResolvedValue(IMAGE);
      const updateFields = vi.fn().mockResolvedValue(APPLICATION);
      const run = vi.fn().mockResolvedValue({
        application: APPLICATION,
        checkRun: { id: "check-1" },
        matchCandidates: [],
        remainingRuns: 4,
        usage: USAGE,
      });
      const onProceedToCheck = vi.fn();

      render(
        <OcrPage
          api={{ extract }}
          applicationsApi={{ updateFields }}
          checksApi={{ run }}
          onProceedToCheck={onProceedToCheck}
          resizeImage={resizeImage}
        />,
      );
      const input = document.getElementById("ocr-file-input") as Element;
      fireEvent.change(input, {
        target: {
          files: [new File(["fake-bytes"], "form.jpg", { type: "image/jpeg" })],
        },
      });
      await screen.findByText(/利用者登録申請書/);

      return { onProceedToCheck, run, updateFields };
    }

    it("saves the current fields, runs the check, then proceeds to the application detail screen", async () => {
      const { onProceedToCheck, run, updateFields } =
        await renderWithExtractedApplication();
      const nameField = screen.getByLabelText("氏名") as HTMLInputElement;
      fireEvent.change(nameField, { target: { value: "山田次郎" } });

      fireEvent.click(
        screen.getByRole("button", {
          name: "業務チェックへ進む(整合性・不備・重複・判定)",
        }),
      );

      await vi.waitFor(() => {
        expect(onProceedToCheck).toHaveBeenCalledWith("app_1");
      });
      expect(updateFields).toHaveBeenCalledWith("app_1", {
        fields: [
          { label: "氏名", value: "山田次郎" },
          { label: "電話番号", value: "" },
        ],
      });
      // 保存が完了してから業務チェックを実行する(決定#33)。
      expect(updateFields.mock.invocationCallOrder[0]).toBeLessThan(
        run.mock.invocationCallOrder[0],
      );
      expect(run).toHaveBeenCalledWith({ applicationId: "app_1" });
    });

    it("does not run the check when saving the fields fails, and shows the server message", async () => {
      const { run, updateFields } = await renderWithExtractedApplication();
      updateFields.mockRejectedValue(
        new ApplicationsApiError(
          "VALIDATION_ERROR",
          422,
          "入力内容を確認してください。",
        ),
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: "業務チェックへ進む(整合性・不備・重複・判定)",
        }),
      );

      expect(
        await screen.findByText("入力内容を確認してください。"),
      ).toBeTruthy();
      expect(run).not.toHaveBeenCalled();
      // 読取結果の確認画面のまま(離脱しない)。
      expect(screen.getByText(/利用者登録申請書/)).toBeTruthy();
    });

    it("shows the server message and stays on this screen when the check run limit is reached (409)", async () => {
      const { onProceedToCheck, run } = await renderWithExtractedApplication();
      run.mockRejectedValue(
        new ChecksApiError(
          "CHECK_RUN_LIMIT",
          409,
          "業務チェックの実施回数が上限に達しました。",
          false,
        ),
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: "業務チェックへ進む(整合性・不備・重複・判定)",
        }),
      );

      expect(
        await screen.findByText("業務チェックの実施回数が上限に達しました。"),
      ).toBeTruthy();
      expect(onProceedToCheck).not.toHaveBeenCalled();
      expect(screen.getByText(/利用者登録申請書/)).toBeTruthy();
    });

    it("disables the button while the request is in flight", async () => {
      const extract = vi
        .fn()
        .mockResolvedValue({ application: APPLICATION, usage: USAGE });
      const resizeImage = vi.fn().mockResolvedValue(IMAGE);
      let resolveUpdateFields: (value: ApplicationDetail) => void = () => {};
      const updateFields = vi.fn(
        () =>
          new Promise<ApplicationDetail>((resolve) => {
            resolveUpdateFields = resolve;
          }),
      );
      const run = vi.fn().mockResolvedValue({
        application: APPLICATION,
        checkRun: { id: "check-1" },
        matchCandidates: [],
        remainingRuns: 4,
        usage: USAGE,
      });

      render(
        <OcrPage
          api={{ extract }}
          applicationsApi={{ updateFields }}
          checksApi={{ run }}
          onProceedToCheck={vi.fn()}
          resizeImage={resizeImage}
        />,
      );
      const input = document.getElementById("ocr-file-input") as Element;
      fireEvent.change(input, {
        target: {
          files: [new File(["fake-bytes"], "form.jpg", { type: "image/jpeg" })],
        },
      });
      await screen.findByText(/利用者登録申請書/);

      const button = screen.getByRole("button", {
        name: "業務チェックへ進む(整合性・不備・重複・判定)",
      });
      fireEvent.click(button);
      await vi.waitFor(() => {
        expect((button as HTMLButtonElement).disabled).toBe(true);
      });

      resolveUpdateFields(APPLICATION);
      await vi.waitFor(() => {
        expect(run).toHaveBeenCalledOnce();
      });
    });
  });

  it("returns to the upload screen when '中断する' is clicked", async () => {
    const extract = vi
      .fn()
      .mockResolvedValue({ application: APPLICATION, usage: USAGE });
    const resizeImage = vi.fn().mockResolvedValue(IMAGE);

    render(<OcrPage api={{ extract }} resizeImage={resizeImage} />);
    const input = document.getElementById("ocr-file-input") as Element;
    fireEvent.change(input, {
      target: {
        files: [new File(["fake-bytes"], "form.jpg", { type: "image/jpeg" })],
      },
    });
    await screen.findByText(/利用者登録申請書/);

    fireEvent.click(
      screen.getByRole("button", { name: "中断する(受付のまま保存)" }),
    );

    expect(screen.queryByText(/利用者登録申請書/)).toBeNull();
    expect(screen.getByText("帳票の画像を選択")).toBeTruthy();
  });

  it("shows the API message when the monthly usage limit is reached (429)", async () => {
    const extract = vi
      .fn()
      .mockRejectedValue(
        new OcrApiError(
          "USAGE_LIMIT_EXCEEDED",
          429,
          "今月の利用上限に達しました。",
          false,
        ),
      );
    const resizeImage = vi.fn().mockResolvedValue(IMAGE);

    render(<OcrPage api={{ extract }} resizeImage={resizeImage} />);
    const input = document.getElementById("ocr-file-input") as Element;
    fireEvent.change(input, {
      target: {
        files: [new File(["fake-bytes"], "form.jpg", { type: "image/jpeg" })],
      },
    });

    expect(
      await screen.findByText("今月の利用上限に達しました。"),
    ).toBeTruthy();
  });

  it("shows the API message when the AI is unavailable (503)", async () => {
    const extract = vi
      .fn()
      .mockRejectedValue(
        new OcrApiError(
          "AI_UNAVAILABLE",
          503,
          "AIサービスを利用できません。時間をおいて再試行してください。",
          true,
        ),
      );
    const resizeImage = vi.fn().mockResolvedValue(IMAGE);

    render(<OcrPage api={{ extract }} resizeImage={resizeImage} />);
    const input = document.getElementById("ocr-file-input") as Element;
    fireEvent.change(input, {
      target: {
        files: [new File(["fake-bytes"], "form.jpg", { type: "image/jpeg" })],
      },
    });

    expect(
      await screen.findByText(
        "AIサービスを利用できません。時間をおいて再試行してください。",
      ),
    ).toBeTruthy();
  });

  it("shows a resizing progress message before the request is sent", async () => {
    let resolveResize: (value: typeof IMAGE) => void = () => {};
    const resizeImage = vi.fn(
      () =>
        new Promise<typeof IMAGE>((resolve) => {
          resolveResize = resolve;
        }),
    );
    const extract = vi
      .fn()
      .mockResolvedValue({ application: APPLICATION, usage: USAGE });

    render(<OcrPage api={{ extract }} resizeImage={resizeImage} />);
    const input = document.getElementById("ocr-file-input") as Element;
    fireEvent.change(input, {
      target: {
        files: [new File(["fake-bytes"], "form.jpg", { type: "image/jpeg" })],
      },
    });

    await vi.waitFor(() => {
      expect(screen.getByText("画像を処理しています…")).toBeTruthy();
    });
    expect(extract).not.toHaveBeenCalled();

    resolveResize(IMAGE);
    await screen.findByText(/利用者登録申請書/);
  });

  it("rejects multiple files dropped at once without submitting (F-2-3)", async () => {
    const extract = vi.fn();
    const resizeImage = vi.fn().mockResolvedValue(IMAGE);

    render(<OcrPage api={{ extract }} resizeImage={resizeImage} />);
    const dropzone = document.querySelector(".ocr-dropzone") as Element;
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [
          new File(["a"], "front.jpg", { type: "image/jpeg" }),
          new File(["b"], "back.jpg", { type: "image/jpeg" }),
        ],
      },
    });

    expect(
      await screen.findByText("1回につき1枚の画像のみ選択できます。"),
    ).toBeTruthy();
    expect(resizeImage).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });
});
