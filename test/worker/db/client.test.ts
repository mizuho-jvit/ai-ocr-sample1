import { describe, expect, it } from "vitest";
import { whereEquals } from "../../../src/worker/db/client";

describe("whereEquals", () => {
  it("builds a predicate for a real column", () => {
    expect(() => whereEquals("members", "id", "member-1")).not.toThrow();
  });

  it("rejects names inherited from Object.prototype instead of matching a column", () => {
    expect(() => whereEquals("members", "constructor", "x")).toThrowError(
      "Unknown column: members.constructor",
    );
    expect(() => whereEquals("members", "toString", "x")).toThrowError(
      "Unknown column",
    );
  });

  it("rejects an unknown column name", () => {
    expect(() => whereEquals("members", "doesNotExist", "x")).toThrowError(
      "Unknown column: members.doesNotExist",
    );
  });
});
