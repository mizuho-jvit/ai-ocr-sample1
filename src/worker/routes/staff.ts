import { Hono } from "hono";

import {
  type AppHonoEnv,
  adminGuard,
  requireSession,
} from "../middleware/auth";
import {
  ApiErrorException,
  type CreateStaffRequest,
  type Role,
  type StaffUserSummary,
  toStaffUserId,
  type UpdateStaffRequest,
} from "../types";

const ROLE_VALUES = new Set(["admin", "staff"]);

/**
 * 🔴 Intent: コードレビュー指摘(P2)。メール形式・パスワード強度は要件に定めが無いため、
 * 実装時判断として以下を採用する(決定#47)。
 * - メール: よくある簡易パターン(ローカル部@ドメイン部.TLD、空白を含まない)のみ検証する
 *   (RFC 5322準拠の完全な検証は行わない)。前後・埋め込みの空白はこのパターンに一致しない
 *   ため自動的に拒否となり、トリム等の正規化は行わない。
 * - メール最大長: RFC 5321の実務上限(ローカル部64字+ドメイン部255字を包含する254字)を採用する。
 * - パスワード最小長: 12文字(ユーザー指定)。大文字・数字・記号混在等の複雑さの強制は行わない。
 * - パスワード最大長: 50文字(ユーザー指定)。PBKDF2自体は入力長に上限を課さないが、任意長の入力を
 *   そのまま鍵導出へ渡すDoS面のリスクを避けるため上限を設ける。保存する`passwordHash`
 *   (`pbkdf2-sha256$<反復回数>$<salt>$<hash>`形式)はこの入力長と無関係に一定の長さになる
 *   (ハッシュ・saltは固定バイト数のBase64であり、パスワードの長さを保存しない)。
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 50;

function isValidStaffEmail(value: string): boolean {
  return value.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(value);
}

function isValidStaffPassword(value: string): boolean {
  return (
    value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH
  );
}

function validationError(): ApiErrorException {
  return new ApiErrorException("VALIDATION_ERROR");
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function parseCreateStaffRequest(body: unknown): CreateStaffRequest {
  if (typeof body !== "object" || body === null) {
    throw validationError();
  }
  const { name, email, password, role } = body as Record<string, unknown>;

  if (typeof name !== "string" || name.trim().length === 0) {
    throw validationError();
  }
  if (typeof email !== "string" || !isValidStaffEmail(email)) {
    throw validationError();
  }
  if (typeof password !== "string" || !isValidStaffPassword(password)) {
    throw validationError();
  }
  if (typeof role !== "string" || !ROLE_VALUES.has(role)) {
    throw validationError();
  }

  return { email, name, password, role: role as Role };
}

function parseUpdateStaffRequest(body: unknown): UpdateStaffRequest {
  if (typeof body !== "object" || body === null) {
    throw validationError();
  }
  const { name, role, isActive, password } = body as Record<string, unknown>;

  if (!isOptionalString(name) || !isOptionalString(password)) {
    throw validationError();
  }
  if (!isOptionalBoolean(isActive)) {
    throw validationError();
  }
  if (
    role !== undefined &&
    (typeof role !== "string" || !ROLE_VALUES.has(role))
  ) {
    throw validationError();
  }
  if (name !== undefined && name.trim().length === 0) {
    throw validationError();
  }
  if (password !== undefined && !isValidStaffPassword(password)) {
    throw validationError();
  }

  return { isActive, name, password, role: role as Role | undefined };
}

/**
 * 🔵 Intent: `/api/staff`配下(api.md #24〜26・F-7)。admin以外は`adminGuard`が
 * 401/403で弾くため、ハンドラ側は検証とセッション解決だけを行う(routes/members.tsと同じ方針)。
 */
export function createStaffRoutes(): Hono<AppHonoEnv> {
  const routes = new Hono<AppHonoEnv>();

  routes.use("*", adminGuard());

  routes.get("/", async (context) => {
    const result = await context.get("staffService").list();
    return context.json<StaffUserSummary[]>(result);
  });

  routes.post("/", async (context) => {
    const actor = await requireSession(context);
    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      throw validationError();
    }
    const input = parseCreateStaffRequest(rawBody);
    const staff = await context.get("staffService").create(input, actor);
    return context.json<StaffUserSummary>(staff, 201);
  });

  routes.patch("/:id", async (context) => {
    const actor = await requireSession(context);
    const staffId = toStaffUserId(context.req.param("id"));
    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      throw validationError();
    }
    const input = parseUpdateStaffRequest(rawBody);
    const staff = await context
      .get("staffService")
      .update(staffId, actor, input);
    return context.json<StaffUserSummary>(staff);
  });

  return routes;
}
