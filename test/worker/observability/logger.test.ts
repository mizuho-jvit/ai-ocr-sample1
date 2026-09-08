import { describe, expect, it, vi } from "vitest";

import {
  emitDemoResetLog,
  emitRequestLog,
} from "../../../src/worker/observability/logger";
import {
  createOperationTrace,
  recordOperationFailure,
} from "../../../src/worker/observability/operation-trace";
import { toStaffUserId } from "../../../src/worker/types";

describe("structured logger", () => {
  it("emits at most one safe structured event per request", () => {
    const trace = createOperationTrace(
      new Request("https://example.test/api/members?secret=query-value", {
        headers: {
          Authorization: "Basic super-secret-authorization",
          Cookie: "session=super-secret-cookie",
        },
      }),
    );
    recordOperationFailure(trace, {
      component: "repository",
      errorType: "D1_OPERATION_FAILED",
      failedStage: "repository.executing",
      operation: "members.select",
      table: "members",
    });
    const sink = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };

    emitRequestLog(
      trace,
      {
        errorCode: "INTERNAL",
        httpMethod: "GET",
        httpStatus: 500,
        routePattern: "/api/members",
      },
      sink,
    );
    emitRequestLog(
      trace,
      {
        errorCode: "INTERNAL",
        httpMethod: "GET",
        httpStatus: 500,
        routePattern: "/api/members",
      },
      sink,
    );

    expect(sink.error).toHaveBeenCalledOnce();
    expect(sink.warn).not.toHaveBeenCalled();
    expect(sink.info).not.toHaveBeenCalled();
    const serialized = JSON.stringify(sink.error.mock.calls[0]?.[0]);
    expect(serialized).toContain("D1_OPERATION_FAILED");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("query-value");
    expect(serialized).not.toContain("error.message");
  });

  it("does not let a logging failure change application control flow", () => {
    const trace = createOperationTrace(new Request("https://example.test/"));
    recordOperationFailure(trace, {
      component: "worker",
      errorType: "INTERNAL",
      failedStage: "route.executing",
      operation: "request.handle",
    });
    const sink = {
      error: vi.fn(() => {
        throw new Error("logging unavailable");
      }),
      info: vi.fn(),
      warn: vi.fn(),
    };

    expect(() =>
      emitRequestLog(
        trace,
        {
          errorCode: "INTERNAL",
          httpMethod: "GET",
          httpStatus: 500,
        },
        sink,
      ),
    ).not.toThrow();
    expect(trace.customLogEmitted).toBe(true);
  });

  it("does not emit custom logs for routine 4xx responses", () => {
    const trace = createOperationTrace(new Request("https://example.test/"));
    const sink = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };

    emitRequestLog(
      trace,
      {
        errorCode: "UNAUTHENTICATED",
        httpMethod: "GET",
        httpStatus: 401,
      },
      sink,
    );

    expect(sink.error).not.toHaveBeenCalled();
    expect(sink.warn).not.toHaveBeenCalled();
  });
});

describe("emitDemoResetLog (F-9-10)", () => {
  it("emits a single info event with the execution fact and delete counts", () => {
    const sink = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

    emitDemoResetLog(
      {
        deletedApplications: 3,
        deletedImages: 2,
        deletedMembers: 1,
        executedById: toStaffUserId("staff-1"),
        outcome: "success",
      },
      sink,
    );

    expect(sink.info).toHaveBeenCalledOnce();
    const event = sink.info.mock.calls[0]?.[0];
    expect(event).toMatchObject({
      deletedApplications: 3,
      deletedImages: 2,
      deletedMembers: 1,
      event: "demo_reset.completed",
      executedById: "staff-1",
      level: "info",
    });
  });

  // コードレビュー指摘・P2・決定#52: R2削除が途中で失敗しても、D1を削除した事実
  // （実行者・D1側の削除件数）を失わずに記録する。
  it("emits an error-level event with the D1-confirmed counts when R2 deletion only partially completed", () => {
    const sink = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

    emitDemoResetLog(
      {
        deletedApplications: 3,
        deletedImages: 1,
        deletedMembers: 1,
        executedById: toStaffUserId("staff-1"),
        outcome: "partial_failure",
      },
      sink,
    );

    expect(sink.error).toHaveBeenCalledOnce();
    expect(sink.info).not.toHaveBeenCalled();
    const event = sink.error.mock.calls[0]?.[0];
    expect(event).toMatchObject({
      deletedApplications: 3,
      deletedImages: 1,
      deletedMembers: 1,
      event: "demo_reset.failed",
      executedById: "staff-1",
      level: "error",
    });
  });

  it("does not let a logging failure change application control flow", () => {
    const sink = {
      error: vi.fn(),
      info: vi.fn(() => {
        throw new Error("logging unavailable");
      }),
      warn: vi.fn(),
    };

    expect(() =>
      emitDemoResetLog(
        {
          deletedApplications: 0,
          deletedImages: 0,
          deletedMembers: 0,
          executedById: toStaffUserId("staff-1"),
          outcome: "success",
        },
        sink,
      ),
    ).not.toThrow();
  });
});
