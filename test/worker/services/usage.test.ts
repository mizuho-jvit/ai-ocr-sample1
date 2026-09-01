import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createUsageService } from "../../../src/worker/services/usage";
import { type AppConfig, toTenantId } from "../../../src/worker/types";

const testEnvironment = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
};

const CONFIG: AppConfig = {
  aiGatewayAccountId: "test-ai-gateway-account",
  aiGatewayId: "test-ai-gateway-id",
  r2AccountId: "test-r2-account",
  allowDataReset: true,
  geminiModel: "gemini-3.1-flash-lite",
  maxCheckRunsPerApplication: 5,
  maxGeminiCallsPerMonth: 3,
  maxOcrPagesPerMonth: 2,
  ocrPipelineMode: "gemini",
  pbkdf2Iterations: 1_000,
  tenantId: toTenantId("tenant-usage"),
};

// UTC 2026-08-15T00:00:00Z = JST 2026-08-15T09:00:00 → period "2026-08".
let currentTime = new Date("2026-08-15T00:00:00.000Z");

function clock(): Date {
  return currentTime;
}

function usageService(config: AppConfig = CONFIG) {
  return createUsageService({ clock, config, database: env.DB });
}

async function readRow(period: string) {
  return env.DB.prepare("SELECT * FROM usage_counter WHERE period = ?")
    .bind(period)
    .first<{ ocr_pages: number; gemini_calls: number }>();
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnvironment.TEST_MIGRATIONS);
});

beforeEach(async () => {
  currentTime = new Date("2026-08-15T00:00:00.000Z");
  await env.DB.prepare("DELETE FROM usage_counter").run();
});

describe("getUsage (NF-2-18・NF-2-19・NF-2-34)", () => {
  it("returns zeros for a period with no recorded usage", async () => {
    await expect(usageService().getUsage()).resolves.toEqual({
      geminiCalls: 0,
      geminiCallsLimit: 3,
      ocrPages: 0,
      ocrPagesLimit: 2,
      ocrPagesRemaining: 2,
      period: "2026-08",
    });
  });

  it("is read-only and never creates or modifies a row", async () => {
    await usageService().getUsage();
    await expect(readRow("2026-08")).resolves.toBeNull();
  });

  it("treats a stored period that no longer matches the current one as zero (NF-2-19)", async () => {
    await usageService().consumeOcr();

    // JST月替わり: UTC 2026-09-01T00:00:00Z = JST 2026-09-01T09:00:00 → period "2026-09".
    currentTime = new Date("2026-09-01T00:00:00.000Z");

    await expect(usageService().getUsage()).resolves.toMatchObject({
      ocrPages: 0,
      period: "2026-09",
    });
  });
});

describe("consumeOcr / consumeGemini (NF-2-16・NF-2-39)", () => {
  it("increments atomically and reports the updated remaining count", async () => {
    await expect(usageService().consumeOcr()).resolves.toMatchObject({
      ocrPages: 1,
      ocrPagesRemaining: 1,
    });
    await expect(usageService().consumeOcr()).resolves.toMatchObject({
      ocrPages: 2,
      ocrPagesRemaining: 0,
    });
  });

  it("fails closed with USAGE_LIMIT_EXCEEDED once the limit is reached, without incrementing further", async () => {
    await usageService().consumeOcr();
    await usageService().consumeOcr();

    await expect(usageService().consumeOcr()).rejects.toMatchObject({
      code: "USAGE_LIMIT_EXCEEDED",
    });
    await expect(readRow("2026-08")).resolves.toMatchObject({ ocr_pages: 2 });
  });

  it("tracks ocrPages and geminiCalls independently on the same period row", async () => {
    await usageService().consumeOcr();
    await usageService().consumeGemini();
    await usageService().consumeGemini();

    await expect(usageService().getUsage()).resolves.toMatchObject({
      geminiCalls: 2,
      ocrPages: 1,
    });
  });

  it("cannot be pushed past the limit by concurrent requests (NF-2-39)", async () => {
    const config: AppConfig = { ...CONFIG, maxOcrPagesPerMonth: 3 };
    const service = usageService(config);

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => service.consumeOcr()),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(3);
    await expect(readRow("2026-08")).resolves.toMatchObject({ ocr_pages: 3 });
  });

  it("starts a fresh period at 0 even though the previous period reached its limit", async () => {
    await usageService().consumeOcr();
    await usageService().consumeOcr();
    await expect(usageService().consumeOcr()).rejects.toMatchObject({
      code: "USAGE_LIMIT_EXCEEDED",
    });

    currentTime = new Date("2026-09-01T00:00:00.000Z");
    await expect(usageService().consumeOcr()).resolves.toMatchObject({
      ocrPages: 1,
    });

    // 過去期間の行は書き換えられない(F-9のリセットと同じくUsageCounterへ触れない・NF-2-40)。
    await expect(readRow("2026-08")).resolves.toMatchObject({ ocr_pages: 2 });
  });
});

describe("上限引き下げ (NF-2-37)", () => {
  it("fails closed immediately when a lowered limit is already exceeded by existing consumption", async () => {
    const generous = usageService({ ...CONFIG, maxOcrPagesPerMonth: 5 });
    await generous.consumeOcr();
    await generous.consumeOcr();
    await generous.consumeOcr();

    const strict = usageService({ ...CONFIG, maxOcrPagesPerMonth: 2 });
    await expect(strict.consumeOcr()).rejects.toMatchObject({
      code: "USAGE_LIMIT_EXCEEDED",
    });
    // 引き下げ後も既存の消費量そのものは書き換えられない。
    await expect(readRow("2026-08")).resolves.toMatchObject({ ocr_pages: 3 });
  });
});
