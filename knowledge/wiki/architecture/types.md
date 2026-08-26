---
type: architecture
title: 共有型定義（SPA ↔ Worker の契約）
description: ロール・状態・OCR抽出結果・業務チェック・名寄せ・APIのDTO・環境設定・テナントスコープ済みハンドルのTypeScript型定義
tags: [ai-ocr, typescript, types, contract, api, tenant-isolation]
timestamp: 2026-08-25T00:00:00Z
---

# 共有型定義（SPA ↔ Worker の契約）

> **本ページは要件定義書の章を正典化したものではなく、[機能要件](../requirements/functional.md)・[非機能要件](../requirements/non-functional.md)・[データモデル](../db/data-model.md)から導出した設計である。** 各型に根拠の要件IDを付す。要件に明記がない判断は末尾の[設計判断](#設計判断要件に明記がない箇所)に列挙する。
>
> エンドポイントごとの割り当ては [APIエンドポイント仕様](./api.md)、処理の流れは [データフロー](./dataflow.md)。

型の実体は `src/worker/types/` に置き、SPA からは相対パスで import する。**SPA から Worker の service 実装を import してはならない**（通信は `fetch('/api/...')` のみ）。

## 1. 列挙型

DB のカラムは TEXT であり、値の集合はアプリケーション側の型で表現する（[データモデル](../db/data-model.md)）。

```ts
/** 職員のロール（overview.md 権限マトリクス） */
export type Role = 'admin' | 'staff';

/** 申請の決裁状態。AI判定 Triage とは別軸で保持する（F-4-1） */
export type AppStatus = '受付' | '審査中' | '承認' | '差戻し';

/** 会員の状態（F-5-3） */
export type MemberStatus = 'pending' | 'active' | 'suspended' | 'inactive';

/** AIのトリアージ判定。決裁状態を自動変更しない参考情報（F-3-4・F-4-1） */
export type Triage = '承認候補' | '要審査' | '差戻し候補';

/** 名寄せ第2段のAI判定（F-6-5） */
export type Likelihood = '高' | '中' | '低';

/** 名寄せ候補に対する職員の判断結果（F-6-8・F-6-9） */
export type MatchStatus = 'pending' | 'merged' | 'rejected' | 'hold';

/** 整合性検証の重要度（F-3-1） */
export type Severity = 'error' | 'warning';

/** OCR方式。環境変数で固定し、画面・リクエストから変更させない（NF-4-5・NF-2-38） */
export type OcrPipelineMode = 'gemini' | 'document-ai-gemini';
```

> `AppStatus` / `Triage` / `Likelihood` は**日本語の値をそのまま永続化する**。[データモデル](../db/data-model.md)の定義がそうなっており、CSV出力（F-8-3）でも同じ文字列を列値として使うため、英語コードとの相互変換層を設けない。

## 2. 識別子

```ts
export type TenantId = string;
export type StaffUserId = string;
export type MemberId = string;
export type ApplicationId = string;
export type CheckRunId = string;
export type MatchCandidateId = string;
export type SessionId = string;

/** 期間キー `YYYY-MM`（JST）。UsageCounter の PK（NF-2-19） */
export type PeriodKey = string;

/** R2オブジェクトキー `{tenantId}/{applicationId}.{ext}`（NF-5-21） */
export type ImageKey = string;
```

> 実体はすべて `string` のエイリアスであり、相互代入をコンパイラは防がない。**テナント越境を型で防ぐのは ID の branding ではなく §9 のスコープ済みハンドルである**（NF-5-6）。ID の branding は導入しない（記述量に対して得られる保証が小さいため）。

## 3. OCR 抽出（F-2）

AIが生成する値と、アプリケーションが付与する値を**別の型に分ける**。

```ts
/** クライアント側で長辺1568px・JPEG品質85%へリサイズ済みの画像（F-2-2） */
export interface PreparedImage {
  /** データURLスキームを含まない base64 本体 */
  base64: string;
  mimeType: 'image/jpeg' | 'image/png';
}

/** Gemini が Structured Outputs で返す1項目（F-2-5・F-2-6） */
export interface ExtractedField {
  /** 帳票上のラベル。CSVではこれがそのまま列名になる（F-8-4） */
  label: string;
  /** 空欄の項目も空文字として含める（F-2-5） */
  value: string;
  /** 0〜1。AIの自己申告値であり精度保証ではない（overview.md 制約6） */
  confidence: number;
}

/** Pass① の出力。MVP 1.0 / 1.1 で同一（F-2-13・AI-6） */
export interface ExtractedApplication {
  /** 帳票種別（F-2-4）。例: 利用者登録申請書 */
  docType: string;
  fields: ExtractedField[];
}

/** OCR Pipeline 境界（NF-4-2・ai-api.md 実装設計） */
export interface OcrPipeline {
  extract(image: PreparedImage): Promise<ExtractedApplication>;
}

/** Application.fieldsJson に永続化する形。edited はアプリケーションが付与する（F-4-5） */
export interface ApplicationField extends ExtractedField {
  /** 職員が値を編集した項目に true。読取直後は全項目 false */
  edited: boolean;
}
```

> `ExtractedApplication` と `ApplicationField` を分ける理由: `edited` はAIの出力ではない。同一の型を使い回すと、Gemini の Structured Outputs スキーマに `edited` を含めるのか否かが実装ごとにぶれる。**AIへ要求するスキーマは `ExtractedApplication` に一致させる**（AI-6）。

## 4. AI業務チェック（F-3）

```ts
/** 項目間の論理矛盾（F-3-1） */
export interface ConsistencyIssue {
  /** 矛盾に関与する項目のラベル。例: ['郵便番号', '住所'] */
  labels: string[];
  severity: Severity;
  message: string;
}

/** 必須項目の記入漏れ。任意項目の空欄は含めない（F-3-2） */
export interface Deficiency {
  label: string;
  message: string;
}

/** Pass② の出力。CheckRun へ永続化する */
export interface CheckResult {
  triage: Triage;
  /** 1〜2文（F-3-4） */
  triageReason: string;
  /** CheckRun.consistencyJson */
  consistency: ConsistencyIssue[];
  /** CheckRun.deficienciesJson */
  deficiencies: Deficiency[];
  /**
   * 差戻し文面の下書き。敬体・200字以内・宛名と差出人はプレースホルダ（F-3-5）。
   * 不備または矛盾がない場合は null（生成しない）
   */
  letterDraft: string | null;
}

/** 業務チェックの実行履歴1件（F-3-7） */
export interface CheckRunView extends CheckResult {
  id: CheckRunId;
  applicationId: ApplicationId;
  createdBy: StaffUserSummary;
  createdAt: string;
}
```

> `letterDraft` を `null` 許容にするのは F-3-5 が「不備または矛盾がある場合のみ生成する」と定めるため。空文字と `null` を混在させない。

## 5. 名寄せ（F-6）

```ts
/** 第1段の決定的な正規化結果。AIを呼ばない（F-6-1・F-6-12） */
export interface NormalizedKeys {
  /** 旧字体・異体字統一 + NFKC + ひらがな→カタカナ（F-6-1） */
  nameNormalized: string;
  kanaNormalized: string;
  /** 和暦→西暦を含む統一。YYYY-MM-DD */
  birthDateNormalized: string | null;
  /** ハイフン除去（F-6-1） */
  phoneNormalized: string | null;
}

/** 第1段のスコアリング内訳（F-6-3）。重みは定数として一元管理する（NF-4-3） */
export interface RuleScoreBreakdown {
  kanaAndBirthDate: boolean;
  phone: boolean;
  nameAndAddressPrefix: boolean;
  total: number;
}

/** 候補カードUIが必要とする1件（F-6-7） */
export interface MatchCandidateView {
  id: MatchCandidateId;
  member: MemberSummary;
  /** 第1段スコア */
  ruleScore: number;
  /** 第2段。第2段未実行なら null（F-6-5） */
  aiLikelihood: Likelihood | null;
  aiReason: string | null;
  status: MatchStatus;
  decidedBy: StaffUserSummary | null;
  decidedAt: string | null;
}
```

> **`rejected` の候補は再提示しない**（F-6-10）。API 応答から除外するのはサーバー側の責務であり、`MatchCandidateView` に `rejected` が現れるのは[重複疑いリスト](./api.md#会員f-5)の履歴表示のみとする。

## 6. エンティティの表現形

一覧用の `Summary` と詳細用の `Detail` を分ける。一覧で不要な項目を返さないことで、NF-1-3（一覧表示1秒以内）の余地を確保する。

```ts
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
  /** 画面の「登録日」（F-5-2） */
  createdAt: string;
  /** 申請履歴。原本画像へのリンクを含む（F-5-6） */
  applications: ApplicationSummary[];
  /** 状態遷移履歴（F-5-6） */
  statusHistory: StatusHistoryEntry[];
}

export interface ApplicationSummary {
  id: ApplicationId;
  docType: string;
  appStatus: AppStatus;
  /** 最新の CheckRun の判定。未実行なら null */
  triage: Triage | null;
  createdBy: StaffUserSummary;
  /** 会員紐付けの有無でフィルタするため、null でも項目自体は必ず返す（F-4-10） */
  member: MemberSummary | null;
  hasImage: boolean;
  createdAt: string;
}

export interface ApplicationDetail extends ApplicationSummary {
  fields: ApplicationField[];
  /** 最新の業務チェック結果（F-3-7）。未実行なら null */
  latestCheckRun: CheckRunView | null;
  /** rejected を除いた未解決・判断済みの候補（F-6-10） */
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
```

> **フィールド名は [列名の規約](../db/data-model.md#列名の規約)に従う。** 行の作成者は `createdBy`、最終更新者は `updatedBy` で統一し、`processedBy` / `lastEditedBy` / `executedBy` / `changedBy` / `registeredAt` のような役割ごとの別名は使わない。**画面に出す日本語ラベル（「処理者」「変更者」「登録日」）は従来どおり**であり、揃えるのは実装側の語彙だけである。

> **`passwordHash` / `failedLoginCount` / `lockedUntil` / `tenantId` はいかなる応答型にも含めない。** `tenantId` を返さないのは、クライアントがそれを保持して送り返す実装を誘発しないため（NF-5-3）。

## 7. API の DTO

エンドポイントとの対応は [APIエンドポイント仕様](./api.md)。

### 認証（F-1）

```ts
export interface LoginRequest {
  email: string;
  password: string;
}

/** ログイン成功時。セッションは Set-Cookie で渡す（F-1-3） */
export interface LoginResponse {
  user: StaffUserSummary;
}

/** 現在のセッション。SPA の初期化時に必ず呼ぶ（F-1-8） */
export interface SessionResponse {
  user: StaffUserSummary;
  /** 画面の出し分けに使う。認可の判断には使わない（F-1-5・NF-2-11） */
  features: {
    /** ALLOW_DATA_RESET が有効なときのみ true。false ならメニューに出さない（F-9-8・screen-list.md） */
    dataReset: boolean;
  };
}
```

### 利用量（NF-2-18・NF-2-34）

```ts
/** ホーム画面に当月の残り読取可能枚数を表示するために使う（screen-list.md） */
export interface UsageResponse {
  period: PeriodKey;
  ocrPages: number;
  ocrPagesLimit: number;
  ocrPagesRemaining: number;
  geminiCalls: number;
  geminiCallsLimit: number;
}
```

### 帳票読取（F-2）

```ts
export interface OcrExtractRequest {
  image: PreparedImage;
}

/** 読取完了と同時に申請レコードが保存済みであること（F-2-8） */
export interface OcrExtractResponse {
  application: ApplicationDetail;
  /** 加算後の利用量。画面の残枚数表示を再取得なしで更新する */
  usage: UsageResponse;
}
```

### 申請管理（F-4）

```ts
export interface ApplicationListQuery {
  appStatus?: AppStatus;
  triage?: Triage;
  createdById?: StaffUserId;
  /** 会員紐付けの有無（F-4-10） */
  linked?: boolean;
  /** 「要審査のみ」ビュー（F-4-11）。triage=要審査 の別名ではなく専用フラグとする */
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

/** 項目の編集（F-4-5）。confidence は変更させない */
export interface UpdateFieldsRequest {
  fields: Array<{ label: string; value: string }>;
}

/** ステータス変更（F-4-2・F-4-4） */
export interface ChangeAppStatusRequest {
  toStatus: AppStatus;
  note?: string;
}

/** 承認時に会員が pending から active へ昇格した場合、その事実を返す（F-4-3） */
export interface ChangeAppStatusResponse {
  application: ApplicationDetail;
  promotedMember: MemberSummary | null;
}
```

### 業務チェック（F-3・F-4-6）

```ts
export interface RunCheckRequest {
  applicationId: ApplicationId;
}

export interface RunCheckResponse {
  checkRun: CheckRunView;
  /** 第1段＋第2段で得た候補（F-4-9） */
  matchCandidates: MatchCandidateView[];
  /** 受付 から 審査中 へ自動遷移した場合に反映済みの申請（F-4-7） */
  application: ApplicationDetail;
  usage: UsageResponse;
  /** 残りの再実施可能回数（NF-2-21）。画面で事前に示すため */
  remainingRuns: number;
}
```

### 名寄せの判断（F-6-8・F-6-9）

```ts
export interface DecideMatchRequest {
  /** merged=同一人物として紐付け / rejected=別人 / hold=保留 */
  decision: Exclude<MatchStatus, 'pending'>;
}

export interface DecideMatchResponse {
  candidate: MatchCandidateView;
  /** merged のとき、memberId を設定した申請を返す */
  application: ApplicationDetail;
}
```

### 会員（F-5）

```ts
export interface MemberListQuery {
  /** 氏名・カナの部分一致。正規化を適用し「渡辺」で「渡邊」がヒットする（F-5-4・F-5-5） */
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

/** memberNumber は自動採番のため受け取らない（F-5-2・NF-5-20） */
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

export type UpdateMemberRequest = Partial<Omit<CreateMemberRequest, 'status'>>;

/** 状態の手動変更。理由を必須とする（F-5-7） */
export interface ChangeMemberStatusRequest {
  toStatus: MemberStatus;
  reason: string;
}
```

### スタッフ管理（F-7・admin のみ）

```ts
export interface CreateStaffRequest {
  email: string;
  name: string;
  password: string;
  role: Role;
}

/** 無効化は isActive: false で行う。物理削除の口を設けない */
export interface UpdateStaffRequest {
  name?: string;
  role?: Role;
  isActive?: boolean;
  /** 指定時のみ再ハッシュする */
  password?: string;
}
```

### CSV入出力（F-8）

```ts
export interface ImportMembersResponse {
  /** 成功件数 */
  imported: number;
  /** 会員番号が既存と一致してスキップした件数（F-8-7） */
  skipped: number;
  /** バリデーションエラーでスキップした行（F-8-8） */
  errors: Array<{ row: number; message: string }>;
}
```

### デモデータのリセット（F-9・admin のみ）

```ts
/** 実行前に削除対象の件数を提示する（F-9-7） */
export interface ResetPreviewResponse {
  applications: number;
  images: number;
  /** isSeed = false の会員のみ（F-9-3） */
  members: number;
  /** 入力を求める確認語。画面にそのまま表示する */
  confirmationWord: string;
}

export interface ResetRequest {
  /** ResetPreviewResponse.confirmationWord と完全一致しなければ実行しない（F-9-7） */
  confirmation: string;
}

export interface ResetResponse {
  deleted: { applications: number; images: number; members: number };
  /** 常に false。画面に「当月のAI呼び出し上限は回復しない」旨を表示する（F-9-9・NF-2-40） */
  usageCounterReset: false;
}
```

## 8. 環境設定

環境変数の一覧と未設定時の挙動は [非機能要件](../requirements/non-functional.md#環境変数の一覧統合)が正典。ここではその型表現のみを示す。

```ts
/** wrangler のバインディングと環境変数（未検証の生の値） */
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  /** run_worker_first = true と併用する（NF-2-27） */
  ASSETS: Fetcher;

  TENANT_ID: string;
  PBKDF2_ITERATIONS: string;
  ALLOW_WEAK_PASSWORD_HASH?: string;
  MAX_OCR_PAGES_PER_MONTH: string;
  MAX_GEMINI_CALLS_PER_MONTH: string;
  MAX_CHECK_RUNS_PER_APPLICATION: string;
  ALLOW_DATA_RESET?: string;
  OCR_PIPELINE_MODE: string;
  GEMINI_MODEL: string;

  // Workers Secret
  BASIC_AUTH_USERNAME: string;
  BASIC_AUTH_PASSWORD: string;
  GEMINI_API_KEY: string;

  // MVP 1.1 のみ必須（NF-4-7）
  GOOGLE_CLOUD_PROJECT_ID?: string;
  DOCUMENT_AI_LOCATION?: string;
  DOCUMENT_AI_PROCESSOR_ID?: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
}

/**
 * 起動時の検証を通過した設定。上限値を参照する箇所はこの1モジュールへ集約する（NF-2-36）。
 * 検証に失敗した場合は値を返さず起動を失敗させる（NF-2-5・NF-2-18・NF-2-34・NF-2-35・NF-4-5・NF-5-4）。
 */
export interface Config {
  tenantId: TenantId;
  pbkdf2Iterations: number;
  maxOcrPagesPerMonth: number;
  maxGeminiCallsPerMonth: number;
  maxCheckRunsPerApplication: number;
  allowDataReset: boolean;
  ocrPipelineMode: OcrPipelineMode;
  geminiModel: string;
}

export declare function loadConfig(env: Env): Config;
```

> `Config` に `basicAuth` や `geminiApiKey` を含めない。**秘密値は検証済み設定オブジェクトに載せず、必要な箇所で `Env` から直接読む。** `Config` は画面・ログ・エラー応答に混入しやすい値であり、載せた時点で NF-2-26 / NF-2-13 の違反経路ができる。

## 9. テナントスコープ済みハンドル（NF-5-6・NF-5-7）

[テナント分離](../requirements/tenant-isolation.md#第1層-型でスコープ外のアクセスを不可能にする-mvp対象)の第1層を型で表現したもの。**本ページで最も重要な型である。**

```ts
/**
 * tenantId の唯一の供給源（NF-5-1）。
 * MVP では Config.tenantId を返す。マルチテナント化時はこの実装のみをセッション参照へ差し替える。
 * リポジトリ層・ハンドラから TENANT_ID を直接参照してはならない（NF-5-2）。
 */
export declare function currentTenantId(c: RequestContext): TenantId;

/**
 * スコープ済みハンドル。tenantId 条件を内部で必ず AND 結合し、
 * 呼び出し側が渡す where はこれに追加されるのみで上書き・除去できない（NF-5-7）。
 */
export interface ScopedDb {
  select<T>(table: TenantScopedTable, where?: SqlExpr): Promise<T[]>;
  selectOne<T>(table: TenantScopedTable, where: SqlExpr): Promise<T | null>;
  insert<T>(table: TenantScopedTable, values: Omit<T, 'tenantId'>): Promise<T>;
  update<T>(table: TenantScopedTable, values: Partial<T>, where: SqlExpr): Promise<number>;
  delete(table: TenantScopedTable, where: SqlExpr): Promise<number>;
}

export declare function forTenant(tenantId: TenantId): ScopedDb;
```

**この型が守るべき制約:**

- `ScopedDb` を返す `forTenant()` **以外に Drizzle / D1 のハンドルを export しない**（NF-5-6）。リポジトリ層の外にクエリを組み立てる経路をコンパイル時に存在させない
- `insert` の `values` から `tenantId` を `Omit` する。呼び出し側が別テナントの ID を渡す余地をなくす
- `UsageCounter` は `tenantId` を持たない唯一のテーブルであり（NF-2-41）、`TenantScopedTable` に含めない。**専用の別モジュールから扱い、業務データへの参照を持たせない**（[データモデル](../db/data-model.md#他テーブルと異なる3点)）
- JOIN を行うヘルパを追加する場合、結合先テーブルにも個別に条件を付与する（NF-5-17）

## 10. エラー

全APIで共通のエラー本体。詳細な対応表は [APIエンドポイント仕様](./api.md#エラー)。

```ts
export interface ApiError {
  error: {
    code: ErrorCode;
    /** 画面にそのまま表示してよい日本語。秘密値・スタックを含めない（NF-2-26） */
    message: string;
    /** true のときのみ画面に再試行ボタンを出す（F-2-14） */
    retryable?: boolean;
  };
}

export type ErrorCode =
  | 'UNAUTHENTICATED'        // 401 未ログイン（NF-2-10）
  | 'INVALID_CREDENTIALS'    // 401 ログイン失敗。文言は統一する（F-1-7）
  | 'FORBIDDEN'              // 403 ロール不足（NF-2-11）
  | 'NOT_FOUND'              // 404 他テナントのIDを含む（NF-5-16）
  | 'INVALID_TRANSITION'     // 409 許可されないステータス遷移（F-4-2）
  | 'CHECK_RUN_LIMIT'        // 409 再実施回数の上限（NF-2-21）
  | 'VALIDATION_ERROR'       // 422 入力値の不備
  | 'USAGE_LIMIT_EXCEEDED'   // 429 月次上限（NF-2-16・NF-2-20）
  | 'AI_UNAVAILABLE'         // 503 Gemini / Document AI の失敗（F-2-14）
  | 'INTERNAL';              // 500
```

> **`INVALID_CREDENTIALS` の `message` は成否要因を問わず「メールまたはパスワードが違います」で固定する**（F-1-7）。アカウントのロック中（F-1-6）も同一の応答とする。ロック状態を別コード・別文言で返すと、アカウントの存在が推測可能になり F-1-7 の目的が失われる。

## 設計判断（要件に明記がない箇所）

以下は要件に定めがなく、本ページで決めた事項である。**要件を変更するものではないが、異論があればここを起点に見直す。**

| # | 判断 | 理由 |
|---|---|---|
| 1 | ID の branding を導入しない | テナント越境の防止は §9 のスコープ済みハンドルが担う（NF-5-6）。ID の型分離は記述量に対して得る保証が小さい |
| 2 | `ExtractedApplication` と `ApplicationField` を分ける | `edited` はAIの出力ではない。AIへ要求するスキーマ（AI-6）を型で一意にするため |
| 3 | `Summary` と `Detail` を分ける | 一覧表示1秒以内（NF-1-3）の余地を確保する。要件は応答の粒度を定めていない |
| 4 | `letterDraft` を `null` 許容にする | F-3-5 が「不備または矛盾がある場合のみ生成」と定めるため。空文字と混在させない |
| 5 | `SessionResponse.features.dataReset` を設ける | `ALLOW_DATA_RESET` 未設定時にメニューへ出さない（screen-list.md）ために SPA が値を知る必要がある。**認可の判断には使わない**（API側で必ず検証する・F-9-6） |
| 6 | `ChangeMemberStatusRequest.reason` を必須にする | F-5-7 が「理由を記録する」と定めるため。省略可にすると記録が空のまま運用され得る |
| 7 | `needsReviewOnly` を `triage` と別のフラグにする | F-4-11 の「要審査のみ」ビューは日常動線であり、フィルタの組み合わせではなく独立した導線として扱う |
| 8 | `Config` に秘密値を含めない | 設定オブジェクトは画面・ログ・エラーに混入しやすく、載せた時点で NF-2-13 / NF-2-26 の違反経路ができる |

## 関連ページ

- [APIエンドポイント仕様](./api.md) — 各型がどのエンドポイントに割り当たるか
- [データフロー](./dataflow.md) — 型が流れる順序
- [データモデル](../db/data-model.md) — 永続化されるカラムと制約
- [テナント分離](../requirements/tenant-isolation.md) — §9 の根拠
- [外部OCR・AI API](./ai-api.md) — `OcrPipeline` の実装と Structured Outputs
- [機能要件](../requirements/functional.md) / [非機能要件](../requirements/non-functional.md)
