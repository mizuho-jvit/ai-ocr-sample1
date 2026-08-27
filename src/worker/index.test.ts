import { describe, expect, it, vi } from "vitest";

import { createApp, type WorkerEnv } from "./index";

const BASIC_AUTHORIZATION = `Basic ${btoa("test-user:test-password")}`;

function createTestEnv(): WorkerEnv {
  return {
    ASSETS: {
      fetch: vi.fn(() => new Response("asset response")),
    } as unknown as Fetcher,
    BASIC_AUTH_PASSWORD: "test-password",
    BASIC_AUTH_USERNAME: "test-user",
  };
}

describe("Worker entry point", () => {
  it("requires Basic authentication before returning an asset", async () => {
    const env = createTestEnv();
    const app = createApp(env);

    const response = await app.fetch(new Request("https://example.test/"), env);

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
  });

  it("delegates an authenticated request to the assets binding", async () => {
    const env = createTestEnv();
    const app = createApp(env);

    const response = await app.fetch(
      new Request("https://example.test/", {
        headers: { Authorization: BASIC_AUTHORIZATION },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("asset response");
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
  });
});
