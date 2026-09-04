import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChecksApiError } from "../../../src/react-app/api/checks";
import { ApplicationDetailPage } from "../../../src/react-app/pages/application-detail-page";
import type {
  ApplicationDetail,
  ChangeAppStatusResponse,
  DecideMatchResponse,
  RunCheckResponse,
} from "../../../src/worker/types/contracts";

const STAFF = {
  email: "staff@example.com",
  id: "stf_1" as ApplicationDetail["createdBy"]["id"],
  isActive: true,
  name: "窓口 花子",
  role: "staff" as const,
};

function baseApplication(
  overrides: Partial<ApplicationDetail> = {},
): ApplicationDetail {
  return {
    appStatus: "under_review",
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: STAFF,
    docType: "利用者登録申請書",
    editedCount: 0,
    fields: [
      { confidence: 0.98, edited: false, label: "氏名", value: "山田太郎" },
      {
        confidence: 0.9,
        edited: false,
        label: "電話番号",
        value: "0300001111",
      },
    ],
    hasImage: false,
    id: "app_1" as ApplicationDetail["id"],
    latestCheckRun: null,
    matchCandidates: [],
    member: null,
    processingSec: 1.2,
    statusHistory: [],
    triage: null,
    updatedBy: null,
    ...overrides,
  } as ApplicationDetail;
}

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    changeStatus: vi.fn(),
    decideMatch: vi.fn(),
    get: vi.fn(),
    imageUrl: vi.fn(),
    listCheckRuns: vi.fn(),
    updateFields: vi.fn(),
    ...overrides,
    // biome-ignore lint/suspicious/noExplicitAny: テスト用の緩いフェイク型。
  } as any;
}

describe("ApplicationDetailPage", () => {
  it("loads and renders the application's fields (F-4-5)", async () => {
    const api = fakeApi({ get: vi.fn().mockResolvedValue(baseApplication()) });
    render(
      <ApplicationDetailPage
        api={api}
        applicationId="app_1"
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByLabelText("氏名")).toHaveProperty(
      "value",
      "山田太郎",
    );
    expect(api.get).toHaveBeenCalledWith("app_1");
  });

  it("saves edited field values without touching confidence, and shows the edited marker returned by the server", async () => {
    const application = baseApplication();
    const updated = {
      ...application,
      editedCount: 1,
      fields: [
        { confidence: 0.98, edited: true, label: "氏名", value: "山田次郎" },
        application.fields[1],
      ],
    };
    const updateFields = vi.fn().mockResolvedValue(updated);
    const api = fakeApi({
      get: vi.fn().mockResolvedValue(application),
      updateFields,
    });
    render(
      <ApplicationDetailPage
        api={api}
        applicationId="app_1"
        onBack={vi.fn()}
      />,
    );
    await screen.findByLabelText("氏名");

    fireEvent.change(screen.getByLabelText("氏名"), {
      target: { value: "山田次郎" },
    });
    fireEvent.click(screen.getByRole("button", { name: "項目を保存" }));

    await vi.waitFor(() => {
      expect(updateFields).toHaveBeenCalledWith("app_1", {
        fields: [
          { label: "氏名", value: "山田次郎" },
          { label: "電話番号", value: "0300001111" },
        ],
      });
    });
    expect(await screen.findByText(/修正済/)).toBeTruthy();
  });

  it("only offers the transitions allowed from the current status (api.md #11)", async () => {
    const api = fakeApi({
      get: vi
        .fn()
        .mockResolvedValue(baseApplication({ appStatus: "under_review" })),
    });
    render(
      <ApplicationDetailPage
        api={api}
        applicationId="app_1"
        onBack={vi.fn()}
      />,
    );
    await screen.findByLabelText("氏名");

    expect(screen.getByRole("button", { name: "承認する" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "差戻しにする" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "受付にする" })).toBeNull();
  });

  it("shows no transition buttons for an approved (confirmed) application", async () => {
    const api = fakeApi({
      get: vi
        .fn()
        .mockResolvedValue(baseApplication({ appStatus: "approved" })),
    });
    render(
      <ApplicationDetailPage
        api={api}
        applicationId="app_1"
        onBack={vi.fn()}
      />,
    );
    await screen.findByLabelText("氏名");

    expect(screen.queryByRole("button", { name: "承認する" })).toBeNull();
    expect(screen.queryByRole("button", { name: "差戻しにする" })).toBeNull();
  });

  it("reports the promoted member after approval (F-4-3)", async () => {
    const application = baseApplication({ appStatus: "under_review" });
    const result = {
      application: { ...application, appStatus: "approved" },
      promotedMember: {
        birthDate: null,
        id: "member_1",
        memberNumber: "1",
        name: "山田太郎",
        nameKana: null,
        phone: null,
        status: "active",
      },
    } as unknown as ChangeAppStatusResponse;
    const changeStatus = vi.fn().mockResolvedValue(result);
    const api = fakeApi({
      changeStatus,
      get: vi.fn().mockResolvedValue(application),
    });
    render(
      <ApplicationDetailPage
        api={api}
        applicationId="app_1"
        onBack={vi.fn()}
      />,
    );
    await screen.findByLabelText("氏名");

    fireEvent.click(screen.getByRole("button", { name: "承認する" }));

    expect(changeStatus).toHaveBeenCalledWith("app_1", {
      toStatus: "approved",
    });
    expect(
      await screen.findByText(
        /会員「山田太郎」を「利用資格あり」へ更新しました/,
      ),
    ).toBeTruthy();
  });

  it("highlights differing fields and lets staff merge/reject/hold a match candidate (F-6-7〜9)", async () => {
    const application = baseApplication({
      matchCandidates: [
        {
          aiLikelihood: "medium",
          aiReason: "生年月日が一致",
          decidedAt: null,
          decidedBy: null,
          id: "cand_1",
          member: {
            birthDate: "1990-01-01",
            id: "member_1",
            memberNumber: "1",
            name: "山田次郎",
            nameKana: "ヤマダジロウ",
            phone: "0300001111",
            status: "active",
          },
          ruleScore: 30,
          status: "pending",
        },
      ] as unknown as ApplicationDetail["matchCandidates"],
    });
    const decideMatch = vi.fn().mockResolvedValue({
      application,
      candidate: application.matchCandidates[0],
    } as DecideMatchResponse);
    const api = fakeApi({
      decideMatch,
      get: vi.fn().mockResolvedValue(application),
    });
    render(
      <ApplicationDetailPage
        api={api}
        applicationId="app_1"
        onBack={vi.fn()}
      />,
    );
    await screen.findByLabelText("氏名");

    // 申請データ「山田太郎」と会員データ「山田次郎」は不一致なのでハイライトされる。
    const nameRow = screen.getByText("山田太郎", { selector: "div" })
      .parentElement as HTMLElement;
    expect(nameRow.getAttribute("data-differs")).toBe("true");

    fireEvent.click(
      within(
        screen.getByText(/1 山田次郎/).closest(".card") as HTMLElement,
      ).getByRole("button", { name: "同一人物として紐付け" }),
    );

    expect(decideMatch).toHaveBeenCalledWith("app_1", "cand_1", {
      decision: "merged",
    });
  });

  // コードレビュー指摘・ユーザー判断: 承認済み(確定状態)の申請はdecideMatch自体をAPI側で
  // 拒否するため、UI側も同じ条件で判断ボタンを出さない。
  it("hides match-candidate decision buttons once the application is approved (F-4-2)", async () => {
    const application = baseApplication({
      appStatus: "approved",
      matchCandidates: [
        {
          aiLikelihood: "medium",
          aiReason: "生年月日が一致",
          decidedAt: null,
          decidedBy: null,
          id: "cand_1",
          member: {
            birthDate: "1990-01-01",
            id: "member_1",
            memberNumber: "1",
            name: "山田次郎",
            nameKana: "ヤマダジロウ",
            phone: "0300001111",
            status: "active",
          },
          ruleScore: 30,
          status: "pending",
        },
      ] as unknown as ApplicationDetail["matchCandidates"],
    });
    const api = fakeApi({ get: vi.fn().mockResolvedValue(application) });
    render(
      <ApplicationDetailPage
        api={api}
        applicationId="app_1"
        onBack={vi.fn()}
      />,
    );
    await screen.findByLabelText("氏名");

    expect(
      screen.queryByRole("button", { name: "同一人物として紐付け" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "別人として登録" })).toBeNull();
    expect(screen.queryByRole("button", { name: "保留" })).toBeNull();
  });

  it("shows an error message when loading fails", async () => {
    const api = fakeApi({ get: vi.fn().mockRejectedValue(new Error("boom")) });
    render(
      <ApplicationDetailPage
        api={api}
        applicationId="app_1"
        onBack={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  describe("業務チェックを実施/再実施 (F-4-6)", () => {
    it("runs the check and refreshes the application on success", async () => {
      const application = baseApplication({ latestCheckRun: null });
      const updated = baseApplication({
        appStatus: "under_review",
        latestCheckRun: {
          consistency: [],
          createdAt: "2026-09-04T00:00:00.000Z",
          createdBy: STAFF,
          deficiencies: [],
          id: "check_1",
          letterDraft: null,
          triage: "approval_candidate",
          triageReason: "整合",
        },
      } as unknown as Partial<ApplicationDetail>);
      const run = vi.fn().mockResolvedValue({
        application: updated,
        checkRun: updated.latestCheckRun,
        matchCandidates: [],
        remainingRuns: 4,
        usage: {},
      } as unknown as RunCheckResponse);
      const api = fakeApi({ get: vi.fn().mockResolvedValue(application) });
      render(
        <ApplicationDetailPage
          api={api}
          applicationId="app_1"
          checksApi={{ run }}
          onBack={vi.fn()}
        />,
      );
      await screen.findByLabelText("氏名");

      fireEvent.click(
        screen.getByRole("button", { name: "業務チェックを実施" }),
      );

      expect(run).toHaveBeenCalledWith({ applicationId: "app_1" });
      expect(await screen.findByText(/整合/)).toBeTruthy();
      expect(screen.getByText(/残り再実施回数: 4回/)).toBeTruthy();
    });

    it("labels the button 'rerun' once a check has already run, and disables it once approved", async () => {
      const application = baseApplication({
        appStatus: "approved",
        latestCheckRun: {
          consistency: [],
          createdAt: "2026-09-04T00:00:00.000Z",
          createdBy: STAFF,
          deficiencies: [],
          id: "check_1",
          letterDraft: null,
          triage: "approval_candidate",
          triageReason: "整合",
        },
      } as unknown as Partial<ApplicationDetail>);
      const api = fakeApi({ get: vi.fn().mockResolvedValue(application) });
      render(
        <ApplicationDetailPage
          api={api}
          applicationId="app_1"
          onBack={vi.fn()}
        />,
      );
      await screen.findByLabelText("氏名");

      const button = screen.getByRole("button", {
        name: "業務チェックを再実施",
      });
      expect((button as HTMLButtonElement).disabled).toBe(true);
    });

    it("shows the server message when the check-run limit is reached (409) and does not update the application", async () => {
      const application = baseApplication({ latestCheckRun: null });
      const run = vi
        .fn()
        .mockRejectedValue(
          new ChecksApiError(
            "CHECK_RUN_LIMIT",
            409,
            "業務チェックの実施回数が上限に達しました。",
            false,
          ),
        );
      const api = fakeApi({ get: vi.fn().mockResolvedValue(application) });
      render(
        <ApplicationDetailPage
          api={api}
          applicationId="app_1"
          checksApi={{ run }}
          onBack={vi.fn()}
        />,
      );
      await screen.findByLabelText("氏名");

      fireEvent.click(
        screen.getByRole("button", { name: "業務チェックを実施" }),
      );

      expect(
        await screen.findByText("業務チェックの実施回数が上限に達しました。"),
      ).toBeTruthy();
    });
  });
});
