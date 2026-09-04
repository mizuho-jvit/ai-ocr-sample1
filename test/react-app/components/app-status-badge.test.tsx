import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppStatusBadge } from "../../../src/react-app/components/app-status-badge";

describe("AppStatusBadge", () => {
  it.each([
    ["received", "受付"],
    ["under_review", "審査中"],
    ["approved", "承認"],
    ["returned", "差戻し"],
  ] as const)("renders the %s status as %s", (status, label) => {
    render(<AppStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });
});
