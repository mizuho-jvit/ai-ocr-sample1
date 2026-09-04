import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApplicationListPage } from "../../../src/react-app/pages/application-list-page";
import type {
  ApplicationListResponse,
  ApplicationSummary,
} from "../../../src/worker/types/contracts";

const ITEM: ApplicationSummary = {
  appStatus: "under_review",
  createdAt: "2026-09-01T09:00:00.000Z",
  createdBy: {
    email: "staff@example.com",
    id: "stf_1" as ApplicationSummary["createdBy"]["id"],
    isActive: true,
    name: "窓口 花子",
    role: "staff",
  },
  docType: "利用者登録申請書",
  hasImage: true,
  id: "app_1" as ApplicationSummary["id"],
  member: null,
  triage: "needs_review",
};

function listResponse(
  overrides: Partial<ApplicationListResponse> = {},
): ApplicationListResponse {
  return { items: [ITEM], page: 1, perPage: 20, total: 1, ...overrides };
}

describe("ApplicationListPage", () => {
  it("renders the fetched items (F-4-10)", async () => {
    const list = vi.fn().mockResolvedValue(listResponse());
    render(
      <ApplicationListPage api={{ list }} onSelectApplication={vi.fn()} />,
    );

    expect(await screen.findByText("利用者登録申請書")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "審査中" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "要審査" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "窓口 花子" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "未紐付け" })).toBeTruthy();
    expect(list).toHaveBeenCalledWith({ page: 1 });
  });

  it("passes the selected appStatus filter through to the API (F-4-10)", async () => {
    const list = vi.fn().mockResolvedValue(listResponse());
    render(
      <ApplicationListPage api={{ list }} onSelectApplication={vi.fn()} />,
    );
    await screen.findByText("利用者登録申請書");

    fireEvent.change(screen.getByLabelText("処理状態で絞り込み"), {
      target: { value: "approved" },
    });

    await vi.waitFor(() => {
      expect(list).toHaveBeenLastCalledWith({ appStatus: "approved", page: 1 });
    });
  });

  it("passes needsReviewOnly through when the checkbox is checked (F-4-11)", async () => {
    const list = vi.fn().mockResolvedValue(listResponse());
    render(
      <ApplicationListPage api={{ list }} onSelectApplication={vi.fn()} />,
    );
    await screen.findByText("利用者登録申請書");

    fireEvent.click(screen.getByLabelText("要審査のみ"));

    await vi.waitFor(() => {
      expect(list).toHaveBeenLastCalledWith({
        needsReviewOnly: true,
        page: 1,
      });
    });
  });

  it("calls onSelectApplication with the row's id", async () => {
    const list = vi.fn().mockResolvedValue(listResponse());
    const onSelectApplication = vi.fn();
    render(
      <ApplicationListPage
        api={{ list }}
        onSelectApplication={onSelectApplication}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "詳細" }));

    expect(onSelectApplication).toHaveBeenCalledWith("app_1");
  });

  it("advances to the next page and requests it from the API", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(listResponse({ page: 1, total: 40 }))
      .mockResolvedValueOnce(listResponse({ page: 2, total: 40 }));
    render(
      <ApplicationListPage api={{ list }} onSelectApplication={vi.fn()} />,
    );
    await screen.findByText("利用者登録申請書");

    fireEvent.click(screen.getByRole("button", { name: "次へ" }));

    await vi.waitFor(() => {
      expect(list).toHaveBeenLastCalledWith({ page: 2 });
    });
  });

  it("shows an error message when the API call fails", async () => {
    const list = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <ApplicationListPage api={{ list }} onSelectApplication={vi.fn()} />,
    );

    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
