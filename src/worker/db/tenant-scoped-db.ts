import type {
  ScopedDb,
  ScopedWriteOp,
  SqlExpr,
  TenantId,
  TenantInsertValues,
  TenantRow,
  TenantScopedTable,
  TenantUpdateValues,
} from "../types";

export interface TenantPredicate {
  readonly column: "tenantId";
  readonly operator: "eq";
  readonly value: TenantId;
}

export interface TenantScopedWhere {
  readonly operator: "and";
  readonly tenant: TenantPredicate;
  readonly additional?: SqlExpr;
}

export interface TenantScopedExecutor {
  select<Row extends TenantRow>(
    table: TenantScopedTable,
    where: TenantScopedWhere,
  ): Promise<Row[]>;
  selectOne<Row extends TenantRow>(
    table: TenantScopedTable,
    where: TenantScopedWhere,
  ): Promise<Row | null>;
  insert<Row extends TenantRow>(
    table: TenantScopedTable,
    values: Row,
  ): Promise<Row>;
  update<Row extends TenantRow>(
    table: TenantScopedTable,
    values: TenantUpdateValues<Row>,
    where: TenantScopedWhere,
  ): Promise<number>;
  delete(table: TenantScopedTable, where: TenantScopedWhere): Promise<number>;
  prepareInsert<Row extends TenantRow>(
    table: TenantScopedTable,
    values: Row,
  ): ScopedWriteOp;
  prepareUpdate<Row extends TenantRow>(
    table: TenantScopedTable,
    values: TenantUpdateValues<Row>,
    where: TenantScopedWhere,
  ): ScopedWriteOp;
  prepareDelete(
    table: TenantScopedTable,
    where: TenantScopedWhere,
  ): ScopedWriteOp;
  batch(operations: readonly ScopedWriteOp[]): Promise<void>;
}

function scopedWhere(
  tenantId: TenantId,
  additional?: SqlExpr,
): TenantScopedWhere {
  const tenant = Object.freeze({
    column: "tenantId" as const,
    operator: "eq" as const,
    value: tenantId,
  });

  return Object.freeze({
    additional,
    operator: "and" as const,
    tenant,
  });
}

function withoutTenantId<Row extends TenantRow>(
  values: TenantUpdateValues<Row>,
): TenantUpdateValues<Row> {
  const { tenantId: _ignored, ...safeValues } = values as Record<
    string,
    unknown
  >;
  return safeValues as TenantUpdateValues<Row>;
}

/**
 * 🔵 Intent: tenantIdを閉じ込め、全操作を加算的なテナント条件付きでexecutorへ渡す。
 * executorの具体的なDrizzle/D1接続はTask 002で実装する。
 */
export function forTenant(
  tenantId: TenantId,
  executor: TenantScopedExecutor,
): ScopedDb {
  if (tenantId.trim().length === 0) {
    throw new Error("tenantId must not be empty");
  }

  return Object.freeze({
    batch: (operations: readonly ScopedWriteOp[]) => executor.batch(operations),
    delete: (table, where) =>
      executor.delete(table, scopedWhere(tenantId, where)),
    insert: <Row extends TenantRow>(
      table: TenantScopedTable,
      values: TenantInsertValues<Row>,
    ) =>
      executor.insert<Row>(table, {
        ...values,
        tenantId,
      } as Row),
    prepareInsert: <Row extends TenantRow>(
      table: TenantScopedTable,
      values: TenantInsertValues<Row>,
    ) =>
      executor.prepareInsert<Row>(table, {
        ...values,
        tenantId,
      } as Row),
    prepareUpdate: <Row extends TenantRow>(
      table: TenantScopedTable,
      values: TenantUpdateValues<Row>,
      where: SqlExpr,
    ) =>
      executor.prepareUpdate<Row>(
        table,
        withoutTenantId<Row>(values),
        scopedWhere(tenantId, where),
      ),
    prepareDelete: (table: TenantScopedTable, where: SqlExpr) =>
      executor.prepareDelete(table, scopedWhere(tenantId, where)),
    select: <Row extends TenantRow>(
      table: TenantScopedTable,
      where?: SqlExpr,
    ) => executor.select<Row>(table, scopedWhere(tenantId, where)),
    selectOne: <Row extends TenantRow>(
      table: TenantScopedTable,
      where: SqlExpr,
    ) => executor.selectOne<Row>(table, scopedWhere(tenantId, where)),
    update: <Row extends TenantRow>(
      table: TenantScopedTable,
      values: TenantUpdateValues<Row>,
      where: SqlExpr,
    ) =>
      executor.update<Row>(
        table,
        withoutTenantId<Row>(values),
        scopedWhere(tenantId, where),
      ),
  } satisfies ScopedDb);
}

/**
 * 🔵 Intent: Task 002のTenantRepository.forTenantへ、そのまま委譲できる関数を生成する。
 */
export function createForTenant(
  executor: TenantScopedExecutor,
): (tenantId: TenantId) => ScopedDb {
  return (tenantId) => forTenant(tenantId, executor);
}
