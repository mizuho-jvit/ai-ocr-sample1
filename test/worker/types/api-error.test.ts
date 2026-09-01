import { describe, expect, it } from "vitest";

import {
  ApiErrorException,
  apiErrorStatus,
  toApiError,
} from "../../../src/worker/types/api-error";

describe("toApiError", () => {
  it("does not expose an unexpected error message", () => {
    const secret = "super-secret-api-key";

    const apiError = toApiError(new Error(`provider failed with ${secret}`));

    expect(apiError.error.code).toBe("INTERNAL");
    expect(JSON.stringify(apiError)).not.toContain(secret);
  });

  it("converts USAGE_LIMIT_EXCEEDED to a 429 with the NF-2-20 guidance", () => {
    const error = new ApiErrorException("USAGE_LIMIT_EXCEEDED");

    expect(apiErrorStatus(error)).toBe(429);
    const apiError = toApiError(error);
    expect(apiError.error.code).toBe("USAGE_LIMIT_EXCEEDED");
    // NF-2-20: 上限に達した旨と、翌月まで待つか上限引き上げ(再デプロイ)が必要である旨を含める。
    expect(apiError.error.message).toContain("上限に達しました");
    expect(apiError.error.message).toContain("翌月");
    expect(apiError.error.message).toMatch(/引き上げ.*再デプロイ/);
  });
});
