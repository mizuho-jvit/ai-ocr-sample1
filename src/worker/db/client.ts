import { and, eq, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  executeOperation,
  type OperationTrace,
} from "../observability/operation-trace";
import type { ScopedDb, SqlExpr, TenantId, TenantScopedTable } from "../types";
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
