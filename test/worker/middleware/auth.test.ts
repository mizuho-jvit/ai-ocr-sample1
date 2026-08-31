import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  type AppHonoEnv,
  adminGuard,
  requireAdmin,
  requireSession,
  SESSION_COOKIE_NAME,
  sessionGuard,
} from "../../../src/worker/middleware/auth";
import type {
  AuthService,
  SessionActor,
} from "../../../src/worker/services/auth";
import { toSessionId, toStaffUserId } from "../../../src/worker/types";

function actorWithRole(role: "admin" | "staff"): SessionActor {
  return {
    sessionId: toSessionId("session-1"),
    user: {
      email: `${role}@example.test`,
      id: toStaffUserId(`staff-${role}`),
      isActive: true,
      name: role,
      role,
    },
  };
}

function stubAuthService(actor: SessionActor | null): AuthService {
  return {
    login: vi.fn(async () => {
      throw new Error("login is not used in these tests");
    }),
    logout: vi.fn(async () => undefined),
    resolveSession: vi.fn(async () => actor),
  } as unknown as AuthService;
}

function createHarness(actor: SessionActor | null) {
  const auth = stubAuthService(actor);
  const app = new Hono<AppHonoEnv>();

  app.use("*", async (context, next) => {
    context.set("auth", auth);
    await next();
  });
  app.onError((error) => {
    const code = (error as { code?: string }).code ?? "INTERNAL";
    const status =
      code === "FORBIDDEN" ? 403 : code === "UNAUTHENTICATED" ? 401 : 500;
    return new Response(JSON.stringify({ code }), { status });
  });
  app.get("/session-only", sessionGuard(), (context) =>
    context.json({ role: context.get("actor")?.user.role }),
  );
  app.get("/admin-only", adminGuard(), (context) =>
    context.json({ role: context.get("actor")?.user.role }),
  );
  app.get("/manual", async (context) => {
    const resolved = await requireSession(context);
    requireAdmin(resolved);
    return context.json({ role: resolved.user.role });
  });

  return { app, auth };
}

function withCookie(path: string, sessionId = "session-1"): Request {
  return new Request(`https://example.test${path}`, {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
  });
}

describe("requireSession (NF-2-10)", () => {
  it("resolves the actor from the session cookie", async () => {
    const { app, auth } = createHarness(actorWithRole("staff"));

    const response = await app.fetch(withCookie("/session-only"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ role: "staff" });
    expect(auth.resolveSession).toHaveBeenCalledWith(toSessionId("session-1"));
  });

  it("returns UNAUTHENTICATED when the cookie is absent", async () => {
    const { app, auth } = createHarness(actorWithRole("staff"));

    const response = await app.fetch(
      new Request("https://example.test/session-only"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHENTICATED",
    });
    expect(auth.resolveSession).not.toHaveBeenCalled();
  });

  it("returns UNAUTHENTICATED when the session cannot be resolved", async () => {
    const { app } = createHarness(null);

    const response = await app.fetch(withCookie("/session-only"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHENTICATED",
    });
  });

  it("resolves the session only once per request", async () => {
    const { app, auth } = createHarness(actorWithRole("admin"));

    await app.fetch(withCookie("/admin-only"));

    expect(auth.resolveSession).toHaveBeenCalledOnce();
  });
});

describe("requireAdmin (NF-2-11・F-7-2)", () => {
  it("allows an admin actor through", async () => {
    const { app } = createHarness(actorWithRole("admin"));

    const response = await app.fetch(withCookie("/admin-only"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ role: "admin" });
  });

  it("returns FORBIDDEN for a staff actor", async () => {
    const { app } = createHarness(actorWithRole("staff"));

    const response = await app.fetch(withCookie("/admin-only"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: "FORBIDDEN" });
  });

  it("returns UNAUTHENTICATED before FORBIDDEN when there is no session", async () => {
    const { app } = createHarness(null);

    const response = await app.fetch(withCookie("/admin-only"));

    expect(response.status).toBe(401);
  });

  it("guards a handler that calls requireSession and requireAdmin directly", async () => {
    const staff = createHarness(actorWithRole("staff"));
    const admin = createHarness(actorWithRole("admin"));

    expect((await staff.app.fetch(withCookie("/manual"))).status).toBe(403);
    expect((await admin.app.fetch(withCookie("/manual"))).status).toBe(200);
  });
});
