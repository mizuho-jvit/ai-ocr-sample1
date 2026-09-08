import type { ErrorCode, StaffUserId } from "../types";
import type { OperationTrace } from "./operation-trace";

export interface LogSink {
  error(event: unknown): void;
  info(event: unknown): void;
  warn(event: unknown): void;
}

export interface RequestLogInput {
  readonly errorCode: ErrorCode;
  readonly httpMethod: string;
  readonly httpStatus: number;
  readonly routePattern?: string;
}

export interface SystemLogEvent {
  readonly schemaVersion: 1;
  readonly event: "request.failed" | "request.rate_limited";
  readonly level: "error" | "warn";
  readonly occurredAt: string;
  readonly requestId: string;
  readonly cfRay?: string;
  readonly component: string;
  readonly operation: string;
  readonly outcome: "failure" | "rejected";
  readonly failedStage: string;
  readonly lastCompletedStage?: string;
  readonly durationMs: number;
  readonly httpMethod: string;
  readonly routePattern?: string;
  readonly httpStatus: number;
  readonly errorCode: ErrorCode;
  readonly errorType: string;
  readonly retryable: boolean;
  readonly table?: string;
}

function shouldEmit(httpStatus: number): boolean {
  return httpStatus === 429 || httpStatus >= 500;
}

/** 🔵 Intent: LOG-4〜8に従い、許可済みフィールドだけを1リクエスト最大1件出力する。 */
export function emitRequestLog(
  trace: OperationTrace,
  input: RequestLogInput,
  sink: LogSink = console,
): void {
  if (trace.customLogEmitted || !shouldEmit(input.httpStatus)) {
    return;
  }

  trace.customLogEmitted = true;
  const failure = trace.failure;
  const level = input.httpStatus === 429 ? "warn" : "error";
  const event: SystemLogEvent = Object.freeze({
    ...(trace.cfRay ? { cfRay: trace.cfRay } : {}),
    component: failure?.component ?? "worker",
    durationMs: Math.max(0, performance.now() - trace.startedAt),
    errorCode: input.errorCode,
    errorType: failure?.errorType ?? "INTERNAL",
    event: input.httpStatus === 429 ? "request.rate_limited" : "request.failed",
    failedStage: failure?.failedStage ?? trace.currentStage,
    httpMethod: input.httpMethod,
    httpStatus: input.httpStatus,
    ...(trace.lastCompletedStage
      ? { lastCompletedStage: trace.lastCompletedStage }
      : {}),
    level,
    occurredAt: new Date().toISOString(),
    operation: failure?.operation ?? "request.handle",
    outcome: input.httpStatus === 429 ? "rejected" : "failure",
    requestId: trace.requestId,
    retryable: input.errorCode === "AI_UNAVAILABLE",
    ...(input.routePattern ? { routePattern: input.routePattern } : {}),
    schemaVersion: 1,
    ...(failure?.table ? { table: failure.table } : {}),
  });

  try {
    sink[level](event);
  } catch {
    // LOG-11: 可観測性障害で本来の業務処理やエラー応答を変更しない。
  } finally {
    trace.customLogEmitted = true;
  }
}

export interface DemoResetLogEvent {
  readonly schemaVersion: 1;
  readonly event: "demo_reset.completed" | "demo_reset.failed";
  readonly level: "info" | "error";
  readonly occurredAt: string;
  readonly executedById: StaffUserId;
  readonly deletedApplications: number;
  readonly deletedImages: number;
  readonly deletedMembers: number;
}

export interface DemoResetLogInput {
  readonly executedById: StaffUserId;
  readonly deletedApplications: number;
  readonly deletedImages: number;
  readonly deletedMembers: number;
  /**
   * 🟡 Intent: コードレビュー指摘・P2・決定#52。"success"はD1・R2とも完了した通常経路。
   * "partial_failure"はD1（②）は確定したがR2（③）の削除が途中で失敗した経路で、
   * `deletedImages`にはR2側でそこまでに確定した件数を渡す。いずれもF-9-10の対象。
   */
  readonly outcome: "success" | "partial_failure";
}

/**
 * 🟡 Intent: F-9-10。実行の事実（実行者・日時・削除件数）だけを1件出力する例外ログ。
 * LOG-5「正常リクエストはInvocation Logのみ」が前提とする監査手段
 * （`createdById`/`updatedById`等の更新記録列）は、削除対象の行そのものが消える
 * デモリセットでは機能しないため、F-9はこの一般則の対象外として明示的にログを出す
 * （削除対象のテーブルには記録しない・F-9-10）。**R2削除が途中で失敗しD1だけ確定した
 * 場合も`outcome: "partial_failure"`で必ず記録し、「D1を削除した事実」を失わない**
 * （コードレビュー指摘・P2・決定#52）。個人情報・帳票・SQL値は含めない(LOG-8)。
 */
export function emitDemoResetLog(
  input: DemoResetLogInput,
  sink: LogSink = console,
): void {
  const level = input.outcome === "success" ? "info" : "error";
  const event: DemoResetLogEvent = Object.freeze({
    deletedApplications: input.deletedApplications,
    deletedImages: input.deletedImages,
    deletedMembers: input.deletedMembers,
    event:
      input.outcome === "success"
        ? "demo_reset.completed"
        : "demo_reset.failed",
    executedById: input.executedById,
    level,
    occurredAt: new Date().toISOString(),
    schemaVersion: 1,
  });

  try {
    sink[level](event);
  } catch {
    // LOG-11: 可観測性障害で本来の業務処理を変更しない。
  }
}
