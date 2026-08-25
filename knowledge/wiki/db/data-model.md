---
type: db-domain
title: データモデル（D1 テーブル定義）
description: Tenant / StaffUser / Member / Application / CheckRun / MatchCandidate / AppStatusHistory / StatusHistory / Session の9テーブルと複合制約
tags: [ai-ocr, database, d1, drizzle, schema, multi-tenancy]
timestamp: 2026-08-19T00:00:00Z
---

# データモデル（D1 テーブル定義）

> 正典化元: 要件定義書 v1.6 §9（原本は `knowledge/ref/doc/claude_code_要件定義_v1.6.md`）
> テナント対応方針（旧 §9.1）は [テナント分離](../requirements/tenant-isolation.md) に分離した。

ログインする職員（`StaffUser`）と、ログインしない会員（`Member`）は**別テーブルに分離する**（会員に認証情報を持たせないため）。

**全テーブルが `tenantId` を NOT NULL で持ち、全クエリにテナント条件を付与する。** 強制手段は [テナント分離](../requirements/tenant-isolation.md)。

## テーブル一覧

| テーブル | 役割 | 主な制約 |
|---|---|---|
| [Tenant](#tenant--テナント顧客組織) | テナント（顧客組織） | `UNIQUE(code)`。MVP では必ず1件 |
| [StaffUser](#staffuser--職員admin--staff) | 職員アカウント | `UNIQUE(tenantId, email)` |
| [Member](#member--会員ログインなし) | 会員（認証情報なし） | `UNIQUE(tenantId, memberNumber)` + 複合INDEX3本 |
| [Application](#application--申請台帳レコード) | 申請（台帳レコード） | |
| [CheckRun](#checkrun--業務チェック実行結果) | 業務チェックの実行履歴 | 1申請あたり `MAX_CHECK_RUNS_PER_APPLICATION` 件まで |
| [UsageCounter](#usagecounter--ai呼び出しの月次カウンタ) | AI呼び出しの月次カウンタ | 期間キー `YYYY-MM` が PK。**`tenantId` を持たない** |
| [MatchCandidate](#matchcandidate--名寄せ候補と判断結果) | 名寄せ候補と判断結果 | `UNIQUE(applicationId, memberId)` |
| [AppStatusHistory](#appstatushistory--申請ステータス変更履歴) | 申請ステータス変更履歴 | |
| [StatusHistory](#statushistory--会員状態遷移履歴) | 会員状態遷移履歴 | |
| [Session](#session--セッション) | セッション | `tenantId` は MVP では読み取らない |

## Tenant — テナント（顧客組織）

> **MVP では必ず1件のみ**存在する。環境変数 `TENANT_ID` がこの行を指し、起動時に存在と件数を検証する（NF-5-5・NF-5-15）。

| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | PK。各テーブルの `tenantId` が参照する。**不透明な値（ULID等）** |
| code | TEXT | **UNIQUE。** 人間が入力・識別するためのテナントコード（例: `sendai-city`）。将来ログイン時のテナント指定に使用する |
| name | TEXT | 顧客組織名（例: `○○市役所`）。画面表示用 |
| createdAt | DATETIME | |

### `id` と `code` を分ける理由

両者は**別の概念**であり、1つの列で兼ねない。

| | `id`（`tenantId`） | `code`（テナントコード） |
|---|---|---|
| 用途 | 全テーブルの外部キー | 人間による識別・入力 |
| 形式 | ULID 等の不透明な値 | 短く読める文字列 |
| 可変性 | **不変** | 改称され得る |
| 露出 | 内部のみ | ログイン画面・URL 等 |

`code` を主キーとして各テーブルの外部キーに使うと、**テナントの改称時に全テーブルの当該列を更新する必要が生じる。** 分離しておけば `Tenant.code` の1行更新で済む。

`UNIQUE(code)` はテナントを跨いだ**グローバル一意**とする（テナントを識別するための値であり、テナント単位でスコープする対象ではない）。

## StaffUser — 職員（admin / staff）

| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | PK |
| tenantId | TEXT | → Tenant（NOT NULL） |
| email | TEXT | |
| passwordHash | TEXT | 自己記述形式（NF-2-2） |
| name | TEXT | 原文を保持。旧字体・異体字を正規化値で上書きしない |
| role | TEXT | `admin` \| `staff` |
| isActive | BOOLEAN | 既定 true |
| failedLoginCount | INTEGER | 既定 0（F-1-6） |
| lockedUntil | DATETIME | NULL可（F-1-6） |
| createdAt | DATETIME | |

**UNIQUE(tenantId, email)**

> **ログインは従来どおり email で行える。** ログインクエリは `WHERE tenantId = <TENANT_ID> AND email = ?` となり、`tenantId` は設定値から常に確定している（NF-5-1）。したがって `email` が単独で一意である必要はなく、認証時に候補が複数出ることもない。本インデックスがそのまま使用される。
>
> 単独の `UNIQUE(email)` にしない理由は、将来1インスタンスで複数テナントを扱う場合に、同一の担当者・共有アドレスが複数テナントに所属し得るため。ただし**その時点ではログイン前にテナントを特定する手段（サブドメイン、またはログイン画面でのテナントコード入力）が別途必要**になる。MVP には影響しない。

## Member — 会員（ログインなし）

| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | PK |
| tenantId | TEXT | → Tenant（NOT NULL） |
| memberNumber | TEXT | 自動採番（テナント内で 1 から連番・NF-5-20） |
| name | TEXT | |
| nameKana | TEXT | NULL可 |
| nameNormalized | TEXT | JSON対応表と決定的な正規化処理から生成する検索・名寄せ用の値（F-6-1・2・11） |
| kanaNormalized | TEXT | |
| birthDate | DATE | NULL可 |
| postalCode | TEXT | NULL可 |
| address | TEXT | NULL可 |
| phone | TEXT | ハイフン除去して保存 |
| email | TEXT | NULL可 |
| status | TEXT | `pending` \| `active` \| `suspended` \| `inactive` |
| registeredAt | DATETIME | |
| isSeed | BOOLEAN | 既定 false。シード投入された会員のみ true（F-9-2） |

**UNIQUE(tenantId, memberNumber)** — 会員番号はテナントごとに 1 から採番するため、単独の `UNIQUE(memberNumber)` では将来のテナント統合時に**全件が衝突する**。本テーブルが `tenantId` 対応を最優先すべき箇所である。

**INDEX** — 名寄せ・検索に使用する以下3本は、いずれも `tenantId` を先頭列とする複合インデックスとする。インデックスの先頭列は後から変更できないため当初から複合とする。

| インデックス | 用途 |
|---|---|
| `(tenantId, nameNormalized)` | 氏名の正規化照合（F-6） |
| `(tenantId, kanaNormalized)` | カナの正規化照合（F-6） |
| `(tenantId, phone)` | 電話番号一致（F-6） |

> 旧字体・異体字対応表はDBマスターとして保持しない。MVPではGit管理するJSONをアプリケーション資産として同梱し、会員の登録・編集・CSVインポート時に `nameNormalized` を生成する（F-6-11、NF-4-4）。

> `isSeed` は F-9（デモデータのリセット）の保全判定に使う。**シード会員は5件とも `status = active` で投入する**（この事実が[復元処理を不要とする根拠](../requirements/functional.md#シード会員の値を復元しない根拠)になっている）。

## Application — 申請（台帳レコード）

| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | PK |
| tenantId | TEXT | → Tenant（NOT NULL） |
| docType | TEXT | 帳票種別 |
| fieldsJson | TEXT | `[{label, value, confidence, edited}]` |
| imageKey | TEXT | R2オブジェクトキー `{tenantId}/{applicationId}.{ext}`（NF-5-21）・NULL可 |
| appStatus | TEXT | `受付` \| `審査中` \| `承認` \| `差戻し`（既定 `受付`） |
| latestCheckRunId | TEXT | 最新の業務チェック結果への参照・NULL可 |
| lastEditedById | TEXT | → StaffUser・NULL可 |
| editedCount | INTEGER | **既定 0** |
| processingSec | REAL | |
| processedById | TEXT | → StaffUser（NOT NULL） |
| memberId | TEXT | → Member・NULL可（紐付け後に設定） |
| createdAt | DATETIME | |

> 読取上限の判定には**本テーブルの件数を使用しない。** 月次上限は独立した [UsageCounter](#usagecounter--ai呼び出しの月次カウンタ) で管理する（NF-2-19）。F-9 のリセットで申請を削除しても枠は戻らない（NF-2-40）。

## CheckRun — 業務チェック実行結果

> 要求ドキュメントでは `triage` 等を `Application` に直接保持し再実施時に上書きする設計だったが、**AIの判定履歴が失われ監査できない**ため、実行ごとの履歴として分離する（[判断記録 #6](../requirements/decisions.md#要求ドキュメントからの変更点)）。

| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | PK |
| tenantId | TEXT | → Tenant（NOT NULL） |
| applicationId | TEXT | → Application |
| triage | TEXT | `承認候補` \| `要審査` \| `差戻し候補` |
| triageReason | TEXT | |
| consistencyJson | TEXT | 整合性検証結果 |
| deficienciesJson | TEXT | 不備検出結果 |
| letterDraft | TEXT | 差戻し文面の下書き |
| executedById | TEXT | → StaffUser |
| executedAt | DATETIME | |

> 1申請あたりの件数が `MAX_CHECK_RUNS_PER_APPLICATION`（MVP では 5）の判定値になる（NF-2-21）。

## MatchCandidate — 名寄せ候補と判断結果

| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | PK |
| tenantId | TEXT | → Tenant（NOT NULL） |
| applicationId | TEXT | → Application |
| memberId | TEXT | → Member |
| ruleScore | REAL | 第1段スコア |
| aiLikelihood | TEXT | `高` \| `中` \| `低`・NULL可 |
| aiReason | TEXT | NULL可 |
| status | TEXT | `pending` \| `merged` \| `rejected` \| `hold`（既定 `pending`） |
| decidedById | TEXT | → StaffUser・NULL可 |
| decidedAt | DATETIME | NULL可 |

**UNIQUE(applicationId, memberId)** — 業務チェック再実施時に同一組み合わせが重複登録されるのを防ぐ。再実施時は既存レコードの `ruleScore` / `aiLikelihood` を更新し、`status` が `rejected` のものは候補として再提示しない（F-6-10）。

> ここは `tenantId` を**制約に含めない**。`applicationId` は `Application` の PK であり全テナントで一意のため、先頭に付けても制約が緩むだけで意味がない。`tenantId` 列自体は他テーブルと同様に保持し、クエリ条件の対象にもなる（テナント分離を例外なく一律に適用するため）。

## AppStatusHistory — 申請ステータス変更履歴

| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | PK |
| tenantId | TEXT | → Tenant（NOT NULL） |
| applicationId | TEXT | → Application |
| fromStatus | TEXT | |
| toStatus | TEXT | |
| changedById | TEXT | **→ StaffUser（リレーションとして定義）** |
| note | TEXT | NULL可 |
| createdAt | DATETIME | |

## StatusHistory — 会員状態遷移履歴

| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | PK |
| tenantId | TEXT | → Tenant（NOT NULL） |
| memberId | TEXT | → Member |
| fromStatus | TEXT | |
| toStatus | TEXT | |
| changedById | TEXT | → StaffUser |
| reason | TEXT | NULL可 |
| createdAt | DATETIME | |

> F-9 のリセットでは**シード会員の分も含めて全削除する**（F-9-4）。

## Session — セッション

| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | PK（Cookieに格納する値） |
| tenantId | TEXT | → Tenant（NOT NULL）。**MVP では読み取らない**（テナントは `TENANT_ID` から解決・NF-5-1）。マルチテナント化時にこの列が供給源となる |
| staffUserId | TEXT | → StaffUser |
| expiresAt | DATETIME | |
| createdAt | DATETIME | |

> F-9 のリセットでは削除しない。**実行者はログインしたまま作業を継続できる**（F-9-5）。

## UsageCounter — AI呼び出しの月次カウンタ

月間の読取枚数とGemini呼び出し回数を保持し、課金の歯止め（NF-2-18・NF-2-34）の判定値とする。

| カラム | 型 | 備考 |
|---|---|---|
| period | TEXT | **PK。** 期間キー `YYYY-MM`（**JST**）。例: `2026-08` |
| ocrPages | INTEGER | 当月の読取枚数（Pass①の実行回数＝Document AIのページ数）。**既定 0** |
| geminiCalls | INTEGER | 当月のGemini呼び出し回数（Pass①・Pass②の合算）。**既定 0** |
| updatedAt | DATETIME | |

### 他テーブルと異なる3点

| | 扱い | 根拠 |
|---|---|---|
| `tenantId` | **持たない。** テナント横断のグローバルなカウンタとする | Document AIの無料枠がGoogle Cloudプロジェクト単位であり、テナント別に分割すると総量を抑えられない（NF-2-41） |
| F-9 のリセット | **削除・初期化しない** | 初期化できると上限を回避できてしまう（NF-2-40） |
| 月次リセット | **明示的なリセット処理を持たない。** 保存されている `period` が現在の期間キーと一致しない場合に 0 として扱い、現在の期間キーで上書きする | 日付を判定するリセット処理は、月初にアクセスが無い場合に取りこぼす（NF-2-19） |

> **`tenantId` を持たない唯一のテーブルである。** [全クエリに `tenantId` 条件を付与する](../requirements/tenant-isolation.md#方針)という規約の対象外となるため、業務データを保持させないこと。保持するのは集計値のみで、申請・会員・画像への参照を持たせない。

> 加算は**単一の条件付き UPDATE**（`WHERE period = ? AND ocrPages < ?`）で行い、影響行数 0 を上限到達として扱う。加算はAI呼び出しの**前**に実施する（NF-2-39）。

## 将来拡張

`FacilityReservation` / `BookLending` 等は `Member` に外部キーを追加するだけで実装可能な構造としている（今回は作成しない）。**追加する際は `tenantId` を必ず持たせること。**

## 関連ページ

- [テナント分離](../requirements/tenant-isolation.md) — テナント対応方針・複合制約の根拠・4層防御
- [機能要件](../requirements/functional.md)
- [機能要件 F-9 デモデータのリセット](../requirements/functional.md#f-9-デモデータのリセットadmin-のみ) — 削除対象と実行順序
- [システム構成](../architecture/cloudflare-stack.md)
- [判断記録](../requirements/decisions.md)
