import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
  ApplicationId,
  CheckRunId,
  ImageKey,
  MatchCandidateId,
  MemberId,
  PeriodKey,
  SessionId,
  StaffUserId,
  TenantId,
} from "../types";

const APP_STATUS_VALUES = "'received', 'under_review', 'approved', 'returned'";
const MEMBER_STATUS_VALUES = "'pending', 'active', 'suspended', 'inactive'";
const TRIAGE_VALUES =
  "'approval_candidate', 'needs_review', 'return_candidate'";
const LIKELIHOOD_VALUES = "'high', 'medium', 'low'";
const MATCH_STATUS_VALUES = "'pending', 'merged', 'rejected', 'hold', 'stale'";

const createdAt = (name = "created_at") =>
  text(name).notNull().default(sql`CURRENT_TIMESTAMP`);

const updatedAt = (name = "updated_at") =>
  text(name)
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdate(() => sql`CURRENT_TIMESTAMP`);

export const tenants = sqliteTable(
  "tenants",
  {
    id: text("id").$type<TenantId>().primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("tenants_code_unique").on(table.code)],
);

export const staffUsers = sqliteTable(
  "staff_users",
  {
    id: text("id").$type<StaffUserId>().primaryKey(),
    tenantId: text("tenant_id")
      .$type<TenantId>()
      .notNull()
      .references(() => tenants.id),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: text("locked_until"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdById: text("created_by_id")
      .$type<StaffUserId>()
      .references((): AnySQLiteColumn => staffUsers.id),
    updatedById: text("updated_by_id")
      .$type<StaffUserId>()
      .references((): AnySQLiteColumn => staffUsers.id),
  },
  (table) => [
    uniqueIndex("staff_users_tenant_email_unique").on(
      table.tenantId,
      table.email,
    ),
    check("staff_users_role_check", sql`${table.role} IN ('admin', 'staff')`),
  ],
);

export const members = sqliteTable(
  "members",
  {
    id: text("id").$type<MemberId>().primaryKey(),
    tenantId: text("tenant_id")
      .$type<TenantId>()
      .notNull()
      .references(() => tenants.id),
    memberNumber: text("member_number").notNull(),
    name: text("name").notNull(),
    nameKana: text("name_kana"),
    nameNormalized: text("name_normalized").notNull(),
    kanaNormalized: text("kana_normalized").notNull(),
    birthDate: text("birth_date"),
    postalCode: text("postal_code"),
    address: text("address"),
    phone: text("phone").notNull(),
    email: text("email"),
    status: text("status").notNull(),
    isSeed: integer("is_seed", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdById: text("created_by_id")
      .$type<StaffUserId>()
      .references(() => staffUsers.id),
    updatedById: text("updated_by_id")
      .$type<StaffUserId>()
      .references(() => staffUsers.id),
  },
  (table) => [
    uniqueIndex("members_tenant_member_number_unique").on(
      table.tenantId,
      table.memberNumber,
    ),
    index("members_tenant_name_normalized_index").on(
      table.tenantId,
      table.nameNormalized,
    ),
    index("members_tenant_kana_normalized_index").on(
      table.tenantId,
      table.kanaNormalized,
    ),
    index("members_tenant_phone_index").on(table.tenantId, table.phone),
    check(
      "members_status_check",
      sql`${table.status} IN (${sql.raw(MEMBER_STATUS_VALUES)})`,
    ),
    /**
     * 🔵 Intent: matching.tsのscoreMemberはphone/birthDateを正規化済み前提で生の値と比較する
     * （normalizeMemberInputを経由しない書き込み経路が将来加わっても照合が壊れないよう、
     * DB側でも形式を強制する）。
     */
    check(
      "members_phone_digits_check",
      sql`${table.phone} != '' AND ${table.phone} NOT GLOB '*[^0-9]*'`,
    ),
    check(
      "members_birth_date_format_check",
      sql`${table.birthDate} IS NULL OR ${table.birthDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);

export const applications = sqliteTable(
  "applications",
  {
    id: text("id").$type<ApplicationId>().primaryKey(),
    tenantId: text("tenant_id")
      .$type<TenantId>()
      .notNull()
      .references(() => tenants.id),
    docType: text("doc_type").notNull(),
    fieldsJson: text("fields_json").notNull(),
    imageKey: text("image_key").$type<ImageKey>(),
    appStatus: text("app_status").notNull().default("received"),
    latestCheckRunId: text("latest_check_run_id")
      .$type<CheckRunId>()
      .references((): AnySQLiteColumn => checkRuns.id),
    /**
     * 🔵 Intent: コードレビュー指摘#3（Task 009）。NF-2-21の1申請あたりのCheckRun上限を
     * 「件数を数えてから判定する」実装ではなく、usage_counter（NF-2-39）と同じ単一の
     * 条件付きUPDATEで原子的に予約するためのカウンタ。
     */
    checkRunCount: integer("check_run_count").notNull().default(0),
    editedCount: integer("edited_count").notNull().default(0),
    processingSec: real("processing_sec").notNull(),
    memberId: text("member_id")
      .$type<MemberId>()
      .references(() => members.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdById: text("created_by_id")
      .$type<StaffUserId>()
      .notNull()
      .references(() => staffUsers.id),
    updatedById: text("updated_by_id")
      .$type<StaffUserId>()
      .references(() => staffUsers.id),
  },
  (table) => [
    check(
      "applications_app_status_check",
      sql`${table.appStatus} IN (${sql.raw(APP_STATUS_VALUES)})`,
    ),
  ],
);

export const checkRuns = sqliteTable(
  "check_runs",
  {
    id: text("id").$type<CheckRunId>().primaryKey(),
    tenantId: text("tenant_id")
      .$type<TenantId>()
      .notNull()
      .references(() => tenants.id),
    applicationId: text("application_id")
      .$type<ApplicationId>()
      .notNull()
      .references((): AnySQLiteColumn => applications.id),
    triage: text("triage").notNull(),
    triageReason: text("triage_reason").notNull(),
    consistencyJson: text("consistency_json").notNull(),
    deficienciesJson: text("deficiencies_json").notNull(),
    letterDraft: text("letter_draft"),
    createdAt: createdAt(),
    createdById: text("created_by_id")
      .$type<StaffUserId>()
      .notNull()
      .references(() => staffUsers.id),
  },
  (table) => [
    check(
      "check_runs_triage_check",
      sql`${table.triage} IN (${sql.raw(TRIAGE_VALUES)})`,
    ),
  ],
);

export const matchCandidates = sqliteTable(
  "match_candidates",
  {
    id: text("id").$type<MatchCandidateId>().primaryKey(),
    tenantId: text("tenant_id")
      .$type<TenantId>()
      .notNull()
      .references(() => tenants.id),
    applicationId: text("application_id")
      .$type<ApplicationId>()
      .notNull()
      .references(() => applications.id),
    memberId: text("member_id")
      .$type<MemberId>()
      .notNull()
      .references(() => members.id),
    ruleScore: real("rule_score").notNull(),
    aiLikelihood: text("ai_likelihood"),
    aiReason: text("ai_reason"),
    status: text("status").notNull().default("pending"),
    decidedById: text("decided_by_id")
      .$type<StaffUserId>()
      .references(() => staffUsers.id),
    decidedAt: text("decided_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("match_candidates_application_member_unique").on(
      table.applicationId,
      table.memberId,
    ),
    check(
      "match_candidates_ai_likelihood_check",
      sql`${table.aiLikelihood} IS NULL OR ${table.aiLikelihood} IN (${sql.raw(LIKELIHOOD_VALUES)})`,
    ),
    check(
      "match_candidates_status_check",
      sql`${table.status} IN (${sql.raw(MATCH_STATUS_VALUES)})`,
    ),
  ],
);

export const appStatusHistory = sqliteTable(
  "app_status_history",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .$type<TenantId>()
      .notNull()
      .references(() => tenants.id),
    applicationId: text("application_id")
      .$type<ApplicationId>()
      .notNull()
      .references(() => applications.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    note: text("note"),
    createdAt: createdAt(),
    createdById: text("created_by_id")
      .$type<StaffUserId>()
      .notNull()
      .references(() => staffUsers.id),
  },
  (table) => [
    check(
      "app_status_history_from_status_check",
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN (${sql.raw(APP_STATUS_VALUES)})`,
    ),
    check(
      "app_status_history_to_status_check",
      sql`${table.toStatus} IN (${sql.raw(APP_STATUS_VALUES)})`,
    ),
  ],
);

export const statusHistory = sqliteTable(
  "status_history",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .$type<TenantId>()
      .notNull()
      .references(() => tenants.id),
    memberId: text("member_id")
      .$type<MemberId>()
      .notNull()
      .references(() => members.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
    createdById: text("created_by_id")
      .$type<StaffUserId>()
      .notNull()
      .references(() => staffUsers.id),
  },
  (table) => [
    check(
      "status_history_from_status_check",
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN (${sql.raw(MEMBER_STATUS_VALUES)})`,
    ),
    check(
      "status_history_to_status_check",
      sql`${table.toStatus} IN (${sql.raw(MEMBER_STATUS_VALUES)})`,
    ),
  ],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").$type<SessionId>().primaryKey(),
  tenantId: text("tenant_id")
    .$type<TenantId>()
    .notNull()
    .references(() => tenants.id),
  staffUserId: text("staff_user_id")
    .$type<StaffUserId>()
    .notNull()
    .references(() => staffUsers.id),
  expiresAt: text("expires_at").notNull(),
  createdAt: createdAt(),
});

export const usageCounter = sqliteTable("usage_counter", {
  period: text("period").$type<PeriodKey>().primaryKey(),
  ocrPages: integer("ocr_pages").notNull().default(0),
  geminiCalls: integer("gemini_calls").notNull().default(0),
  updatedAt: updatedAt(),
});
