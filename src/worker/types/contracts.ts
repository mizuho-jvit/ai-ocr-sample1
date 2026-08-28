export type Role = "admin" | "staff";

export type AppStatus = "received" | "under_review" | "approved" | "returned";

export type MemberStatus = "pending" | "active" | "suspended" | "inactive";

export type Triage = "approval_candidate" | "needs_review" | "return_candidate";

export type Likelihood = "high" | "medium" | "low";

export type MatchStatus = "pending" | "merged" | "rejected" | "hold";

export type Severity = "error" | "warning";

export type OcrPipelineMode = "gemini" | "document-ai-gemini";

export type TenantId = string;
export type StaffUserId = string;
export type MemberId = string;
export type ApplicationId = string;
export type CheckRunId = string;
export type MatchCandidateId = string;
export type SessionId = string;
export type PeriodKey = string;
export type ImageKey = string;

export interface TenantRow {
  tenantId: TenantId;
}

export type TenantInsertValues<Row extends TenantRow> = Omit<Row, "tenantId">;

export type TenantUpdateValues<Row extends TenantRow> = Partial<
  Omit<Row, "tenantId">
>;

export type TenantScopedTable =
  | "staff_users"
  | "members"
  | "applications"
  | "check_runs"
  | "match_candidates"
  | "app_status_history"
  | "status_history"
  | "sessions";

declare const SQL_EXPR: unique symbol;

/**
 * Repository implementations wrap their query-builder predicate in this type.
 * The opaque marker keeps application code from depending on a raw D1 handle.
 */
export interface SqlExpr {
  readonly [SQL_EXPR]: true;
}

/**
 * A database boundary whose implementation always adds its tenant predicate.
 * `usage_counter` is intentionally absent from TenantScopedTable.
 */
export interface ScopedDb {
  select<Row extends TenantRow>(
    table: TenantScopedTable,
    where?: SqlExpr,
  ): Promise<Row[]>;
  selectOne<Row extends TenantRow>(
    table: TenantScopedTable,
    where: SqlExpr,
  ): Promise<Row | null>;
  insert<Row extends TenantRow>(
    table: TenantScopedTable,
    values: TenantInsertValues<Row>,
  ): Promise<Row>;
  update<Row extends TenantRow>(
    table: TenantScopedTable,
    values: TenantUpdateValues<Row>,
    where: SqlExpr,
  ): Promise<number>;
  delete(table: TenantScopedTable, where: SqlExpr): Promise<number>;
}

export interface PreparedImage {
  base64: string;
  mimeType: "image/jpeg" | "image/png";
}

export interface ExtractedField {
  label: string;
  value: string;
  confidence: number;
}

export interface ExtractedApplication {
  docType: string;
  fields: ExtractedField[];
}

export interface OcrPipeline {
  extract(image: PreparedImage): Promise<ExtractedApplication>;
}

export interface ApplicationField extends ExtractedField {
  edited: boolean;
}

export interface ConsistencyIssue {
  labels: string[];
  severity: Severity;
  message: string;
}

export interface Deficiency {
  label: string;
  message: string;
}

export interface CheckResult {
  triage: Triage;
  triageReason: string;
  consistency: ConsistencyIssue[];
  deficiencies: Deficiency[];
  letterDraft: string | null;
}

export interface CheckRunView extends CheckResult {
  id: CheckRunId;
  applicationId: ApplicationId;
  createdBy: StaffUserSummary;
  createdAt: string;
}

export interface NormalizedKeys {
  nameNormalized: string;
  kanaNormalized: string;
  birthDateNormalized: string | null;
  phoneNormalized: string | null;
}

export interface RuleScoreBreakdown {
  kanaAndBirthDate: boolean;
  phone: boolean;
  nameAndAddressPrefix: boolean;
  total: number;
}

export interface MatchCandidateView {
  id: MatchCandidateId;
  member: MemberSummary;
  ruleScore: number;
  aiLikelihood: Likelihood | null;
  aiReason: string | null;
  status: MatchStatus;
  decidedBy: StaffUserSummary | null;
  decidedAt: string | null;
}

export interface StaffUserSummary {
  id: StaffUserId;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
}

export interface MemberSummary {
  id: MemberId;
  memberNumber: string;
  name: string;
  nameKana: string | null;
  birthDate: string | null;
  phone: string | null;
  status: MemberStatus;
}

export interface MemberDetail extends MemberSummary {
  postalCode: string | null;
  address: string | null;
  email: string | null;
  createdAt: string;
  applications: ApplicationSummary[];
  statusHistory: StatusHistoryEntry[];
}

export interface ApplicationSummary {
  id: ApplicationId;
  docType: string;
  appStatus: AppStatus;
  triage: Triage | null;
  createdBy: StaffUserSummary;
  member: MemberSummary | null;
  hasImage: boolean;
  createdAt: string;
}

export interface ApplicationDetail extends ApplicationSummary {
  fields: ApplicationField[];
  latestCheckRun: CheckRunView | null;
  matchCandidates: MatchCandidateView[];
  statusHistory: AppStatusHistoryEntry[];
  updatedBy: StaffUserSummary | null;
  editedCount: number;
  processingSec: number;
}

export interface AppStatusHistoryEntry {
  id: string;
  fromStatus: AppStatus | null;
  toStatus: AppStatus;
  note: string | null;
  createdAt: string;
  createdBy: StaffUserSummary;
}

export interface StatusHistoryEntry {
  id: string;
  fromStatus: MemberStatus | null;
  toStatus: MemberStatus;
  reason: string | null;
  createdAt: string;
  createdBy: StaffUserSummary;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: StaffUserSummary;
}

export interface SessionResponse {
  user: StaffUserSummary;
  features: { dataReset: boolean };
}

export interface UsageResponse {
  period: PeriodKey;
  ocrPages: number;
  ocrPagesLimit: number;
  ocrPagesRemaining: number;
  geminiCalls: number;
  geminiCallsLimit: number;
}

export interface OcrExtractRequest {
  image: PreparedImage;
}

export interface OcrExtractResponse {
  application: ApplicationDetail;
  usage: UsageResponse;
}

export interface ApplicationListQuery {
  appStatus?: AppStatus;
  triage?: Triage;
  createdById?: StaffUserId;
  linked?: boolean;
  needsReviewOnly?: boolean;
  page?: number;
  perPage?: number;
}

export interface ApplicationListResponse {
  items: ApplicationSummary[];
  total: number;
  page: number;
  perPage: number;
}

export interface UpdateFieldsRequest {
  fields: Array<{ label: string; value: string }>;
}

export interface ChangeAppStatusRequest {
  toStatus: AppStatus;
  note?: string;
}

export interface ChangeAppStatusResponse {
  application: ApplicationDetail;
  promotedMember: MemberSummary | null;
}

export interface RunCheckRequest {
  applicationId: ApplicationId;
}

export interface RunCheckResponse {
  checkRun: CheckRunView;
  matchCandidates: MatchCandidateView[];
  application: ApplicationDetail;
  usage: UsageResponse;
  remainingRuns: number;
}

export interface DecideMatchRequest {
  decision: Exclude<MatchStatus, "pending">;
}

export interface DecideMatchResponse {
  candidate: MatchCandidateView;
  application: ApplicationDetail;
}

export interface MemberListQuery {
  q?: string;
  birthDate?: string;
  phone?: string;
  status?: MemberStatus;
  page?: number;
  perPage?: number;
}

export interface MemberListResponse {
  items: MemberSummary[];
  total: number;
  page: number;
  perPage: number;
}

export interface CreateMemberRequest {
  name: string;
  nameKana?: string;
  birthDate?: string;
  postalCode?: string;
  address?: string;
  phone?: string;
  email?: string;
  status: MemberStatus;
}

export type UpdateMemberRequest = Partial<Omit<CreateMemberRequest, "status">>;

export interface ChangeMemberStatusRequest {
  toStatus: MemberStatus;
  reason: string;
}

export interface CreateStaffRequest {
  email: string;
  name: string;
  password: string;
  role: Role;
}

export interface UpdateStaffRequest {
  name?: string;
  role?: Role;
  isActive?: boolean;
  password?: string;
}

export interface ImportMembersResponse {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export interface ResetPreviewResponse {
  applications: number;
  images: number;
  members: number;
  confirmationWord: string;
}

export interface ResetRequest {
  confirmation: string;
}

export interface ResetResponse {
  deleted: { applications: number; images: number; members: number };
  usageCounterReset: false;
}

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_CREDENTIALS"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "CHECK_RUN_LIMIT"
  | "VALIDATION_ERROR"
  | "USAGE_LIMIT_EXCEEDED"
  | "AI_UNAVAILABLE"
  | "INTERNAL";

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    retryable?: boolean;
  };
}
