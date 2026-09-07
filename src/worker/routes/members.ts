import { Hono } from "hono";

import type { AppHonoEnv } from "../middleware/auth";
import { requireSession } from "../middleware/auth";
import {
  ApiErrorException,
  type ChangeMemberStatusRequest,
  type CreateMemberRequest,
  type MatchCandidateView,
  type MemberDetail,
  type MemberListQuery,
  type MemberListResponse,
  type MemberStatus,
  toMemberId,
  type UpdateMemberRequest,
} from "../types";

const MEMBER_STATUS_VALUES = new Set([
  "pending",
  "active",
  "suspended",
  "inactive",
]);

function validationError(): ApiErrorException {
  return new ApiErrorException("VALIDATION_ERROR");
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/**
 * 🟡 Intent: F-6-1のひらがな→カタカナ統一は氏名カナのみに適用する正規化であり、
 * 入力自体の検証ではない。氏名カナはフリガナとして全角カタカナ(長音・中点含む)と
 * 空白のみを許可し、ひらがな等の混入を422で弾く。
 */
const KATAKANA_ONLY_PATTERN = /^[\u30A0-\u30FF\s]*$/;

/**
 * 🟡 Intent: 会員情報登録画面はOCR抽出・和暦入力を経由しない手入力専用の画面のため、
 * 生年月日は西暦の半角数字と区切り記号のみを受け付ける
 * (和暦・全角入力はOCR/名寄せ側の`member-normalizer.ts`のみが対応する別経路)。
 */
const BIRTH_DATE_PATTERN = /^[0-9\-/]*$/;
const PHONE_PATTERN = /^[0-9-]*$/;
const POSTAL_CODE_PATTERN = /^[0-9-]*$/;
/** 半角英数記号(空白を除く印字可能なASCII文字)のみを許可する。 */
const EMAIL_PATTERN = /^[\x21-\x7E]*$/;

const NAME_MAX_LENGTH = 30;
const NAME_KANA_MAX_LENGTH = 90;
const BIRTH_DATE_MAX_LENGTH = 10;
const PHONE_MAX_LENGTH = 20;
const POSTAL_CODE_MAX_LENGTH = 10;
const ADDRESS_MAX_LENGTH = 100;
const EMAIL_MAX_LENGTH = 50;

/** 未指定(undefined)は素通しする。指定されている場合のみ最大文字数・文字種を検証する。 */
function assertValidField(
  value: string | undefined,
  maxLength: number,
  pattern?: RegExp,
): void {
  if (value === undefined) {
    return;
  }
  if (
    value.length > maxLength ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw validationError();
  }
}

/**
 * 🟡 Intent: `ApplicationListQuery`と同じ方針(routes/applications.tsのparseApplicationListQuery)。
 * `GET /api/members`は422を持たない(api.md #19)ため、未知・不正な値は無視してフィルタなし相当にする。
 */
function parseMemberListQuery(raw: Record<string, string>): MemberListQuery {
  const query: MemberListQuery = {};
  if (raw.q) {
    query.q = raw.q;
  }
  if (raw.birthDate) {
    query.birthDate = raw.birthDate;
  }
  if (raw.phone) {
    query.phone = raw.phone;
  }
  if (raw.status && MEMBER_STATUS_VALUES.has(raw.status)) {
    query.status = raw.status as MemberStatus;
  }
  const page = Number.parseInt(raw.page ?? "", 10);
  if (Number.isInteger(page) && page > 0) {
    query.page = page;
  }
  const perPage = Number.parseInt(raw.perPage ?? "", 10);
  if (Number.isInteger(perPage) && perPage > 0) {
    query.perPage = perPage;
  }
  return query;
}

function parseCreateMemberRequest(body: unknown): CreateMemberRequest {
  if (typeof body !== "object" || body === null) {
    throw validationError();
  }
  const {
    name,
    nameKana,
    birthDate,
    postalCode,
    address,
    phone,
    email,
    status,
  } = body as Record<string, unknown>;

  if (typeof name !== "string" || name.trim().length === 0) {
    throw validationError();
  }
  if (typeof phone !== "string" || phone.length === 0) {
    throw validationError();
  }
  if (typeof status !== "string" || !MEMBER_STATUS_VALUES.has(status)) {
    throw validationError();
  }
  if (
    !isOptionalString(nameKana) ||
    !isOptionalString(birthDate) ||
    !isOptionalString(postalCode) ||
    !isOptionalString(address) ||
    !isOptionalString(email)
  ) {
    throw validationError();
  }
  assertValidField(name, NAME_MAX_LENGTH);
  assertValidField(phone, PHONE_MAX_LENGTH, PHONE_PATTERN);
  assertValidField(nameKana, NAME_KANA_MAX_LENGTH, KATAKANA_ONLY_PATTERN);
  assertValidField(birthDate, BIRTH_DATE_MAX_LENGTH, BIRTH_DATE_PATTERN);
  assertValidField(postalCode, POSTAL_CODE_MAX_LENGTH, POSTAL_CODE_PATTERN);
  assertValidField(address, ADDRESS_MAX_LENGTH);
  assertValidField(email, EMAIL_MAX_LENGTH, EMAIL_PATTERN);

  return {
    address,
    birthDate,
    email,
    name,
    nameKana,
    phone,
    postalCode,
    status: status as MemberStatus,
  };
}

function parseUpdateMemberRequest(body: unknown): UpdateMemberRequest {
  if (typeof body !== "object" || body === null) {
    throw validationError();
  }
  const { name, nameKana, birthDate, postalCode, address, phone, email } =
    body as Record<string, unknown>;

  if (
    !isOptionalString(name) ||
    !isOptionalString(nameKana) ||
    !isOptionalString(birthDate) ||
    !isOptionalString(postalCode) ||
    !isOptionalString(address) ||
    !isOptionalString(phone) ||
    !isOptionalString(email)
  ) {
    throw validationError();
  }
  if (name !== undefined && name.trim().length === 0) {
    throw validationError();
  }
  if (phone !== undefined && phone.length === 0) {
    throw validationError();
  }
  assertValidField(name, NAME_MAX_LENGTH);
  assertValidField(phone, PHONE_MAX_LENGTH, PHONE_PATTERN);
  assertValidField(nameKana, NAME_KANA_MAX_LENGTH, KATAKANA_ONLY_PATTERN);
  assertValidField(birthDate, BIRTH_DATE_MAX_LENGTH, BIRTH_DATE_PATTERN);
  assertValidField(postalCode, POSTAL_CODE_MAX_LENGTH, POSTAL_CODE_PATTERN);
  assertValidField(address, ADDRESS_MAX_LENGTH);
  assertValidField(email, EMAIL_MAX_LENGTH, EMAIL_PATTERN);

  return { address, birthDate, email, name, nameKana, phone, postalCode };
}

/** F-5-7: 状態変更には変更者・日時・理由(reason)の記録が必須のため、reasonは空文字を許容しない。 */
function parseChangeMemberStatusRequest(
  body: unknown,
): ChangeMemberStatusRequest {
  if (typeof body !== "object" || body === null) {
    throw validationError();
  }
  const { toStatus, reason } = body as Record<string, unknown>;
  if (typeof toStatus !== "string" || !MEMBER_STATUS_VALUES.has(toStatus)) {
    throw validationError();
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw validationError();
  }
  return { reason, toStatus: toStatus as MemberStatus };
}

/**
 * 🔵 Intent: `/api/members`配下(api.md #16・#19〜23・F-5・F-5-9)。検証とセッション解決だけを行い、
 * 整合はcreateMemberServiceへ委ねる(routes/applications.tsと同じ方針)。
 * `/match-candidates`は`/:id`より前に登録する(api.mdの登録順序の注記どおり、
 * `:id = "match-candidates"`として誤って一致しないようにするため)。
 */
export function createMemberRoutes(): Hono<AppHonoEnv> {
  const routes = new Hono<AppHonoEnv>();

  routes.get("/match-candidates", async (context) => {
    await requireSession(context);
    const result = await context.get("memberService").listMatchCandidates();
    return context.json<MatchCandidateView[]>(result);
  });

  routes.get("/", async (context) => {
    await requireSession(context);
    const query = parseMemberListQuery(context.req.query());
    const result = await context.get("memberService").list(query);
    return context.json<MemberListResponse>(result);
  });

  routes.post("/", async (context) => {
    const actor = await requireSession(context);
    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      throw validationError();
    }
    const input = parseCreateMemberRequest(rawBody);
    const member = await context.get("memberService").create(input, actor);
    return context.json<MemberDetail>(member, 201);
  });

  routes.get("/:id", async (context) => {
    await requireSession(context);
    const memberId = toMemberId(context.req.param("id"));
    const member = await context.get("memberService").get(memberId);
    return context.json<MemberDetail>(member);
  });

  routes.patch("/:id", async (context) => {
    const actor = await requireSession(context);
    const memberId = toMemberId(context.req.param("id"));
    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      throw validationError();
    }
    const input = parseUpdateMemberRequest(rawBody);
    const member = await context
      .get("memberService")
      .update(memberId, actor, input);
    return context.json<MemberDetail>(member);
  });

  routes.post("/:id/status", async (context) => {
    const actor = await requireSession(context);
    const memberId = toMemberId(context.req.param("id"));
    let rawBody: unknown;
    try {
      rawBody = await context.req.json();
    } catch {
      throw validationError();
    }
    const input = parseChangeMemberStatusRequest(rawBody);
    const member = await context
      .get("memberService")
      .changeStatus(memberId, actor, input);
    return context.json<MemberDetail>(member);
  });

  return routes;
}
