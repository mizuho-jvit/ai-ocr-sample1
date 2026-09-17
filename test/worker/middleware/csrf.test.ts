import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { csrfGuard } from "../../../src/worker/middleware/csrf";

function createHarness() {
  const app = new Hono();
  app.onError((error) => {
    const code = (error as { code?: string }).code ?? "INTERNAL";
    const status = code === "FORBIDDEN" ? 403 : 500;
    return new Response(JSON.stringify({ code }), { status });
  });
  app.use("*", csrfGuard());
  app.get("/resource", (context) => context.json({ ok: true }));
  app.post("/resource", (context) => context.json({ ok: true }));
  app.put("/resource", (context) => context.json({ ok: true }));
  app.delete("/resource", (context) => context.json({ ok: true }));
  return app;
}

describe("csrfGuard", () => {
  it("allows GET requests regardless of Origin", async () => {
    const app = createHarness();

    const response = await app.fetch(
      new Request("https://example.test/resource", {
        headers: { Origin: "https://evil.test" },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("allows a same-origin POST with a matching Origin header", async () => {
    const app = createHarness();

    const response = await app.fetch(
      new Request("https://example.test/resource", {
        headers: { Origin: "https://example.test" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects a POST with a mismatched Origin header", async () => {
    const app = createHarness();

    const response = await app.fetch(
      new Request("https://example.test/resource", {
        headers: { Origin: "https://evil.test" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: "FORBIDDEN" });
  });

  it("falls back to Referer when Origin is absent, and rejects a mismatch", async () => {
    const app = createHarness();

    const response = await app.fetch(
      new Request("https://example.test/resource", {
        headers: { Referer: "https://evil.test/attack-page" },
        method: "PUT",
      }),
    );

    expect(response.status).toBe(403);
  });

  it("allows a matching Referer when Origin is absent", async () => {
    const app = createHarness();

    const response = await app.fetch(
      new Request("https://example.test/resource", {
        headers: { Referer: "https://example.test/some-page" },
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
  });

  it("allows an unsafe method with neither Origin nor Referer (relies on SameSite=Lax)", async () => {
    const app = createHarness();

    const response = await app.fetch(
      new Request("https://example.test/resource", { method: "POST" }),
    );

    expect(response.status).toBe(200);
  });

  it("prefers Origin over Referer when both are present", async () => {
    const app = createHarness();

    const response = await app.fetch(
      new Request("https://example.test/resource", {
        headers: {
          Origin: "https://example.test",
          Referer: "https://evil.test/attack-page",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
  });
});
