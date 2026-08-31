import type { TenantScopedTable } from "../types";

export type OperationComponent =
  | "worker"
  | "auth"
  | "repository"
  | "r2"
  | "ocr"
  | "ai"
  | "admin";

export type OperationErrorType =
  | "CONFIG_INVALID"
  | "D1_OPERATION_FAILED"
  | "R2_OPERATION_FAILED"
  | "AI_UNAVAILABLE"
  | "USAGE_LIMIT_EXCEEDED"
  | "INTERNAL";

export type OperationStage =
  | "request.received"
  | "config.validating"
  | "config.validated"
  | "tenant.initializing"
  | "tenant.initialized"
  | "route.executing"
  | "repository.executing"
  | "repository.completed"
  | "response.created"
  | "request.failed";

type DatabaseTable = TenantScopedTable | "tenants";
type DatabaseAction = "select" | "selectOne" | "insert" | "update" | "delete";

export type OperationName =
  | "request.handle"
  | "config.load"
  | "tenant.initialize"
  | `${DatabaseTable}.${DatabaseAction}`;

export interface OperationMetadata {
  readonly component: OperationComponent;
  readonly completedStage: OperationStage;
  readonly errorType: OperationErrorType;
  readonly operation: OperationName;
  readonly startedStage: OperationStage;
  readonly table?: DatabaseTable;
}

export interface OperationFailure {
  readonly component: OperationComponent;
  readonly errorType: OperationErrorType;
  readonly failedStage: OperationStage;
  readonly operation: OperationName;
  readonly table?: DatabaseTable;
}

export interface OperationTrace {
  readonly cfRay?: string;
  readonly requestId: string;
  readonly startedAt: number;
  currentStage: OperationStage;
  customLogEmitted: boolean;
  failure?: OperationFailure;
  finalStage?: OperationStage;
  lastCompletedStage?: OperationStage;
  lastOperationDurationMs: number;
}

/** 🔵 Intent: LOG-4の1リクエスト単位ログ制御と処理段階追跡に使う状態を生成する。 */
export function createOperationTrace(request: Request): OperationTrace {
  const cfRay = request.headers.get("cf-ray") ?? undefined;
  return {
    ...(cfRay ? { cfRay } : {}),
    currentStage: "request.received",
    customLogEmitted: false,
    lastOperationDurationMs: 0,
    requestId: crypto.randomUUID(),
    startedAt: performance.now(),
  };
}

/** 🔵 Intent: 最初に失敗した最深部の安全な位置だけを保持し、上位層で上書きしない。 */
export function recordOperationFailure(
  trace: OperationTrace,
  failure: OperationFailure,
): void {
  if (trace.failure) {
    return;
  }
  trace.failure = Object.freeze({ ...failure });
  trace.currentStage = failure.failedStage;
}

/** 🔵 Intent: LOG-1〜3に従い、外部I/O境界をtry/catch/finallyで追跡して例外を再throwする。 */
export async function executeOperation<Result>(
  trace: OperationTrace | undefined,
  metadata: OperationMetadata,
  operation: () => Result | Promise<Result>,
): Promise<Result> {
  const startedAt = performance.now();
  if (trace) {
    trace.currentStage = metadata.startedStage;
  }

  try {
    const result = await operation();
    if (trace) {
      trace.currentStage = metadata.completedStage;
      trace.lastCompletedStage = metadata.completedStage;
    }
    return result;
  } catch (error) {
    if (trace) {
      recordOperationFailure(trace, {
        component: metadata.component,
        errorType: metadata.errorType,
        failedStage: metadata.startedStage,
        operation: metadata.operation,
        ...(metadata.table ? { table: metadata.table } : {}),
      });
    }
    throw error;
  } finally {
    if (trace) {
      trace.lastOperationDurationMs = Math.max(
        0,
        performance.now() - startedAt,
      );
    }
  }
}

/** 🔵 Intent: LOG-3に従い、成功・失敗の最終段階をfinallyから確定できるようにする。 */
export function finalizeOperationTrace(
  trace: OperationTrace,
  finalStage: "response.created" | "request.failed",
): void {
  trace.finalStage = finalStage;
  trace.currentStage = finalStage;
}
