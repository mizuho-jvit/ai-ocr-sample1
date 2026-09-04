import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TriageStamp } from "../../../src/react-app/components/triage-stamp";

describe("TriageStamp (overview.md デザイン要件・判子風の円形スタンプ)", () => {
  it("shows a dashed 未審査 stamp when no triage has run yet", () => {
    render(<TriageStamp triage={null} />);

    expect(screen.getByLabelText("AI業務チェック 未実施")).toBeTruthy();
  });

  it("shows a solid stamp labelled with the triage result", () => {
    render(<TriageStamp triage="needs_review" />);

    expect(screen.getByLabelText("AI判定: 要審査")).toBeTruthy();
  });

  it("splits a 4+ character label onto two lines", () => {
    render(<TriageStamp triage="approval_candidate" />);

    const stamp = screen.getByLabelText("AI判定: 承認候補");
    expect(stamp.textContent).toBe("承認候\n補");
    expect(stamp.style.whiteSpace).toBe("pre-line");
  });
});
