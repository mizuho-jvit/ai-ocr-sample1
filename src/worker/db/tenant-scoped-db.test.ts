import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  type SqlExpr,
  type TenantInsertValues,
  type TenantRow,
  type TenantUpdateValues,
  toTenantId,
} from "../types";
import {
  createForTenant,
  forTenant,
  type TenantScopedExecutor,
} from "./tenant-scoped-db";

interface TestRow extends TenantRow {
  id: string;
  name: string;
}

const TENANT_A = toTenantId("tenant-a");
const TENANT_B = toTenantId("tenant-b");

function createExecutor(): TenantScopedExecutor {
  return {
    delete: vi.fn(async () => 1),
    insert: vi.fn(async (_table, values) => values),
    select: vi.fn(async () => []),
    selectOne: vi.fn(async () => null),
    update: vi.fn(async () => 1),
  };
}

const CALLER_WHERE = { source: "caller" } as unknown as SqlExpr;

describe("tenant-scoped database boundary", () => {
  it("adds an immutable tenant predicate to every read, update, and delete", async () => {
    const executor = createExecutor();
    const db = forTenant(TENANT_A, executor);

    await db.select<TestRow>("members", CALLER_WHERE);
    await db.selectOne<TestRow>("members", CALLER_WHERE);
    await db.update<TestRow>("members", { name: "updated" }, CALLER_WHERE);
    await db.delete("members", CALLER_WHERE);

    const expectedWhere = {
      additional: CALLER_WHERE,
      operator: "and",
      tenant: { column: "tenantId", operator: "eq", value: TENANT_A },
    };
    expect(executor.select).toHaveBeenCalledWith("members", expectedWhere);
    expect(executor.selectOne).toHaveBeenCalledWith("members", expectedWhere);
    expect(executor.update).toHaveBeenCalledWith(
      "members",
      { name: "updated" },
      expectedWhere,
    );
    expect(executor.delete).toHaveBeenCalledWith("members", expectedWhere);

    const passedWhere = vi.mocked(executor.select).mock.calls[0]?.[1];
    expect(Object.isFrozen(passedWhere)).toBe(true);
    expect(Object.isFrozen(passedWhere?.tenant)).toBe(true);
  });

  it("keeps caller tenant predicates additive instead of replacing the scope", async () => {
    const executor = createExecutor();
    const conflictingWhere = {
      tenantId: TENANT_B,
    } as unknown as SqlExpr;

    await forTenant(TENANT_A, executor).select<TestRow>(
      "members",
      conflictingWhere,
    );

    expect(executor.select).toHaveBeenCalledWith("members", {
      additional: conflictingWhere,
      operator: "and",
      tenant: { column: "tenantId", operator: "eq", value: TENANT_A },
    });
  });

  it("injects tenantId on insert and strips it from update at runtime", async () => {
    const executor = createExecutor();
    const db = createForTenant(executor)(TENANT_A);

    await db.insert<TestRow>("members", {
      id: "member-1",
      name: "member",
      tenantId: TENANT_B,
    } as unknown as TenantInsertValues<TestRow>);
    await db.update<TestRow>(
      "members",
      { name: "updated", tenantId: TENANT_B } as TenantUpdateValues<TestRow>,
      CALLER_WHERE,
    );

    expect(executor.insert).toHaveBeenCalledWith("members", {
      id: "member-1",
      name: "member",
      tenantId: TENANT_A,
    });
    expect(executor.update).toHaveBeenCalledWith(
      "members",
      { name: "updated" },
      expect.anything(),
    );
  });

  it("excludes tenantId from caller insert and update value types", () => {
    expectTypeOf<TenantInsertValues<TestRow>>().toEqualTypeOf<{
      id: string;
      name: string;
    }>();
    expectTypeOf<TenantUpdateValues<TestRow>>().toEqualTypeOf<{
      id?: string;
      name?: string;
    }>();
  });

  it("rejects an empty tenant scope", () => {
    expect(() => forTenant(toTenantId("  "), createExecutor())).toThrowError(
      "tenantId",
    );
  });
});
