import type { ErrorCode } from "../types";
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
