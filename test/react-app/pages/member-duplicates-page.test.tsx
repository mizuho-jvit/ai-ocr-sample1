import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemberDuplicatesPage } from "../../../src/react-app/pages/member-duplicates-page";
import type { MatchCandidateView } from "../../../src/worker/types/contracts";

const CANDIDATE: MatchCandidateView = {
  aiLikelihood: "high",
  aiReason: "カナ氏名と生年月日が一致しているため。",
  decidedAt: null,
  decidedBy: null,
  id: "candidate_1" as MatchCandidateView["id"],
  member: {
    birthDate: "1980-01-01",
    id: "member_1" as MatchCandidateView["member"]["id"],
    memberNumber: "1",
    name: "山田太郎",
    nameKana: "ヤマダタロウ",
    phone: "09012345678",
    status: "active",
  },
  ruleScore: 60,
  status: "pending",
};

describe("MemberDuplicatesPage (F-5-9)", () => {
  it("renders unresolved candidates", async () => {
    const listMatchCandidates = vi.fn().mockResolvedValue([CANDIDATE]);
    render(<MemberDuplicatesPage api={{ listMatchCandidates }} />);

    expect(await screen.findByText("山田太郎")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("高")).toBeTruthy();
    expect(screen.getByText("未判断")).toBeTruthy();
    expect(listMatchCandidates).toHaveBeenCalledOnce();
  });

  it("shows an empty state when there are no unresolved candidates", async () => {
    const listMatchCandidates = vi.fn().mockResolvedValue([]);
    render(<MemberDuplicatesPage api={{ listMatchCandidates }} />);

    expect(
      await screen.findByText("未解決の名寄せ候補はありません。"),
    ).toBeTruthy();
  });

  it("shows an error message when the API call fails", async () => {
    const listMatchCandidates = vi.fn().mockRejectedValue(new Error("boom"));
    render(<MemberDuplicatesPage api={{ listMatchCandidates }} />);

    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
