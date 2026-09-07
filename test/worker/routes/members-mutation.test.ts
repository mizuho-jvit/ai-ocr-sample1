import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantRepository } from "../../../src/worker/db/repositories";
import { createApp } from "../../../src/worker/index";
import { hashPassword } from "../../../src/worker/services/auth";
import type { MemberService } from "../../../src/worker/services/member-service";
import {
  ApiErrorException,
  type MemberDetail,
  toMemberId,
  toStaffUserId,
  toTenantId,
  type WorkerEnv,
} from "../../../src/worker/types";

const TENANT_ID = toTenantId("tenant-members-mutation-route");
const STAFF_ID = toStaffUserId("members-mutation-route-staff");
const MEMBER_ID = toMemberId("members-mutation-route-member");
const PASSWORD = "correct horse battery staple";
const TEST_ITERATIONS = 1_000;
const BASIC_PASSWORD = "test-password-at-least-20-characters";
const BASIC_AUTHORIZATION = `Basic ${btoa(`test-user:${BASIC_PASSWORD}`)}`;

const testEnvironment = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
};

function createTestEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    AI_GATEWAY_ACCOUNT_ID: "test-ai-gateway-account",
    AI_GATEWAY_ID: "test-ai-gateway-id",
    ALLOW_DATA_RESET: "true",
    ALLOW_WEAK_PASSWORD_HASH: "true",
    ASSETS: {
      fetch: vi.fn(() => new Response("asset response")),
    } as unknown as Fetcher,
    BASIC_AUTH_PASSWORD: BASIC_PASSWORD,
    BASIC_AUTH_USERNAME: "test-user",
    BUCKET: {} as R2Bucket,
    DB: env.DB,
    GEMINI_API_KEY: "test-gemini-secret",
    GEMINI_MODEL: "gemini-3.1-flash-lite",
    MAX_CHECK_RUNS_PER_APPLICATION: "5",
    MAX_GEMINI_CALLS_PER_MONTH: "720",
    MAX_OCR_PAGES_PER_MONTH: "120",
    OCR_PIPELINE_MODE: "gemini",
    PBKDF2_ITERATIONS: String(TEST_ITERATIONS),
    R2_ACCOUNT_ID: "test-r2-account",
    R2_S3_ACCESS_KEY_ID: "test-r2-access-key",
    R2_S3_SECRET_ACCESS_KEY: "test-r2-secret-key",
    TENANT_ID,
    ...overrides,
  };
}

function request(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Request {
  const { cookie, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Authorization", BASIC_AUTHORIZATION);
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  return new Request(`https://example.test${path}`, { ...rest, headers });
}

function jsonRequest(
  method: string,
  path: string,
  body: unknown,
  cookie?: string,
): Request {
  return request(path, {
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(cookie ? { cookie } : {}),
    headers: { "Content-Type": "application/json" },
    method,
  });
}

function sessionCookieFrom(response: Response): string {
  return (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
}

async function loginCookie(): Promise<string> {
  const response = await createApp(createTestEnv()).fetch(
    jsonRequest("POST", "/api/auth/login", {
      email: "staff@example.test",
      password: PASSWORD,
    }),
    createTestEnv(),
  );
  return sessionCookieFrom(response);
}

function fakeMemberService(
  overrides: Partial<MemberService> = {},
): MemberService {
  return {
    changeStatus: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    listMatchCandidates: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
}

function appWith(service: MemberService, environment: WorkerEnv) {
  return createApp(
    environment,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    service,
  );
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnvironment.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO tenants (id, code, name) VALUES (?, ?, ?)",
  )
    .bind(TENANT_ID, TENANT_ID, TENANT_ID)
    .run();
  await env.DB.prepare("DELETE FROM sessions").run();
  await env.DB.prepare("DELETE FROM staff_users").run();

  await createTenantRepository(env.DB)
    .forTenant(TENANT_ID)
    .staffUsers.insert({
      createdById: null,
      email: "staff@example.test",
      failedLoginCount: 0,
      id: STAFF_ID,
      isActive: true,
      lockedUntil: null,
      name: "窓口 花子",
      passwordHash: await hashPassword(PASSWORD, TEST_ITERATIONS),
      role: "staff",
      updatedById: null,
    });
});

describe("POST /api/members (api.md #20・F-5-1)", () => {
  it("rejects a body missing phone with 422 and never calls the service", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const create = vi.fn();
    const app = appWith(fakeMemberService({ create }), environment);

    const response = await app.fetch(
      jsonRequest(
        "POST",
        "/api/members",
        { name: "会員", status: "pending" },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(422);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an invalid status with 422", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const create = vi.fn();
    const app = appWith(fakeMemberService({ create }), environment);

    const response = await app.fetch(
      jsonRequest(
        "POST",
        "/api/members",
        { name: "会員", phone: "09000000000", status: "not-a-status" },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(422);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["半角空白のみ", "   "],
    ["全角空白のみ", "　　"],
    ["混在空白のみ", " 　 "],
  ])(
    "rejects a whitespace-only name (%s) with 422 and never calls the service (コードレビュー指摘)",
    async (_label, name) => {
      const cookie = await loginCookie();
      const environment = createTestEnv();
      const create = vi.fn();
      const app = appWith(fakeMemberService({ create }), environment);

      const response = await app.fetch(
        jsonRequest(
          "POST",
          "/api/members",
          { name, phone: "09000000000", status: "pending" },
          cookie,
        ),
        environment,
      );

      expect(response.status).toBe(422);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("passes the actor and parsed input through, returning 201 with the service result", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const fakeMember = { id: MEMBER_ID } as MemberDetail;
    const create = vi.fn(async () => fakeMember);
    const app = appWith(fakeMemberService({ create }), environment);

    const response = await app.fetch(
      jsonRequest(
        "POST",
        "/api/members",
        { name: "会員", phone: "09000000000", status: "pending" },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(fakeMember);
    const [input, actor] = create.mock.calls[0] as unknown as [
      unknown,
      { user: { id: string } },
    ];
    expect(input).toEqual({
      address: undefined,
      birthDate: undefined,
      email: undefined,
      name: "会員",
      nameKana: undefined,
      phone: "09000000000",
      postalCode: undefined,
      status: "pending",
    });
    expect(actor.user.id).toBe(STAFF_ID);
  });

  it.each([
    ["ひらがな混じり", "かいいん"],
    ["半角カタカナ", "ｶｲｲﾝ"],
    ["漢字混じり", "会員カナ"],
  ])(
    "rejects a nameKana that is not full-width katakana (%s) with 422 and never calls the service (ユーザー指摘)",
    async (_label, nameKana) => {
      const cookie = await loginCookie();
      const environment = createTestEnv();
      const create = vi.fn();
      const app = appWith(fakeMemberService({ create }), environment);

      const response = await app.fetch(
        jsonRequest(
          "POST",
          "/api/members",
          { name: "会員", nameKana, phone: "09000000000", status: "pending" },
          cookie,
        ),
        environment,
      );

      expect(response.status).toBe(422);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("accepts a nameKana containing full-width katakana and a space (ユーザー指摘)", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const fakeMember = { id: MEMBER_ID } as MemberDetail;
    const create = vi.fn(async () => fakeMember);
    const app = appWith(fakeMemberService({ create }), environment);

    const response = await app.fetch(
      jsonRequest(
        "POST",
        "/api/members",
        {
          name: "会員",
          nameKana: "カイイン タロウ",
          phone: "09000000000",
          status: "pending",
        },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledOnce();
  });

  it.each([
    ["氏名が31文字", { name: "あ".repeat(31) }],
    ["氏名カナが91文字", { nameKana: "ア".repeat(91) }],
    ["生年月日が11文字", { birthDate: "1".repeat(11) }],
    ["生年月日に和暦(漢字)が混入", { birthDate: "昭和55-01-01" }],
    ["電話番号が21文字", { phone: "1".repeat(21) }],
    ["電話番号に全角数字が混入", { phone: "０９０００００００００" }],
    ["郵便番号が11文字", { postalCode: "1".repeat(11) }],
    ["郵便番号に全角数字が混入", { postalCode: "１２３-4567" }],
    ["住所が101文字", { address: "あ".repeat(101) }],
    ["メールが51文字", { email: `${"a".repeat(45)}@a.com` }],
    ["メールに全角文字が混入", { email: "ａ@example.com" }],
  ])(
    "rejects a request where %s with 422 and never calls the service (ユーザー指摘・最大文字数/文字種)",
    async (_label, overrides) => {
      const cookie = await loginCookie();
      const environment = createTestEnv();
      const create = vi.fn();
      const app = appWith(fakeMemberService({ create }), environment);

      const response = await app.fetch(
        jsonRequest(
          "POST",
          "/api/members",
          {
            name: "会員",
            phone: "09000000000",
            status: "pending",
            ...overrides,
          },
          cookie,
        ),
        environment,
      );

      expect(response.status).toBe(422);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("accepts values at exactly the max length and character set for every field (ユーザー指摘)", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const fakeMember = { id: MEMBER_ID } as MemberDetail;
    const create = vi.fn(async () => fakeMember);
    const app = appWith(fakeMemberService({ create }), environment);

    const response = await app.fetch(
      jsonRequest(
        "POST",
        "/api/members",
        {
          address: "あ".repeat(100),
          birthDate: "1980-01-01",
          email: `${"a".repeat(44)}@a.com`,
          name: "あ".repeat(30),
          nameKana: "ア".repeat(90),
          phone: "1".repeat(20),
          postalCode: "1234567890",
          status: "pending",
        },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledOnce();
  });
});

describe("PATCH /api/members/:id (api.md #22・F-5-1・F-6-2)", () => {
  it("rejects an empty-string phone with 422 and never calls the service", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const update = vi.fn();
    const app = appWith(fakeMemberService({ update }), environment);

    const response = await app.fetch(
      jsonRequest("PATCH", `/api/members/${MEMBER_ID}`, { phone: "" }, cookie),
      environment,
    );

    expect(response.status).toBe(422);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ["半角空白のみ", "   "],
    ["全角空白のみ", "　　"],
    ["混在空白のみ", " 　 "],
  ])(
    "rejects a whitespace-only name (%s) with 422 and never calls the service (コードレビュー指摘)",
    async (_label, name) => {
      const cookie = await loginCookie();
      const environment = createTestEnv();
      const update = vi.fn();
      const app = appWith(fakeMemberService({ update }), environment);

      const response = await app.fetch(
        jsonRequest("PATCH", `/api/members/${MEMBER_ID}`, { name }, cookie),
        environment,
      );

      expect(response.status).toBe(422);
      expect(update).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["ひらがな混じり", "かいいん"],
    ["半角カタカナ", "ｶｲｲﾝ"],
    ["漢字混じり", "会員カナ"],
  ])(
    "rejects a nameKana that is not full-width katakana (%s) with 422 and never calls the service (ユーザー指摘)",
    async (_label, nameKana) => {
      const cookie = await loginCookie();
      const environment = createTestEnv();
      const update = vi.fn();
      const app = appWith(fakeMemberService({ update }), environment);

      const response = await app.fetch(
        jsonRequest("PATCH", `/api/members/${MEMBER_ID}`, { nameKana }, cookie),
        environment,
      );

      expect(response.status).toBe(422);
      expect(update).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["氏名が31文字", { name: "あ".repeat(31) }],
    ["氏名カナが91文字", { nameKana: "ア".repeat(91) }],
    ["生年月日が11文字", { birthDate: "1".repeat(11) }],
    ["生年月日に和暦(漢字)が混入", { birthDate: "昭和55-01-01" }],
    ["電話番号が21文字", { phone: "1".repeat(21) }],
    ["電話番号に全角数字が混入", { phone: "０９０００００００００" }],
    ["郵便番号が11文字", { postalCode: "1".repeat(11) }],
    ["郵便番号に全角数字が混入", { postalCode: "１２３-4567" }],
    ["住所が101文字", { address: "あ".repeat(101) }],
    ["メールが51文字", { email: `${"a".repeat(45)}@a.com` }],
    ["メールに全角文字が混入", { email: "ａ@example.com" }],
  ])(
    "rejects a request where %s with 422 and never calls the service (ユーザー指摘・最大文字数/文字種)",
    async (_label, overrides) => {
      const cookie = await loginCookie();
      const environment = createTestEnv();
      const update = vi.fn();
      const app = appWith(fakeMemberService({ update }), environment);

      const response = await app.fetch(
        jsonRequest(
          "PATCH",
          `/api/members/${MEMBER_ID}`,
          { ...overrides },
          cookie,
        ),
        environment,
      );

      expect(response.status).toBe(422);
      expect(update).not.toHaveBeenCalled();
    },
  );

  it("accepts values at exactly the max length and character set for every field (ユーザー指摘)", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const fakeMember = { id: MEMBER_ID } as MemberDetail;
    const update = vi.fn(async () => fakeMember);
    const app = appWith(fakeMemberService({ update }), environment);

    const response = await app.fetch(
      jsonRequest(
        "PATCH",
        `/api/members/${MEMBER_ID}`,
        {
          address: "あ".repeat(100),
          birthDate: "1980-01-01",
          email: `${"a".repeat(44)}@a.com`,
          name: "あ".repeat(30),
          nameKana: "ア".repeat(90),
          phone: "1".repeat(20),
          postalCode: "1234567890",
        },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledOnce();
  });

  it("passes the actor and parsed partial input through", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const fakeMember = { id: MEMBER_ID } as MemberDetail;
    const update = vi.fn(async () => fakeMember);
    const app = appWith(fakeMemberService({ update }), environment);

    const response = await app.fetch(
      jsonRequest(
        "PATCH",
        `/api/members/${MEMBER_ID}`,
        { address: "仙台市青葉区1-1-1" },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(fakeMember);
    const [memberId, actor, input] = update.mock.calls[0] as unknown as [
      string,
      { user: { id: string } },
      unknown,
    ];
    expect(memberId).toBe(MEMBER_ID);
    expect(actor.user.id).toBe(STAFF_ID);
    expect(input).toEqual({
      address: "仙台市青葉区1-1-1",
      birthDate: undefined,
      email: undefined,
      name: undefined,
      nameKana: undefined,
      phone: undefined,
      postalCode: undefined,
    });
  });
});

describe("POST /api/members/:id/status (api.md #23・F-5-7・F-5-8)", () => {
  it("rejects a missing reason with 422 and never calls the service", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const changeStatus = vi.fn();
    const app = appWith(fakeMemberService({ changeStatus }), environment);

    const response = await app.fetch(
      jsonRequest(
        "POST",
        `/api/members/${MEMBER_ID}/status`,
        { toStatus: "inactive" },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(422);
    expect(changeStatus).not.toHaveBeenCalled();
  });

  it("rejects a blank (whitespace-only) reason with 422", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const changeStatus = vi.fn();
    const app = appWith(fakeMemberService({ changeStatus }), environment);

    const response = await app.fetch(
      jsonRequest(
        "POST",
        `/api/members/${MEMBER_ID}/status`,
        { reason: "   ", toStatus: "inactive" },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(422);
    expect(changeStatus).not.toHaveBeenCalled();
  });

  it("rejects an invalid toStatus with 422", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const changeStatus = vi.fn();
    const app = appWith(fakeMemberService({ changeStatus }), environment);

    const response = await app.fetch(
      jsonRequest(
        "POST",
        `/api/members/${MEMBER_ID}/status`,
        { reason: "退会", toStatus: "not-a-status" },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(422);
    expect(changeStatus).not.toHaveBeenCalled();
  });

  it("passes the actor, toStatus and reason through, returning the service result", async () => {
    const cookie = await loginCookie();
    const environment = createTestEnv();
    const fakeMember = { id: MEMBER_ID, status: "inactive" } as MemberDetail;
    const changeStatus = vi.fn(async () => fakeMember);
    const app = appWith(fakeMemberService({ changeStatus }), environment);

    const response = await app.fetch(
      jsonRequest(
        "POST",
        `/api/members/${MEMBER_ID}/status`,
        { reason: "退会申し出のため", toStatus: "inactive" },
        cookie,
      ),
      environment,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(fakeMember);
    const [memberId, actor, input] = changeStatus.mock.calls[0] as unknown as [
      string,
      { user: { id: string } },
      unknown,
    ];
    expect(memberId).toBe(MEMBER_ID);
    expect(actor.user.id).toBe(STAFF_ID);
    expect(input).toEqual({ reason: "退会申し出のため", toStatus: "inactive" });
  });

  it.each([["NOT_FOUND", 404]] as const)(
    "maps %s from the service to HTTP %i",
    async (code, status) => {
      const cookie = await loginCookie();
      const environment = createTestEnv();
      const changeStatus = vi.fn(async () => {
        throw new ApiErrorException(code);
      });
      const app = appWith(fakeMemberService({ changeStatus }), environment);

      const response = await app.fetch(
        jsonRequest(
          "POST",
          `/api/members/${MEMBER_ID}/status`,
          { reason: "退会", toStatus: "inactive" },
          cookie,
        ),
        environment,
      );

      expect(response.status).toBe(status);
    },
  );
});
