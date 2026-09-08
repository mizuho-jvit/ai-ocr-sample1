import { describe, expect, it } from "vitest";
import { whereAll, whereEquals } from "../../../src/worker/db/client";

describe("whereAll (決定#49・F-9-11)", () => {
  it("builds a predicate without throwing", () => {
    expect(() => whereAll()).not.toThrow();
  });
});

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
