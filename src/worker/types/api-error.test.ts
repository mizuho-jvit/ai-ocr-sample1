import { describe, expect, it } from "vitest";

import { toApiError } from "./api-error";

describe("toApiError", () => {
  it("does not expose an unexpected error message", () => {
    const secret = "super-secret-api-key";

    const apiError = toApiError(new Error(`provider failed with ${secret}`));

    expect(apiError.error.code).toBe("INTERNAL");
    expect(JSON.stringify(apiError)).not.toContain(secret);
  });
});
