---
type: architecture
title: APIエンドポイント仕様
description: /api/auth /api/usage /api/ocr /api/checks /api/applications /api/members /api/staff /api/images /api/demo の全エンドポイント、認可、ステータスコード、共通のエラー規約
tags: [ai-ocr, api, hono, rest, authorization, tenant-isolation]
timestamp: 2026-08-31T00:00:00Z
---

# APIエンドポイント仕様

> **本ページは要件定義書の章を正典化したものではなく、[機能要件](../requirements/functional.md)・[非機能要件](../requirements/non-functional.md)・[画面一覧](../screens/screen-list.md)から導出した設計である。** 各行に根拠の要件IDを付す。要件に明記がない判断は末尾の[設計判断](#設計判断要件に明記がない箇所)に列挙する。
>
> 要求と応答の型は [共有型定義](./types.md)、処理の流れは [データフロー](./dataflow.md)、ルート群の概観は [システム構成](./cloudflare-stack.md#全体構成)。

**本ページの[エンドポイント一覧](#エンドポイント一覧)は網羅的であることを要件とする。** クロステナント統合テストは、この一覧と検証対象一覧を突き合わせ、**登録されていないエンドポイントが追加された場合にテストを失敗させる**（NF-5-12）。エンドポイントを追加・変更したら、実装より先に本ページを更新する。

## 共通仕様

### 前段: Basic認証（F-1-11〜15）

**静的アセット・SPAの全画面・全APIが、最初に HTTP Basic 認証を通る。** Hono の Basic Auth Middleware を APIハンドラおよび Static Assets 配信より前に適用し（F-1-13）、`assets.run_worker_first = true` で全リクエストを Worker へ通す（NF-2-27）。未認証は `401` と `WWW-Authenticate: Basic` を返す（F-1-11）。

**Basic認証はロール認可を代替しない**（F-1-12）。成功してもアプリ内セッションがなければ保護対象APIは `401` を返す（NF-2-28）。

### 認証とロール

| 表記 | 意味 |
|---|---|
| — | アプリ内セッション不要（Basic認証は必要） |
| 認証済 | 有効なセッションが必要。無い場合 `401`（NF-2-10） |
| admin | `role = admin` のみ。staff は `403`（NF-2-11・F-7-2） |

セッションは HTTPOnly / Secure / SameSite=Lax の Cookie と D1 の `Session` 行で管理する（F-1-3・F-1-4）。**JWT を localStorage に保存しない。** ロール認可は画面側の制御に依存せず、**API レベルで必ず検証する**（F-1-5・overview.md 権限マトリクス）。

### テナント

- **リクエストのパス・クエリ・ヘッダ・ボディに含まれる `tenantId` 相当の値は受け付けない**（NF-5-3）。本ページのどのエンドポイントも `tenantId` を引数に取らない
- テナントは `TENANT_ID` を返す唯一の関数から解決する（NF-5-1）
- **他テナントのレコードIDを指定した場合は `404` を返す**（`403` ではない・NF-5-16）。存在の開示を防ぐため
- 件数・集計・CSV出力もテナント条件の対象（NF-5-18）

### 形式

| 項目 | 規約 |
|---|---|
| リクエスト本文 | `application/json`（CSVインポートのみ `multipart/form-data`） |
| 応答本文 | `application/json`（CSVエクスポートのみ `text/csv`） |
| 日時 | ISO 8601 文字列（`2026-08-25T09:00:00Z`） |
| CSRF | same-origin の fetch と `SameSite=Lax` Cookie で担保する。状態を変更する操作は `GET` を使わない |
| 同時編集 | 排他制御を行わない。後着優先（F-4-12） |

## エンドポイント一覧

| # | メソッド | パス | ロール | 要求 → 応答 | 主なコード | 根拠 |
|---:|---|---|---|---|---|---|
| 1 | POST | `/api/auth/login` | — | `LoginRequest` → `LoginResponse` | 200 / 401 / 422 | F-1-1・F-1-6・F-1-7 |
| 2 | POST | `/api/auth/logout` | 認証済 | — → 204 | 204 / 401 | F-1-10 |
| 3 | GET | `/api/auth/session` | 認証済 | — → `SessionResponse` | 200 / 401 | F-1-8・F-9-8 |
| 4 | GET | `/api/usage` | 認証済 | — → `UsageResponse` | 200 / 401 | NF-2-18・screen-list |
| 5 | POST | `/api/ocr/extract` | 認証済 | `OcrExtractRequest` → `OcrExtractResponse` | 200 / 401 / 422 / 429 / 503 | F-2-8・F-2-13・NF-2-16 |
| 6 | POST | `/api/checks/run` | 認証済 | `RunCheckRequest` → `RunCheckResponse` | 200 / 401 / 404 / 409 / 429 / 503 | F-3・F-4-6 |
| 7 | GET | `/api/applications` | 認証済 | `ApplicationListQuery` → `ApplicationListResponse` | 200 / 401 | F-4-10・F-4-11 |
| 8 | GET | `/api/applications/export.csv` | 認証済 | — → `text/csv` | 200 / 401 | F-8-1〜4 |
| 9 | GET | `/api/applications/:id` | 認証済 | — → `ApplicationDetail` | 200 / 401 / 404 | F-4-5 |
| 10 | PATCH | `/api/applications/:id/fields` | 認証済 | `UpdateFieldsRequest` → `ApplicationDetail` | 200 / 401 / 404 / 422 | F-4-5 |
| 11 | POST | `/api/applications/:id/status` | 認証済 | `ChangeAppStatusRequest` → `ChangeAppStatusResponse` | 200 / 401 / 404 / 409 | F-4-2〜4 |
| 12 | GET | `/api/applications/:id/check-runs` | 認証済 | — → `CheckRunView[]` | 200 / 401 / 404 | F-3-7 |
| 13 | PATCH | `/api/applications/:id/match-candidates/:candidateId` | 認証済 | `DecideMatchRequest` → `DecideMatchResponse` | 200 / 401 / 404 | F-6-8・F-6-9 |
| 14 | GET | `/api/images/:applicationId` | 認証済 | — → `{ url, expiresAt }` | 200 / 401 / 404 | NF-2-14・NF-5-19 |
| 15 | DELETE | `/api/applications/:id/image` | 認証済 | — → 204 | 204 / 401 / 404 | NF-3-2 |
| 16 | GET | `/api/members/match-candidates` | 認証済 | — → `MatchCandidateView[]` | 200 / 401 | F-5-9 |
| 17 | GET | `/api/members/export.csv` | 認証済 | — → `text/csv` | 200 / 401 | F-8-9 |
| 18 | POST | `/api/members/import` | 認証済 | `multipart/form-data` → `ImportMembersResponse` | 200 / 401 / 413 / 422 | F-8-5〜8 |
| 19 | GET | `/api/members` | 認証済 | `MemberListQuery` → `MemberListResponse` | 200 / 401 | F-5-4・F-5-5 |
| 20 | POST | `/api/members` | 認証済 | `CreateMemberRequest` → `MemberDetail` | 201 / 401 / 422 | F-5-1・NF-5-20 |
| 21 | GET | `/api/members/:id` | 認証済 | — → `MemberDetail` | 200 / 401 / 404 | F-5-6 |
| 22 | PATCH | `/api/members/:id` | 認証済 | `UpdateMemberRequest` → `MemberDetail` | 200 / 401 / 404 / 422 | F-5-1・F-6-2 |
| 23 | POST | `/api/members/:id/status` | 認証済 | `ChangeMemberStatusRequest` → `MemberDetail` | 200 / 401 / 404 / 422 | F-5-7 |
| 24 | GET | `/api/staff` | **admin** | — → `StaffUserSummary[]` | 200 / 401 / 403 | F-7-1・F-7-2 |
| 25 | POST | `/api/staff` | **admin** | `CreateStaffRequest` → `StaffUserSummary` | 201 / 401 / 403 / 422 | F-7-1 |
| 26 | PATCH | `/api/staff/:id` | **admin** | `UpdateStaffRequest` → `StaffUserSummary` | 200 / 401 / 403 / 404 | F-7-1 |
| 27 | GET | `/api/demo/reset/preview` | **admin** | — → `ResetPreviewResponse` | 200 / 401 / 403 / **404** | F-9-6〜8 |
| 28 | POST | `/api/demo/reset` | **admin** | `ResetRequest` → `ResetResponse` | 200 / 401 / 403 / **404** / 422 | F-9-6〜9 |

> **ルートの登録順に注意する。** Hono は登録順に照合するため、`/api/applications/export.csv`（#8）は `/api/applications/:id`（#9）より**先に**登録しないと `:id = "export.csv"` として一致する。`/api/members/match-candidates`（#16）・`/api/members/export.csv`（#17）・`/api/members/import`（#18）と `/api/members/:id`（#21）も同様。本表は**この順序どおりに並べてある。**

> **申請を新規作成するエンドポイントは存在しない。** 申請は読取完了（#5）でのみ作成される（F-2-8）。会員も物理削除の口を持たない（F-5-8）。

## 認証（F-1）

### `POST /api/auth/login`

```
→ { "email": "...", "password": "..." }
← 200 { "user": { "id", "name", "email", "role", "isActive" } }
   Set-Cookie: session=<id>; HttpOnly; Secure; SameSite=Lax; Path=/
← 401 { "error": { "code": "INVALID_CREDENTIALS", "message": "メールまたはパスワードが違います" } }
```

- パスワード検証は**保存された反復回数**で再計算する（NF-2-3）。ハッシュは `pbkdf2-sha256$<iterations>$<salt>$<hash>` 形式（NF-2-2）
- 失敗が連続5回で当該アカウントを15分ロックする（F-1-6）。カウンタは `StaffUser.failedLoginCount` / `lockedUntil`
- **ロック中も応答は上の `401` と完全に同一とする**（F-1-7）。別コード・別文言・`Retry-After` ヘッダのいずれも返さない。ロック状態を区別可能にすると、アカウントの存在が推測できる
- `isActive = false` の職員も同一の `401`
- 成功時、保存された反復回数が現在の既定値を下回る場合はハッシュを再生成して更新する（NF-2-9）

> **CPU時間に注意する。** PBKDF2 は Workers の 10ms/リクエスト制約に直接効く唯一の処理である（NF-2-7）。`wrangler dev` では制限が適用されないため、実測は `--remote` か本番デプロイ後（OP-6）。

### `POST /api/auth/logout`

サーバー側の `Session` 行を削除し（F-1-10）、Cookie を失効させる。

### `GET /api/auth/session`

SPA の初期化時に必ず呼び、`401` ならログイン画面へリダイレクトする（F-1-8）。`features.dataReset` は `ALLOW_DATA_RESET` の有効・無効を反映する（F-9-8）。**これは画面の出し分け専用であり、認可の判断には使わない**（#27・#28 は API 側で必ず検証する・F-9-6）。

## 利用量（NF-2-18・NF-2-34）

### `GET /api/usage`

ホーム画面に**当月の残り読取可能枚数**を表示するために使う（screen-list.md。商談中に予告なく上限へ到達することを防ぐ）。

`UsageCounter` の `period` が現在の期間キー（`YYYY-MM`・**JST**）と一致しない場合は 0 として扱う（NF-2-19）。**本エンドポイントはカウンタを加算しない**（読み取りのみ）。

## 帳票読取（F-2）

### `POST /api/ocr/extract`

```
→ { "image": { "base64": "...", "mimeType": "image/jpeg" } }
← 200 { "application": ApplicationDetail, "usage": UsageResponse }
← 429 { "error": { "code": "USAGE_LIMIT_EXCEEDED", "message": "..." } }
← 503 { "error": { "code": "AI_UNAVAILABLE", "message": "...", "retryable": true } }
```

処理順序は [データフロー](./dataflow.md#帳票読取f-2)を参照。要点のみ:

1. **カウンタの加算を AI 呼び出しの前に行う**（NF-2-39）。加算は単一の条件付き UPDATE（`WHERE period = ? AND ocrPages < ?`）で行い、**影響行数 0 を上限到達として `429`** を返す。読んでから判定する実装にしない
2. 上限到達時は **AI を呼び出さずに終了する**（fail closed・NF-2-16）。`message` には翌月まで待つか `MAX_OCR_PAGES_PER_MONTH` の引き上げ（再デプロイ）が必要である旨を含める。**F-9 のリセットでは解除されない**（NF-2-20）
3. `OcrPipeline.extract()` のみを呼ぶ。ハンドラに Gemini / Document AI 固有のコードを置かない（NF-4-2・AI-1）
4. **読取完了と同時に `Application` を保存する**（ステータス `受付`・F-2-8）。原本画像を R2 の `{tenantId}/{applicationId}.{ext}` へ保存する（F-2-9・NF-5-21）
5. **読取完了前に失敗した場合、未完成の申請レコードを作成しない**（ai-api.md）
6. MVP 1.1 で Document AI が失敗しても **Gemini 単体へ自動フォールバックしない**（F-2-14）。`retryable: true` の `503` を返す
7. Document AI の生レスポンスと全文OCRテキストは**永続化しない**（F-2-15）

**画像は 1申請 = 1枚**（F-2-3）。複数枚・両面は受け付けない。リサイズはクライアント側で完了している前提であり、Worker 側で画像処理を行わない（F-2-2）。

## 業務チェック（F-3・F-4-6）

### `POST /api/checks/run`

```
→ { "applicationId": "..." }
← 200 { "checkRun", "matchCandidates", "application", "usage", "remainingRuns" }
← 409 { "error": { "code": "INVALID_TRANSITION", ... } }   // 承認済みの申請
← 409 { "error": { "code": "CHECK_RUN_LIMIT", ... } }      // 再実施回数の上限
```

- 実行可能なのは `received`（受付）/ `under_review`（審査中）/ `returned`（差戻し）の申請のみ。**`approved`（承認）済みでは実施不可**（F-4-6）
- 1申請あたりの `CheckRun` 件数が `MAX_CHECK_RUNS_PER_APPLICATION`（MVP 5）に達していれば `409`（NF-2-21）
- Gemini 呼び出し回数のカウンタも加算対象（Pass①・Pass②の合算・NF-2-17・NF-2-34）。上限到達は `429`
- **`received`（受付）の申請は自動的に `under_review`（審査中）へ遷移する**（F-4-7）。遷移は `AppStatusHistory` に記録する
- 結果は新たな `CheckRun` として記録し（F-4-8）、`Application.latestCheckRunId` を更新する
- 名寄せは第1段（決定的スコアリング・F-6-12）→ 第2段（スコア内訳からのルールベース可能性判定・F-6-5・[決定#27](../requirements/decisions.md)）の順。**どちらもAIを呼ばず、既存会員の個人情報を送信しない。** `rejected` 済みの組み合わせは再提示しない（F-6-10）
- 既存の `MatchCandidate` は `UNIQUE(applicationId, memberId)` により重複登録されず、`ruleScore` / `aiLikelihood` を更新する

## 申請管理（F-4）

### `GET /api/applications`

`appStatus` / `triage` / `createdById` / `linked`（会員紐付けの有無）でフィルタする（F-4-10）。`needsReviewOnly=true` は「要審査のみ」ビュー（F-4-11）。

### `PATCH /api/applications/:id/fields`

抽出項目の編集（F-4-5）。`Application.updatedById` と `editedCount` を更新し、対象項目の `edited` を `true` にする。**`confidence` は変更しない**（AIの出力値であり編集の対象ではない）。

### `POST /api/applications/:id/status`

許可される遷移は次のとおり（F-4-1・F-4-2）。それ以外は `409 INVALID_TRANSITION`。

| From | To |
|---|---|
| `received`（受付） | `under_review`（審査中） |
| `under_review`（審査中） | `approved`（承認） / `returned`（差戻し） |
| `returned`（差戻し） | `under_review`（審査中） |
| `approved`（承認） | **なし（確定状態）** |

- すべての変更を `AppStatusHistory` に記録する（変更者・日時・前後の状態・備考・F-4-4）
- **`承認` へ変更した際、紐付く会員が `pending` であれば `active` へ昇格させ、`StatusHistory` に記録する**（F-4-3）。昇格した場合のみ応答の `promotedMember` に会員を返す

### `GET /api/applications/:id/check-runs`

業務チェックの実行履歴（F-3-7）。新しい順。

### `GET /api/applications/export.csv`

台帳エクスポート（F-8-1〜4）。

- **BOM 付き UTF-8**（`﻿` を先頭に付す）。Excel で文字化けさせない（F-8-1）
- 帳票種別ごとにワイド形式（項目を列に展開・F-8-2）
- AI判定・判定理由・処理者名の列を含める（F-8-3）
- **項目ラベルはAIの出力をそのまま列名に使う**（マスタによる正規化を行わない・F-8-4）
- 件数もテナント条件の対象（NF-5-18）

## 名寄せ（F-6）

### `PATCH /api/applications/:id/match-candidates/:candidateId`

```
→ { "decision": "merged" | "rejected" | "hold" }
```

- `merged` = 同一人物として紐付け。`Application.memberId` を設定する
- `rejected` = 別人。**以降、業務チェックを再実施しても候補として再提示しない**（F-6-10）
- `hold` = 保留。重複疑いリスト（#16）に残る
- 判断結果・判断者・日時を `MatchCandidate` に保存する（F-6-9）

> **名寄せはテナント分離の最重点対象である**（NF-5-13）。氏名照合は全会員を走査するため、条件が抜けた場合の照合相手が必ず他テナントのデータになる。クロステナント統合テストの重点対象とする。

## 会員（F-5）

### `GET /api/members`

`q` は氏名・カナの部分一致（F-5-4）。**検索キーにも F-6-1 の正規化を適用し、「渡辺」で「渡邊」がヒットすること**（F-5-5）。照合は `nameNormalized` / `kanaNormalized` の複合インデックス（`tenantId` が先頭列）を使う。

### `POST /api/members` / `PATCH /api/members/:id`

- `memberNumber` は**テナント単位の連番**として自動採番する（`MAX + 1` を同一テナント内で算出・NF-5-20）。リクエストからは受け取らない
- 登録・編集時に `nameNormalized` / `kanaNormalized` を再計算する（F-6-2）。**表示・出力に使う原文は変更しない**
- `phone` はハイフンを除去して保存する
- 正規化には Git 管理の JSON 対応表を使う。**実行時のDB問い合わせを行わない**（F-6-11・NF-4-4）

### `POST /api/members/:id/status`

状態の手動変更（F-5-7）。変更者・日時・**理由**を `StatusHistory` に記録する。**物理削除は行わない。無効化は `inactive` への変更で表す**（F-5-8）。

### `GET /api/members/match-candidates`

**重複疑いリスト**（F-5-9）。未解決（`pending` / `hold`）の候補を一覧する。

### `POST /api/members/import` / `GET /api/members/export.csv`

- UTF-8 と Shift_JIS の両方を受け付ける（F-8-5）
- **1回あたり 500件を上限**とする（CPU時間制約・F-8-6）。超過は `413`
- **新規登録（インサート）のみ。既存会員の更新は行わない。** 重複判定は会員番号で行い、既存に一致する行はスキップする（F-8-7）
- バリデーションエラーの行はスキップし、成功件数／スキップ件数／エラー内容を返す（F-8-8）
- エクスポートはインポートと同一形式（F-8-9）

## スタッフ管理（F-7・admin のみ）

**staff ロールが呼び出した場合は `403`**（F-7-2・NF-2-11）。画面側の制御だけに依存しない。無効化は `isActive: false` で行い、削除エンドポイントを設けない。

## 原本画像

### `GET /api/images/:applicationId`

```
← 200 { "url": "https://...", "expiresAt": "2026-08-25T09:15:00Z" }
```

- **署名付きURL経由でのみ配信する。有効期限15分。直接URLでのアクセスを不可とする**（NF-2-14）
- **発行前に、対象オブジェクトキーの `{tenantId}/` プレフィックスが現在のテナントと一致することを検証する**（NF-5-19）
- 保持期間は30日。経過後は削除する（NF-3-1）

Workerはアプリ内セッションとテナントprefixを検証した後、R2 S3互換APIの**GET署名URLを都度発行する**。URLの有効期限は15分であり、DB・localStorage・ログへ保存しない。申請一覧・詳細の再表示時、または失効後の画像再読込時は、本エンドポイントを再度呼び出して新しいURLを取得する。

発行に必要な `R2_S3_ACCESS_KEY_ID` / `R2_S3_SECRET_ACCESS_KEY` はWorkers Secret、`R2_ACCOUNT_ID` は通常の環境変数として設定する。発行専用のR2 APIトークンは必要最小限の権限に限定する。判断の根拠は[判断記録 #18](../requirements/decisions.md#確定事項)と[Cloudflare R2の署名URL仕様](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)を参照する。

### `DELETE /api/applications/:id/image`

申請詳細画面からの個別削除（NF-3-2）。R2 のオブジェクトを削除し、`Application.imageKey` を `NULL` にする。

## デモデータのリセット（F-9・admin のみ）

### `GET /api/demo/reset/preview` / `POST /api/demo/reset`

- **`ALLOW_DATA_RESET=true` でなければ両エンドポイントとも `404` を返す**（`403` ではない・F-9-8）。機能の存在自体を露出させない
- **admin のみ。API レベルで検証する**（F-9-6）
- **確認語の入力を必須とする**（F-9-7）。`preview` が返す `confirmationWord` と完全一致しなければ実行しない。ボタン1つで実行できてはならない
- 削除対象の件数（申請・画像・会員）を事前に提示する（F-9-7）
- 実行結果として削除件数を返し、**「当月のAI呼び出し上限は回復しない」旨を表示する**（F-9-9・NF-2-40）
- 実行の事実（実行者・日時・削除件数）をログに出力する。**削除対象のテーブルには記録しない**（F-9-10）

削除対象と実行順序は [データフロー](./dataflow.md#デモデータのリセットf-9)を参照。**`StaffUser` / `Tenant` / `Session` / `UsageCounter` は削除しない**（F-9-5）。実行者はログインしたまま作業を継続できる。

## エラー

```json
{ "error": { "code": "USAGE_LIMIT_EXCEEDED", "message": "...", "retryable": false } }
```

| コード | HTTP | 用途 | 根拠 |
|---|---:|---|---|
| `UNAUTHENTICATED` | 401 | セッションなし。API直接呼び出しでも返す | NF-2-10 |
| `INVALID_CREDENTIALS` | 401 | ログイン失敗。**文言を「メールまたはパスワードが違います」に統一** | F-1-7 |
| `FORBIDDEN` | 403 | staff が admin 専用APIを呼んだ | NF-2-11・F-7-2 |
| `NOT_FOUND` | 404 | 存在しない、または**他テナントのレコード** | NF-5-16 |
| `INVALID_TRANSITION` | 409 | 許可されないステータス遷移 | F-4-2 |
| `CHECK_RUN_LIMIT` | 409 | 再実施回数が上限 | NF-2-21 |
| `VALIDATION_ERROR` | 422 | 入力値の不備 | — |
| `USAGE_LIMIT_EXCEEDED` | 429 | 月次上限（fail closed） | NF-2-16・NF-2-20 |
| `AI_UNAVAILABLE` | 503 | Gemini / Document AI の失敗。`retryable: true` | F-2-14 |
| `INTERNAL` | 500 | 上記以外 | — |

**エラー応答に含めてはならないもの**（違反すると要件違反になる）:

- Basic認証の資格情報・`Authorization` ヘッダの内容（NF-2-26・F-1-14）
- AI APIキー、サービスアカウント秘密鍵、OAuthアクセストークン（NF-2-13・ai-api.md）
- Document AI のリクエスト・レスポンス、OCR全文、元画像（NF-2-32）
- アカウントの存在有無を推測させる情報（F-1-7）

エラー応答は Hono の `onError` で一元化する。

## 設計判断（要件に明記がない箇所）

| # | 判断 | 理由 |
|---|---|---|
| 1 | 上限到達を `429`、遷移違反・回数上限を `409` とする | 要件はコードを定めていない。「一時的で待てば解消する」（月次上限）と「現在の状態では不可能」（遷移・回数）を分ける |
| 2 | 名寄せの判断を `/api/applications/:id/match-candidates/:candidateId` に置く | 判断は申請に紐づく操作である。[システム構成](./cloudflare-stack.md#全体構成)のルート群を増やさずに済む |
| 3 | 重複疑いリストを `/api/members/match-candidates` に置く | 会員側の横断ビューであり特定の申請に属さない。同構成の「`/api/members/*` に名寄せ第1段」の区分に合わせる |
| 4 | `/api/usage` と `/api/demo/*` を新設する | [システム構成](./cloudflare-stack.md#全体構成)のルート樹形図は概略で、F-8・F-9 と残枚数表示のルートを含んでいなかった。同図にも追記済み |
| 5 | 確認語を `RESET` とする | F-9-7 は入力を求めることのみを定める。IME を経由せず入力でき、誤入力しにくい値を選んだ |
| 6 | CSVエクスポートをパス拡張子（`export.csv`）で表す | ブラウザのダウンロード時のファイル名が自然に決まる。`Accept` ヘッダ分岐にしない |
| 7 | ログインのロック中も通常の失敗と同一応答にする | F-1-7 の目的（アカウント存在の秘匿）は、ロックを区別可能にすると失われる。`Retry-After` も返さない |
| 8 | 申請の新規作成エンドポイントを設けない | F-2-8 により申請は読取完了時のみ生成される。作成の口を別に設けると経路が二重化する |
| 9 | セッションの有効期間を **12時間**とする | 要件は期間を定めていない。商談1日分を賄い、かつ放置端末が翌日まで開いたままにならない長さ。失効の判断は `Session.expiresAt` をサーバー側で見る（Cookie に `Expires` を付けない） |
| 10 | 無効化された職員（`isActive = false`）の既存セッションを失効させる | F-7-1 の無効化が次回ログインまで効かないと、無効化の意味が失われる。`GET /api/auth/session` を含む全ての保護対象APIが `401` になる |
| 11 | ログインは成否によらず **常に1回だけ**鍵導出を行う | アカウントが存在しない場合に PBKDF2 を丸ごと省くと、応答時間の桁違いの差からアカウントの存在が判別でき F-1-7 の秘匿が破れる。存在しない場合もダミーのソルトで同じ計算を行う。**ただし時間差の隠蔽は best-effort である**（下記の注記を参照） |

> **F-1-7 の秘匿について、応答時間で保証できる範囲**（判断 #11 の限界）
>
> - **保証する**: 成否・アカウントの存否によらず鍵導出は必ず1回行う。したがって「不在なら即座に返る」形の桁違いの時間差は生じない。
> - **保証しない**: 存在しないアカウントでは `PBKDF2_ITERATIONS`、既存アカウントでは**保存された反復回数**で計算する（NF-2-3）。したがって反復回数を変更した直後は、旧回数のまま残っているアカウントの応答時間が他と異なり得る。NF-2-9 の再ハッシュは**初回のログイン成功時にのみ**起きるため、ログインされない限りこの差は解消しない。
> - したがって **F-1-7 の一次的な防御は応答本文とステータスコードの完全な同一性である**（`INVALID_CREDENTIALS` の単一文言・`Retry-After` を返さない・判断 #7）。時間差の均一化はそれを補強するものであり、単独では依拠しない。

## 関連ページ

- [共有型定義](./types.md) — 本ページで参照する要求・応答の型
- [データフロー](./dataflow.md) — 各エンドポイント内部の処理順序
- [システム構成](./cloudflare-stack.md) — ルート群の概観と実行環境の制約
- [テナント分離](../requirements/tenant-isolation.md) — NF-5-3・NF-5-12・NF-5-16 の根拠
- [機能要件](../requirements/functional.md) / [非機能要件](../requirements/non-functional.md)
- [画面一覧](../screens/screen-list.md) — どの画面がどのエンドポイントを使うか
- [受け入れ基準](../requirements/acceptance.md)
