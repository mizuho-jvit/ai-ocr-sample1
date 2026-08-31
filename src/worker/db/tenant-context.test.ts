import { describe, expect, it } from "vitest";
import { type AppConfig, toTenantId } from "../types";
import { currentTenantId } from "./tenant-context";

const TENANT_FROM_CONFIG = toTenantId("tenant-from-config");

const CONFIG: AppConfig = {
  allowDataReset: false,
  geminiModel: "gemini-3.1-flash-lite",
  maxCheckRunsPerApplication: 5,
  maxGeminiCallsPerMonth: 720,
  maxOcrPagesPerMonth: 120,
  ocrPipelineMode: "gemini",
  pbkdf2Iterations: 100_000,
  tenantId: TENANT_FROM_CONFIG,
};

describe("currentTenantId", () => {
  it("returns only the tenant selected by validated configuration", () => {
    const requestControlledTenantId = toTenantId("tenant-from-request");

    expect(currentTenantId(CONFIG)).toBe(TENANT_FROM_CONFIG);
    expect(currentTenantId(CONFIG)).not.toBe(requestControlledTenantId);
  });
});
