import { describe, expect, it, vi } from "vitest";

import {
  createOperationTrace,
  executeOperation,
  finalizeOperationTrace,
} from "./operation-trace";

describe("operation trace", () => {
  it("records the last completed and failed stages and always finalizes", async () => {
    const trace = createOperationTrace(
      new Request("https://example.test/api/members", {
        headers: { "cf-ray": "test-ray" },
      }),
    );
    const failure = new Error("database included super-secret-value");
    const operation = vi.fn(async () => {
      throw failure;
    });

    await expect(
      executeOperation(
        trace,
        {
          component: "repository",
          completedStage: "repository.completed",
          errorType: "D1_OPERATION_FAILED",
          operation: "members.select",
          startedStage: "repository.executing",
          table: "members",
        },
        operation,
      ),
    ).rejects.toBe(failure);

    finalizeOperationTrace(trace, "request.failed");

    expect(operation).toHaveBeenCalledOnce();
    expect(trace.cfRay).toBe("test-ray");
    expect(trace.failure).toEqual(
      expect.objectContaining({
        component: "repository",
        errorType: "D1_OPERATION_FAILED",
        failedStage: "repository.executing",
        operation: "members.select",
        table: "members",
      }),
    );
    expect(trace.lastCompletedStage).toBeUndefined();
    expect(trace.finalStage).toBe("request.failed");
    expect(trace.lastOperationDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("updates the last completed stage after a successful operation", async () => {
    const trace = createOperationTrace(
      new Request("https://example.test/api/members"),
    );

    await expect(
      executeOperation(
        trace,
        {
          component: "repository",
          completedStage: "repository.completed",
          errorType: "D1_OPERATION_FAILED",
          operation: "members.select",
          startedStage: "repository.executing",
          table: "members",
        },
        async () => "ok",
      ),
    ).resolves.toBe("ok");

    expect(trace.lastCompletedStage).toBe("repository.completed");
    expect(trace.failure).toBeUndefined();
  });
});
