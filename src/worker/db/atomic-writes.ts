import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  executeOperation,
  type OperationTrace,
} from "../observability/operation-trace";
import type { ApplicationId, PeriodKey, StaffUserId, TenantId } from "../types";
import {
  applications,
  members,
  staffUsers,
  tenants,
  usageCounter,
} from "./schema";

/**
 * 🔵 Intent: このファイルは「読み取ってから書く」実装だと並行リクエストで不変条件が破れる
 * 操作（ログイン失敗ロック・CheckRun上限・会員番号連番・月次利用量上限）を、単一のSQL文
 * （条件付きUPDATE・INSERT ... ON CONFLICT・サブクエリ埋め込みINSERT）へ閉じ込めて集約する。
 * `client.ts`の汎用`ScopedDb`実装から独立させ、責務（不変条件を守る単一文）で分割した。
 */

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

export interface CheckRunReservation {
  readonly checkRunCount: number;
}

/**
 * 🔵 Intent: コードレビュー指摘#3（Task 009）。NF-2-21の1申請あたりのCheckRun上限を、
 * usage_counter（NF-2-39・incrementUsageCounter）と同じ「単一の条件付きUPDATE」で
 * 予約する。件数を読み取ってから判定・AI呼び出し・保存という3段階にすると、上限直前で
 * 並行した2リクエストがどちらも判定を通過してしまう。ここではAI呼び出しの前に
 * `applications.check_run_count`を`WHERE check_run_count < limit`付きで加算し、
 * 影響0行(RETURNINGが空)を上限到達として呼び出し元がCHECK_RUN_LIMIT(409)へ変換する。
 */
export async function reserveCheckRunSlot(
  database: D1Database,
  tenantId: TenantId,
  applicationId: ApplicationId,
  limit: number,
  trace?: OperationTrace,
): Promise<CheckRunReservation | null> {
  return executeOperation(
    trace,
    {
      component: "repository",
      completedStage: "repository.completed",
      errorType: "D1_OPERATION_FAILED",
      operation: "applications.update",
      startedStage: "repository.executing",
      table: "applications",
    },
    async () => {
      const client = drizzle(database);
      const rows = await client
        .update(applications)
        .set({ checkRunCount: sql`${applications.checkRunCount} + 1` })
        .where(
          and(
            eq(applications.tenantId, tenantId),
            eq(applications.id, applicationId),
            sql`${applications.checkRunCount} < ${limit}`,
          ),
        )
        .returning({ checkRunCount: applications.checkRunCount });
      return rows[0] ?? null;
    },
  );
}

/**
 * 🔵 Intent: NF-5-20の「テナント内`MAX + 1`連番」を、reserveCheckRunSlot・incrementUsageCounterと
 * 同じ「読み取ってから書く」を避ける単一文で実現する。`memberNumber`はTEXT列だが、
 * サブクエリを`INSERT ... VALUES`のカラム値として埋め込むことで、採番と行の作成をSQLite上の
 * 1つの書き込み文に閉じ込める。同時に2件のINSERTが来てもSQLiteは書き込みをシリアライズするため、
 * 後発の文は先発が確定させた行を含めて`MAX`を評価し、`UNIQUE(tenantId, memberNumber)`の衝突が起きない。
 */
export async function insertMemberWithNextNumber(
  database: D1Database,
  tenantId: TenantId,
  values: Omit<typeof members.$inferInsert, "tenantId" | "memberNumber">,
  trace?: OperationTrace,
): Promise<typeof members.$inferSelect> {
  return executeOperation(
    trace,
    {
      component: "repository",
      completedStage: "repository.completed",
      errorType: "D1_OPERATION_FAILED",
      operation: "members.insert",
      startedStage: "repository.executing",
      table: "members",
    },
    async () => {
      const client = drizzle(database);
      const nextMemberNumber = sql`(SELECT CAST(COALESCE(MAX(CAST(${members.memberNumber} AS INTEGER)), 0) + 1 AS TEXT) FROM ${members} WHERE ${members.tenantId} = ${tenantId})`;
      const inserted = await client
        .insert(members)
        .values({
          ...values,
          memberNumber: nextMemberNumber,
          tenantId,
        } as unknown as typeof members.$inferInsert)
        .returning();
      const row = inserted[0];
      if (!row) {
        throw new Error("Failed to insert members");
      }
      return row;
    },
  );
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
