import { describe, expect, it, vi } from "vitest";

import { emitRequestLog } from "./logger";
import {
  createOperationTrace,
  recordOperationFailure,
} from "./operation-trace";

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
