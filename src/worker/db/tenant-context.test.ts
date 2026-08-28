import { describe, expect, it } from "vitest";
import type { AppConfig } from "../types";
import { currentTenantId } from "./tenant-context";

const CONFIG: AppConfig = {
  allowDataReset: false,
  geminiModel: "gemini-3.1-flash-lite",
  maxCheckRunsPerApplication: 5,
  maxGeminiCallsPerMonth: 720,
  maxOcrPagesPerMonth: 120,
  ocrPipelineMode: "gemini",
  pbkdf2Iterations: 100_000,
  tenantId: "tenant-from-config",
};

describe("currentTenantId", () => {
  it("returns only the tenant selected by validated configuration", () => {
    const requestControlledTenantId = "tenant-from-request";

    expect(currentTenantId(CONFIG)).toBe("tenant-from-config");
    expect(currentTenantId(CONFIG)).not.toBe(requestControlledTenantId);
  });
});
