import { and, eq, type SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  executeOperation,
  type OperationTrace,
} from "../observability/operation-trace";
import type {
  ApplicationId,
  MatchCandidateId,
  ScopedDb,
  ScopedWriteOp,
  SqlExpr,
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

interface PendingBatchItem {
  readonly query: unknown;
}

/**
 * 🔵 Intent: `ScopedWriteOp`はSqlExprと同じ「不透明なマーカー型」。ここでだけ
 * 実際のDrizzleクエリビルダ(未実行)を出し入れする。実行を伴わずbuildだけ行うことで、
 * 複数の書き込みを`client.batch()`(D1の単一トランザクション)へまとめて渡せる。
 */
function wrapBatchItem(query: unknown): ScopedWriteOp {
  return Object.freeze({ query }) as unknown as ScopedWriteOp;
}

function unwrapBatchItem(operation: ScopedWriteOp): unknown {
  return (operation as unknown as PendingBatchItem).query;
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
    async batch(operations) {
      if (operations.length === 0) {
        return;
      }
      return executeOperation(
        trace,
        {
          component: "repository",
          completedStage: "repository.completed",
          errorType: "D1_OPERATION_FAILED",
          operation: "repository.batch",
          startedStage: "repository.executing",
        },
        async () => {
          const queries = operations.map(unwrapBatchItem) as [
            unknown,
            ...unknown[],
          ];
          await client.batch(
            queries as unknown as Parameters<typeof client.batch>[0],
          );
        },
      );
    },
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
    prepareInsert<Row>(tableName: TenantScopedTable, values: Row) {
      const table = tableFor(tableName);
      return wrapBatchItem(
        client.insert(table).values(values as Record<string, unknown>),
      );
    },
    prepareUpdate<Row extends { tenantId: string }>(
      tableName: TenantScopedTable,
      values: Partial<Omit<Row, "tenantId">>,
      where: TenantScopedWhere,
    ) {
      const table = tableFor(tableName);
      return wrapBatchItem(
        client
          .update(table)
          .set(values as Record<string, unknown>)
          .where(expressionFor(where, table)),
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

/**
 * 🔵 Intent: コードレビュー指摘。同一申請で2件のdecideMatch(merged)がほぼ同時に来ると、
 * 「既存merged行をJS側でSELECTしてから戻す」実装では両方が「まだmergedは無い」を読んで
 * しまい、merged行が2件残る（merged/rejected/staleは再判断不可のため以後直せない）。
 * reserveCheckRunSlot・incrementUsageCounterと同じ理由で事前SELECTを避け、
 * このSqlExprをUPDATEのWHEREへ埋め込む1文にする。batch実行時点でDB上に実在する
 * merged行だけが対象になるため、ほぼ同時に書き込まれても後続のUPDATEが必ず先行分を拾う。
 */
export function whereOtherMergedMatchCandidates(
  applicationId: ApplicationId,
  excludeCandidateId: MatchCandidateId,
): SqlExpr {
  return drizzleWhere(
    sql`${matchCandidates.applicationId} = ${applicationId} AND ${matchCandidates.status} = 'merged' AND ${matchCandidates.id} != ${excludeCandidateId}`,
  );
}
