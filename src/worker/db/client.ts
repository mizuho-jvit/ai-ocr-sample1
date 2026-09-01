import { and, eq, type SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  executeOperation,
  type OperationTrace,
} from "../observability/operation-trace";
import type {
  PeriodKey,
  ScopedDb,
  SqlExpr,
  StaffUserId,
  TenantId,
  TenantScopedTable,
} from "../types";
import {
  applications,
  appStatusHistory,
  checkRuns,
  matchCandidates,
  members,
  sessions,
  staffUsers,
  statusHistory,
  tenants,
  usageCounter,
} from "./schema";
import {
  forTenant,
  type TenantScopedExecutor,
  type TenantScopedWhere,
} from "./tenant-scoped-db";

interface ExecutableTenantTable extends SQLiteTable {
  id: SQLiteColumn;
  tenantId: SQLiteColumn;
}

interface DrizzleExpression {
  readonly expression: SQL;
}

const TENANT_TABLES = {
  applications,
  app_status_history: appStatusHistory,
  check_runs: checkRuns,
  match_candidates: matchCandidates,
  members,
  sessions,
  staff_users: staffUsers,
  status_history: statusHistory,
} satisfies Record<TenantScopedTable, SQLiteTable>;

function tableFor(name: TenantScopedTable): ExecutableTenantTable {
  return TENANT_TABLES[name] as ExecutableTenantTable;
}

function expressionFor(where: TenantScopedWhere, table: ExecutableTenantTable) {
  const tenantExpression = eq(table.tenantId, where.tenant.value);
  if (!where.additional) {
    return tenantExpression;
  }

  const additional = where.additional as unknown as DrizzleExpression;
  return and(tenantExpression, additional.expression);
}

function createExecutor(
  database: D1Database,
  trace?: OperationTrace,
): TenantScopedExecutor {
  const client = drizzle(database);

  return {
    async delete(tableName, where) {
      return executeOperation(
        trace,
        {
          component: "repository",
          completedStage: "repository.completed",
          errorType: "D1_OPERATION_FAILED",
          operation: `${tableName}.delete`,
          startedStage: "repository.executing",
          table: tableName,
        },
        async () => {
          const table = tableFor(tableName);
          const deleted = await client
            .delete(table)
            .where(expressionFor(where, table))
            .returning({ id: table.id });
          return deleted.length;
        },
      );
    },
    async insert<Row>(tableName: TenantScopedTable, values: Row) {
      return executeOperation(
        trace,
        {
          component: "repository",
          completedStage: "repository.completed",
          errorType: "D1_OPERATION_FAILED",
          operation: `${tableName}.insert`,
          startedStage: "repository.executing",
          table: tableName,
        },
        async () => {
          const table = tableFor(tableName);
          const inserted = await client
            .insert(table)
            .values(values as Record<string, unknown>)
            .returning();
          const row = inserted[0];
          if (!row) {
            throw new Error(`Failed to insert ${tableName}`);
          }
          return row as Row;
        },
      );
    },
    async select<Row>(tableName: TenantScopedTable, where: TenantScopedWhere) {
      return executeOperation(
        trace,
        {
          component: "repository",
          completedStage: "repository.completed",
          errorType: "D1_OPERATION_FAILED",
          operation: `${tableName}.select`,
          startedStage: "repository.executing",
          table: tableName,
        },
        async () => {
          const table = tableFor(tableName);
          const rows = await client
            .select()
            .from(table)
            .where(expressionFor(where, table));
          return rows as Row[];
        },
      );
    },
    async selectOne<Row>(
      tableName: TenantScopedTable,
      where: TenantScopedWhere,
    ) {
      return executeOperation(
        trace,
        {
          component: "repository",
          completedStage: "repository.completed",
          errorType: "D1_OPERATION_FAILED",
          operation: `${tableName}.selectOne`,
          startedStage: "repository.executing",
          table: tableName,
        },
        async () => {
          const table = tableFor(tableName);
          const rows = await client
            .select()
            .from(table)
            .where(expressionFor(where, table))
            .limit(1);
          return (rows[0] as Row | undefined) ?? null;
        },
      );
    },
    async update<Row extends { tenantId: string }>(
      tableName: TenantScopedTable,
      values: Partial<Omit<Row, "tenantId">>,
      where: TenantScopedWhere,
    ) {
      return executeOperation(
        trace,
        {
          component: "repository",
          completedStage: "repository.completed",
          errorType: "D1_OPERATION_FAILED",
          operation: `${tableName}.update`,
          startedStage: "repository.executing",
          table: tableName,
        },
        async () => {
          const table = tableFor(tableName);
          const updated = await client
            .update(table)
            .set(values as Record<string, unknown>)
            .where(expressionFor(where, table))
            .returning({ id: table.id });
          return updated.length;
        },
      );
    },
  } satisfies TenantScopedExecutor;
}

/**
 * 🔵 Intent: D1/Drizzleの生ハンドルを返さず、Task 001の境界を通した操作だけを公開する。
 */
export function createScopedDatabase(
  database: D1Database,
  tenantId: TenantId,
  trace?: OperationTrace,
): ScopedDb {
  return forTenant(tenantId, createExecutor(database, trace));
}

function drizzleWhere(expression: SQL): SqlExpr {
  return Object.freeze({ expression }) as unknown as SqlExpr;
}

export function whereEquals(
  tableName: TenantScopedTable,
  columnName: string,
  value: unknown,
): SqlExpr {
  const table = tableFor(tableName);
  if (!Object.hasOwn(table, columnName)) {
    throw new Error(`Unknown column: ${tableName}.${columnName}`);
  }
  const column = (table as unknown as Record<string, typeof table.id>)[
    columnName
  ];
  return drizzleWhere(eq(column, value));
}

export interface LoginFailureState {
  readonly failedLoginCount: number;
  readonly lockedUntil: string | null;
}

const STAFF_UPDATE_OPERATION = {
  component: "repository",
  completedStage: "repository.completed",
  errorType: "D1_OPERATION_FAILED",
  operation: "staff_users.update",
  startedStage: "repository.executing",
  table: "staff_users",
} as const;

/**
 * 🔵 Intent: F-1-6のロック満了解除を、読み取った値と完全一致するときだけ行う。
 * 並行リクエストが直前に張り直したロックを消さないためのcompare-and-swap。
 * `locked_until` が非NULLの場合だけ呼ばれるため、SQLiteのNULL比較を踏まない。
 */
export async function clearExpiredLoginLock(
  database: D1Database,
  tenantId: TenantId,
  staffUserId: StaffUserId,
  expiredLockedUntil: string,
  trace?: OperationTrace,
): Promise<void> {
  await executeOperation(trace, STAFF_UPDATE_OPERATION, async () => {
    const client = drizzle(database);
    await client
      .update(staffUsers)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(
        and(
          eq(staffUsers.tenantId, tenantId),
          eq(staffUsers.id, staffUserId),
          eq(staffUsers.lockedUntil, expiredLockedUntil),
        ),
      );
  });
}

/**
 * 🔵 Intent: 失敗回数の加算と上限判定を単一のUPDATEで行う（NF-2-39と同じ規律）。
 * 読み取ってから加算する実装では、並行リクエストがF-1-6のロックを回避できる。
 * `locked_until` のELSEを既存値にしてあるのが要点で、NULLにすると
 * 直前に別リクエストが張ったロックを消す別の回避経路が開く。
 */
export async function registerLoginFailure(
  database: D1Database,
  tenantId: TenantId,
  staffUserId: StaffUserId,
  input: { lockThreshold: number; lockedUntil: string },
  trace?: OperationTrace,
): Promise<LoginFailureState | null> {
  return executeOperation(trace, STAFF_UPDATE_OPERATION, async () => {
    const client = drizzle(database);
    // SQLiteはUPDATEの右辺を更新前の行に対して評価するため、
    // `failed_login_count + 1` はSET句とCASE句のどちらでも加算後の値になる。
    const rows = await client
      .update(staffUsers)
      .set({
        failedLoginCount: sql`${staffUsers.failedLoginCount} + 1`,
        lockedUntil: sql`CASE WHEN ${staffUsers.failedLoginCount} + 1 >= ${input.lockThreshold} THEN ${input.lockedUntil} ELSE ${staffUsers.lockedUntil} END`,
      })
      .where(
        and(eq(staffUsers.tenantId, tenantId), eq(staffUsers.id, staffUserId)),
      )
      .returning({
        failedLoginCount: staffUsers.failedLoginCount,
        lockedUntil: staffUsers.lockedUntil,
      });
    return rows[0] ?? null;
  });
}

/** 🔵 Intent: Tenant起動検証のD1読取も共通の例外追跡境界へ通す。 */
export async function tenantIds(
  database: D1Database,
  trace?: OperationTrace,
): Promise<string[]> {
  return executeOperation(
    trace,
    {
      component: "repository",
      completedStage: "repository.completed",
      errorType: "D1_OPERATION_FAILED",
      operation: "tenants.select",
      startedStage: "repository.executing",
      table: "tenants",
    },
    async () => {
      const client = drizzle(database);
      const rows = await client.select({ id: tenants.id }).from(tenants);
      return rows.map((row) => row.id);
    },
  );
}

export interface UsageCounterRow {
  readonly period: PeriodKey;
  readonly ocrPages: number;
  readonly geminiCalls: number;
}

const USAGE_COUNTER_OPERATION_BASE = {
  component: "repository",
  completedStage: "repository.completed",
  errorType: "D1_OPERATION_FAILED",
  startedStage: "repository.executing",
  table: "usage_counter",
} as const;

/**
 * 🔵 Intent: `usage_counter` はTenant非依存のためScopedDbを経由しない（ScopedDbのコメント参照）。
 * 読み取りのみで加算しない（GET /api/usageの契約）。行が無ければnullを返し、呼び出し元が0として扱う。
 */
export async function readUsageCounter(
  database: D1Database,
  period: PeriodKey,
  trace?: OperationTrace,
): Promise<UsageCounterRow | null> {
  return executeOperation(
    trace,
    { ...USAGE_COUNTER_OPERATION_BASE, operation: "usage_counter.selectOne" },
    async () => {
      const client = drizzle(database);
      const rows = await client
        .select()
        .from(usageCounter)
        .where(eq(usageCounter.period, period))
        .limit(1);
      return (rows[0] as UsageCounterRow | undefined) ?? null;
    },
  );
}

/**
 * 🔵 Intent: NF-2-39に従い、加算と上限判定を単一のUPSERTで行う（読み取り→判定→更新の3段階を禁止）。
 * 新しい期間キーは初回の値がそのまま初期行になる（0からの加算のためlimit>=1のとき常に成立・NF-2-35）。
 * 既存の期間キーは`ON CONFLICT DO UPDATE ... WHERE`で条件を満たすときだけ加算する。
 * SQLiteはWHERE不成立時にDO NOTHINGと同じ扱いになり、RETURNINGは行を返さない。
 * これを影響0行として呼び出し元（services/usage.ts）が上限到達の判断に使う。
 */
export async function incrementUsageCounter(
  database: D1Database,
  period: PeriodKey,
  column: "ocrPages" | "geminiCalls",
  limit: number,
  trace?: OperationTrace,
): Promise<UsageCounterRow | null> {
  return executeOperation(
    trace,
    { ...USAGE_COUNTER_OPERATION_BASE, operation: "usage_counter.update" },
    async () => {
      const client = drizzle(database);
      const returning = {
        geminiCalls: usageCounter.geminiCalls,
        ocrPages: usageCounter.ocrPages,
        period: usageCounter.period,
      };
      const rows =
        column === "ocrPages"
          ? await client
              .insert(usageCounter)
              .values({ geminiCalls: 0, ocrPages: 1, period })
              .onConflictDoUpdate({
                set: { ocrPages: sql`${usageCounter.ocrPages} + 1` },
                target: usageCounter.period,
                where: sql`${usageCounter.ocrPages} < ${limit}`,
              })
              .returning(returning)
          : await client
              .insert(usageCounter)
              .values({ geminiCalls: 1, ocrPages: 0, period })
              .onConflictDoUpdate({
                set: { geminiCalls: sql`${usageCounter.geminiCalls} + 1` },
                target: usageCounter.period,
                where: sql`${usageCounter.geminiCalls} < ${limit}`,
              })
              .returning(returning);
      return (rows[0] as UsageCounterRow | undefined) ?? null;
    },
  );
}

/** 🔵 Intent: Tenantシード登録も共通の例外追跡境界へ通し、失敗を上位へ再throwする。 */
export async function insertTenantIfAbsent(
  database: D1Database,
  values: typeof tenants.$inferInsert,
  trace?: OperationTrace,
): Promise<void> {
  await executeOperation(
    trace,
    {
      component: "repository",
      completedStage: "repository.completed",
      errorType: "D1_OPERATION_FAILED",
      operation: "tenants.insert",
      startedStage: "repository.executing",
      table: "tenants",
    },
    async () => {
      const client = drizzle(database);
      await client.insert(tenants).values(values).onConflictDoNothing();
    },
  );
}
