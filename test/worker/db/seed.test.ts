import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, describe, expect, it } from "vitest";
import readme from "../../../README.md?raw";
import demoSeedSql from "../../../scripts/db/seed.sql?raw";
import {
  DEMO_MEMBER_IDS,
  DEMO_MEMBERS,
  DEMO_STAFF,
  DEMO_STAFF_USER_IDS,
  DEMO_TENANT,
  DEMO_TENANT_ID,
  seedDemoData,
} from "../../../src/worker/db/seed";
import { verifyPassword } from "../../../src/worker/services/auth";
import type { AppConfig } from "../../../src/worker/types";

const CONFIG: AppConfig = {
  aiGatewayAccountId: "test-ai-gateway-account",
  aiGatewayId: "test-ai-gateway-id",
  r2AccountId: "test-r2-account",
  allowDataReset: true,
  geminiModel: "gemini-3.1-flash-lite",
  maxCheckRunsPerApplication: 5,
  maxGeminiCallsPerMonth: 720,
  maxOcrPagesPerMonth: 120,
  ocrPipelineMode: "gemini",
  pbkdf2Iterations: 20_000,
  tenantId: DEMO_TENANT_ID,
};

const testEnvironment = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
};

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnvironment.TEST_MIGRATIONS);
});

describe("seedDemoData", () => {
  it("inserts fixed demo staff and five active members idempotently", async () => {
    await seedDemoData(env.DB, CONFIG);
    await seedDemoData(env.DB, CONFIG);

    const tenant = await env.DB.prepare("SELECT id FROM tenants").all<{
      id: string;
    }>();
    const staff = await env.DB.prepare(
      "SELECT id, role FROM staff_users ORDER BY id",
    ).all<{ id: string; role: string }>();
    const members = await env.DB.prepare(
      "SELECT id, name, status, is_seed AS isSeed FROM members ORDER BY id",
    ).all<{ id: string; isSeed: number; name: string; status: string }>();

    expect(tenant.results).toEqual([{ id: DEMO_TENANT_ID }]);
    expect(staff.results.map(({ id }) => id)).toEqual(
      [...DEMO_STAFF_USER_IDS].sort(),
    );
    expect(staff.results.map(({ role }) => role).sort()).toEqual([
      "admin",
      "staff",
    ]);
    expect(members.results.map(({ id }) => id)).toEqual(
      [...DEMO_MEMBER_IDS].sort(),
    );
    expect(members.results).toHaveLength(5);
    expect(members.results).toContainEqual(
      expect.objectContaining({
        isSeed: 1,
        name: "仙臺 一郎",
        status: "active",
      }),
    );
    expect(
      members.results.every(
        (member) => member.isSeed === 1 && member.status === "active",
      ),
    ).toBe(true);
  });

  it("keeps the executable SQL seed aligned with the TypeScript seed", async () => {
    await env.DB.exec(
      "DELETE FROM members; DELETE FROM staff_users; DELETE FROM tenants;",
    );
    const statements = demoSeedSql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => env.DB.prepare(statement));
    await env.DB.batch(statements);

    const tenant = await env.DB.prepare(
      'SELECT id, code, name, created_at AS "createdAt", updated_at AS "updatedAt" FROM tenants ORDER BY id',
    ).all();
    const staff = await env.DB.prepare(
      `SELECT id, tenant_id AS "tenantId", email, password_hash AS "passwordHash",
        name, role, is_active AS "isActive", failed_login_count AS "failedLoginCount",
        locked_until AS "lockedUntil", created_at AS "createdAt", updated_at AS "updatedAt",
        created_by_id AS "createdById", updated_by_id AS "updatedById"
      FROM staff_users ORDER BY id`,
    ).all();
    const members = await env.DB.prepare(
      `SELECT id, tenant_id AS "tenantId", member_number AS "memberNumber", name,
        name_kana AS "nameKana", name_normalized AS "nameNormalized",
        kana_normalized AS "kanaNormalized", birth_date AS "birthDate",
        postal_code AS "postalCode", address, phone, email, status,
        is_seed AS "isSeed", created_at AS "createdAt", updated_at AS "updatedAt",
        created_by_id AS "createdById", updated_by_id AS "updatedById"
      FROM members ORDER BY id`,
    ).all();

    expect(tenant.results).toEqual([DEMO_TENANT]);
    expect(staff.results).toEqual(
      DEMO_STAFF.map((record) => ({
        ...record,
        isActive: record.isActive ? 1 : 0,
        tenantId: DEMO_TENANT_ID,
      })).sort((left, right) => left.id.localeCompare(right.id)),
    );
    expect(members.results).toEqual(
      DEMO_MEMBERS.map((record) => ({
        ...record,
        isSeed: record.isSeed ? 1 : 0,
        tenantId: DEMO_TENANT_ID,
      })).sort((left, right) => left.id.localeCompare(right.id)),
    );
  });

  it("stores PBKDF2 hashes matching the documented demo password", async () => {
    const credentials = documentedCredentials(readme);
    expect(credentials).toHaveLength(DEMO_STAFF.length);

    for (const staff of DEMO_STAFF) {
      const credential = credentials.find(
        (entry) => entry.email === staff.email && entry.role === staff.role,
      );
      expect(credential).toBeDefined();
      // 本番の検証経路そのもので照合する（並行実装で取り違えないため）。
      await expect(
        verifyPassword(credential?.password ?? "", staff.passwordHash),
      ).resolves.toBe(true);
      await expect(
        verifyPassword("wrong-password", staff.passwordHash),
      ).resolves.toBe(false);
    }
  });
});

function documentedCredentials(
  markdown: string,
): { email: string; password: string; role: string }[] {
  return markdown.split("\n").flatMap((line) => {
    const match = line.match(
      /^\|\s*(admin|staff)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*$/,
    );
    if (!match) {
      return [];
    }
    return [{ email: match[2], password: match[3], role: match[1] }];
  });
}
