import type { OperationTrace } from "../observability/operation-trace";
import type {
  AppConfig,
  ScopedDb,
  SqlExpr,
  TenantId,
  TenantRow,
  TenantScopedTable,
} from "../types";
import { createScopedDatabase, tenantIds, whereEquals } from "./client";
import type {
  applications,
  appStatusHistory,
  checkRuns,
  matchCandidates,
  members,
  sessions,
  staffUsers,
  statusHistory,
} from "./schema";

type WithoutTenant<Value extends TenantRow> = Omit<Value, "tenantId">;

export interface TableRepository<
  Row extends TenantRow,
  Insert extends TenantRow,
> {
  all(): Promise<Row[]>;
  findOne(where: SqlExpr): Promise<Row | null>;
  insert(values: WithoutTenant<Insert>): Promise<Row>;
  update(values: Partial<WithoutTenant<Row>>, where: SqlExpr): Promise<number>;
  delete(where: SqlExpr): Promise<number>;
}

export interface TenantScopedRepositories {
  readonly applications: TableRepository<
    typeof applications.$inferSelect,
    typeof applications.$inferInsert
  >;
  readonly appStatusHistory: TableRepository<
    typeof appStatusHistory.$inferSelect,
    typeof appStatusHistory.$inferInsert
  >;
  readonly checkRuns: TableRepository<
    typeof checkRuns.$inferSelect,
    typeof checkRuns.$inferInsert
  >;
  readonly matchCandidates: TableRepository<
    typeof matchCandidates.$inferSelect,
    typeof matchCandidates.$inferInsert
  >;
  readonly members: TableRepository<
    typeof members.$inferSelect,
    typeof members.$inferInsert
  >;
  readonly sessions: TableRepository<
    typeof sessions.$inferSelect,
    typeof sessions.$inferInsert
  >;
  readonly staffUsers: TableRepository<
    typeof staffUsers.$inferSelect,
    typeof staffUsers.$inferInsert
  >;
  readonly statusHistory: TableRepository<
    typeof statusHistory.$inferSelect,
    typeof statusHistory.$inferInsert
  >;
}

export interface TenantRepository {
  forTenant(tenantId: TenantId): TenantScopedRepositories;
}

type TenantTableRows = {
  applications: typeof applications.$inferSelect;
  app_status_history: typeof appStatusHistory.$inferSelect;
  check_runs: typeof checkRuns.$inferSelect;
  match_candidates: typeof matchCandidates.$inferSelect;
  members: typeof members.$inferSelect;
  sessions: typeof sessions.$inferSelect;
  staff_users: typeof staffUsers.$inferSelect;
  status_history: typeof statusHistory.$inferSelect;
};

function tableRepository<Row extends TenantRow, Insert extends TenantRow>(
  scopedDatabase: ScopedDb,
  table: TenantScopedTable,
): TableRepository<Row, Insert> {
  return Object.freeze({
    all: () => scopedDatabase.select<Row>(table),
    delete: (where: SqlExpr) => scopedDatabase.delete(table, where),
    findOne: (where: SqlExpr) => scopedDatabase.selectOne<Row>(table, where),
    insert: (values: WithoutTenant<Insert>) =>
      scopedDatabase.insert<Row>(
        table,
        values as unknown as WithoutTenant<Row>,
      ),
    update: (values: Partial<WithoutTenant<Row>>, where: SqlExpr) =>
      scopedDatabase.update<Row>(table, values, where),
  });
}

function scopedRepositories(
  scopedDatabase: ScopedDb,
): TenantScopedRepositories {
  return Object.freeze({
    applications: tableRepository<
      typeof applications.$inferSelect,
      typeof applications.$inferInsert
    >(scopedDatabase, "applications"),
    appStatusHistory: tableRepository<
      typeof appStatusHistory.$inferSelect,
      typeof appStatusHistory.$inferInsert
    >(scopedDatabase, "app_status_history"),
    checkRuns: tableRepository<
      typeof checkRuns.$inferSelect,
      typeof checkRuns.$inferInsert
    >(scopedDatabase, "check_runs"),
    matchCandidates: tableRepository<
      typeof matchCandidates.$inferSelect,
      typeof matchCandidates.$inferInsert
    >(scopedDatabase, "match_candidates"),
    members: tableRepository<
      typeof members.$inferSelect,
      typeof members.$inferInsert
    >(scopedDatabase, "members"),
    sessions: tableRepository<
      typeof sessions.$inferSelect,
      typeof sessions.$inferInsert
    >(scopedDatabase, "sessions"),
    staffUsers: tableRepository<
      typeof staffUsers.$inferSelect,
      typeof staffUsers.$inferInsert
    >(scopedDatabase, "staff_users"),
    statusHistory: tableRepository<
      typeof statusHistory.$inferSelect,
      typeof statusHistory.$inferInsert
    >(scopedDatabase, "status_history"),
  });
}

/** 🔵 Intent: 生D1を閉じ込め、任意の処理トレースを全テナント操作へ明示的に伝播する。 */
export function createTenantRepository(
  database: D1Database,
  trace?: OperationTrace,
): TenantRepository {
  return Object.freeze({
    forTenant: (tenantId: TenantId) =>
      scopedRepositories(createScopedDatabase(database, tenantId, trace)),
  });
}

/**
 * 🔵 Intent: 設定先Tenantの存在とMVPの単一Tenant不変条件を利用開始前にfail closedで検証する。
 */
export async function initializeTenantRepository(
  database: D1Database,
  config: AppConfig,
  trace?: OperationTrace,
): Promise<TenantRepository> {
  const storedTenantIds = await tenantIds(database, trace);
  if (!storedTenantIds.includes(config.tenantId)) {
    throw new Error("TENANT_ID does not reference an existing Tenant");
  }
  if (storedTenantIds.length !== 1) {
    throw new Error("MVP database must contain exactly one Tenant");
  }
  return createTenantRepository(database, trace);
}

/** 🔵 Intent: 外部値をSQL文字列へ連結せず、型付きDrizzle列との等価条件へ変換する。 */
export function whereFieldEquals<
  Table extends TenantScopedTable,
  Column extends keyof TenantTableRows[Table] & string,
>(
  tableName: Table,
  columnName: Column,
  value: TenantTableRows[Table][Column],
): SqlExpr {
  return whereEquals(tableName, columnName, value);
}
