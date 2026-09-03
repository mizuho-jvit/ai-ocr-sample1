---
type: db-domain
title: データモデル（D1 テーブル定義）
description: Tenant / StaffUser / Member / Application / CheckRun / UsageCounter / MatchCandidate / AppStatusHistory / StatusHistory / Session の10テーブル、複合制約、監査列（createdAt / updatedAt / createdById / updatedById）の方針
tags: [ai-ocr, database, d1, drizzle, schema, multi-tenancy, audit]
timestamp: 2026-08-27T00:00:00Z
---

# データモデル（D1 テーブル定義）

> 正典化元: 要件定義書 v1.11 §9・§9.2（原本は `knowledge/ref/doc/claude_code_要件定義_v1.11.md`）
> テナント対応方針（旧 §9.1）は [テナント分離](../requirements/tenant-isolation.md) に分離した。
> [列名の規約](#列名の規約)と[監査列](#監査列)は **v1.11 §9.2**（2026-08-26 新設）に対応する。

ログインする職員（`StaffUser`）と、ログインしない会員（`Member`）は**別テーブルに分離する**（会員に認証情報を持たせないため）。

**全テーブルが `tenantId` を NOT NULL で持ち、全クエリにテナント条件を付与する。** 強制手段は [テナント分離](../requirements/tenant-isolation.md)。

## 状態値の永続化

状態・判定の値は、画面文言ではなく**安定した英字コードを TEXT として永続化する**。画面と CSV は [共有型定義](../architecture/types.md#1-列挙型) の表示ラベルへ変換する。これにより、利用者向けの日本語ラベルを変更しても既存データ・履歴を更新する必要がない。

| 区分 | 永続値 | 表示ラベル |
|---|---|---|
| 申請状態 `AppStatus` | `received` / `under_review` / `approved` / `returned` | 受付 / 審査中 / 承認 / 差戻し |
| 会員状態 `MemberStatus` | `pending` / `active` / `suspended` / `inactive` | 申請中 / 利用資格あり / 停止中 / 退会 |
| AIトリアージ `Triage` | `approval_candidate` / `needs_review` / `return_candidate` | 承認候補 / 要審査 / 差戻し候補 |
| AI可能性 `Likelihood` | `high` / `medium` / `low` | 高 / 中 / 低 |
| 名寄せ判断 `MatchStatus` | `pending` / `merged` / `rejected` / `hold` / `stale` | 未判断 / 同一人物 / 別人 / 保留 / （非表示・内部状態） |

各列は Drizzle の型だけに任せず、対応する値集合の `CHECK` 制約を持つ。履歴テーブルの `fromStatus` / `toStatus` も、対象テーブルと同じ値集合に制限する。状態遷移の可否はサービス層で検証し、状態更新と履歴の追加を同一トランザクションで実行する。

## 列名の規約

**同一の役割には同一の列名を使う。** 同じ意味の列がテーブルごとに別名になっていると、読む側は毎回テーブル定義に戻ることになり、実装側は「この行の作成者はどの列か」をテーブルごとに判断することになる。[判断記録 #11](../requirements/decisions.md#要求ドキュメントからの変更点) で `orgId` を `tenantId` へ統一した理由（**同一概念を2つの名前で呼ばない**）を、列名にも適用する。

> **v1.10 までの列名から改名している。** 要件定義書には **v1.11 §9.2** として反映済み（判断記録 [#16](../requirements/decisions.md#確定事項)）。

### 共通語彙

| 役割 | 列名 |
|---|---|
| 行が作られた時刻 | `createdAt` |
| 行が最後に更新された時刻 | `updatedAt` |
| 行を作った職員 | `createdById` |
| 行を最後に更新した職員 | `updatedById` |

**その行にとって何が起きたかを列名に持たせない。** 読取なのか、AI実行なのか、ステータス変更なのかは**テーブルが表している**（`Application` / `CheckRun` / `AppStatusHistory`）。列名で重ねて言わない。

### 改名（原本 §9 からの差分）

| テーブル | 原本 §9 | 本ページ | 同義である理由 |
|---|---|---|---|
| Application | `processedById` | `createdById` | 読取を実行した職員 = 行を作った職員。**申請は読取以外の経路で作られない** |
| Application | `lastEditedById` | `updatedById` | 「最終編集者」は最終更新者そのもの |
| CheckRun | `executedAt` | `createdAt` | 追記専用であり、実行時刻と行の作成時刻が常に一致する |
| CheckRun | `executedById` | `createdById` | 実行者 = 行を作った職員 |
| AppStatusHistory | `changedById` | `createdById` | 追記専用であり、変更者 = 行を作った職員 |
| StatusHistory | `changedById` | `createdById` | 同上 |
| Member | `registeredAt` | `createdAt` | **登録日は行が作られた時刻そのもの。** `CreateMemberRequest` は登録日を受け取らず（サーバーが設定する）、CSVインポートの列定義も存在しないため、作成時刻と異なる値が入る経路が無い |

DTO 側（[types.md](../architecture/types.md)）の `processedBy` / `lastEditedBy` / `changedBy` / `executedAt` / `registeredAt` も同じ規約で揃える。**画面に出す日本語ラベル（「処理者」「変更者」「登録日」）は変更しない** — 列名は実装の語彙、ラベルは利用者の語彙であり、揃える対象ではない。

| 画面のラベル | 列 |
|---|---|
| 処理者 | `Application.createdById` |
| 変更者 | `AppStatusHistory.createdById` / `StatusHistory.createdById` |
| **登録日** | **`Member.createdAt`** |

> **F-5-2 の保持項目「登録日」は失われていない。** 保持先が `registeredAt` から `createdAt` に変わっただけである。

### 改名しない列

役割が上の4つと**異なる**ため、固有名のまま残す。

| 列 | なぜ別概念か |
|---|---|
| `MatchCandidate.decidedById` / `decidedAt` | **作成でも一般の更新でもない第3の事象**（職員が候補の採否を判断した時点）。[下記](#決定者を最終更新者と同一視しない理由)のとおり最終更新者と食い違う |
| `Session.expiresAt` / `staffUserId` | 有効期限とセッションの所有者。時刻・主体ではあるが役割が違う |
| `StaffUser.lockedUntil` | F-1-6 のロック解除時刻 |
| `UsageCounter.period` | 期間キー（`YYYY-MM`）であり時刻ではない |

#### 決定者を最終更新者と同一視しない理由

`MatchCandidate` の行には**書き込み経路が2つ**あり、順番が入れ替わる。

1. **職員の採否判断**（F-6-8「同一人物として紐付け／別人として登録／**保留**」）→ `status` / `decidedById` / `decidedAt`
2. **業務チェックの再実施**（F-4-6）→ 既存行の `ruleScore` / `aiLikelihood`（[UNIQUE制約の項](#matchcandidate--名寄せ候補と判断結果)）

職員Xが「保留」と判断した後に職員Yが再実施すると、**最終更新者はY、判断者はX**になる。**「保留」は再実施して再判断するための状態**（F-6-8）であり、この順番は想定された動線である。`decidedById` を `updatedById` に統合すると、再実施のたびに採否の判断者が上書きされて消える。

さらに2点。**F-6-9 が「判断結果・判断者・日時を保存する」と明示している**（監査の付帯情報ではなく要件が名指しする業務データ）。また `decidedById` の `NULL` は `status = pending`（未判断）と一対一で対応しており、`updatedById` の `NULL`（一度も更新されていない）とは意味が両立しない。

> 再実施を行った職員は `CheckRun.createdById` に残る（F-4-8 が再実施ごとに1行作る）。ただし `MatchCandidate` から `CheckRun` への参照は持たないため、**`MatchCandidate` 単体では「最後に誰が再算出したか」を引けない。** 引く必要が生じた時点で参照列を足す。

## 監査列

`createdAt` / `updatedAt` / `createdById` / `updatedById` の扱いを定める。**原本 §9 には対応する記述が無い追加分である。**

デモ環境は**単一環境を全商談で共用し**（OP-1）、**F-9 のリセットでも `StaffUser` と `Tenant` は削除しない**（F-9-5）。この2つは商談を跨いで人手で管理し続ける唯一のデータでありながら、**誰がいつ変更したかを記録する手段が現状どこにも無い**（`AppStatusHistory` と `StatusHistory` は申請と会員の**状態**しか記録しない）。

列は一律には付けない。**その行が更新されるか**と、**更新の主体が人か**で判断する。

| テーブル | createdAt | updatedAt | createdById | updatedById |
|---|---|---|---|---|
| [Tenant](#tenant--テナント顧客組織) | 既存 | **追加** | — 主体が `StaffUser` でない | — 同左 |
| [StaffUser](#staffuser--職員admin--staff) | 既存 | **追加** | **追加** | **追加** |
| [Member](#member--会員ログインなし) | 既存（`registeredAt` から改名） | **追加** | **追加** | **追加** |
| [Application](#application--申請台帳レコード) | 既存 | **追加** | 既存（`processedById` から改名） | 既存（`lastEditedById` から改名） |
| [CheckRun](#checkrun--業務チェック実行結果) | 既存（`executedAt` から改名） | — 追記専用 | 既存（`executedById` から改名） | — 追記専用 |
| [UsageCounter](#usagecounter--ai呼び出しの月次カウンタ) | — | 既存 | — 主体が存在しない | — 同左 |
| [MatchCandidate](#matchcandidate--名寄せ候補と判断結果) | **追加** | **追加** | — 生成はシステム | — 更新もシステム。判断は `decidedById`（[別概念](#改名しない列)） |
| [AppStatusHistory](#appstatushistory--申請ステータス変更履歴) | 既存 | — 追記専用 | 既存（`changedById` から改名） | — 追記専用 |
| [StatusHistory](#statushistory--会員状態遷移履歴) | 既存 | — 追記専用 | 既存（`changedById` から改名） | — 追記専用 |
| [Session](#session--セッション) | 既存 | — 更新しない | — 主体は `staffUserId` 自身 | — 更新しない |

### 追加する根拠

- **`StaffUser`（最も必要性が高い）** — F-7-1 で admin がアカウントを登録・編集・無効化する。**`role` の `staff → admin` 昇格と `isActive` による無効化は権限そのものの変更**だが、これを残す履歴テーブルが無い。F-9 で削除されないため、記録は商談を跨いで蓄積する。
- **`Member`** — F-5-1 の編集と F-8-5 の CSV インポート（500件／回・F-8-6）で人手が入る。`status` の変更は `StatusHistory` に残るが、**住所・電話・氏名の修正はどこにも残らない。** 表記ゆれ対応で氏名を直す動線（F-5-5・F-6）があるため、修正の痕跡が消えるのは実害になる。
- **`Member` の作成時刻は既存の `registeredAt`（→ `createdAt` へ改名）で足りる。** 登録日を作成時刻と別に指定する経路が要件に無いため、列を2つ持たない（[改名](#改名原本-9-からの差分)）。
- **`MatchCandidate`** — 業務チェックの再実施で既存行の `ruleScore` / `aiLikelihood` を**更新する**設計（[UNIQUE制約の項](#matchcandidate--名寄せ候補と判断結果)）でありながら、生成時刻も更新時刻も持っていない。表示中の候補がいつ算出された値なのかを判別できない。
- **`Tenant.updatedAt`** — `code` と `name` は改称され得る（[`id` と `code` を分ける理由](#id-と-code-を分ける理由)）。1件しか無い行だが、改称の反映有無を確認する手段が無い。
- **`updatedAt` の運用上の効き方** — 共用環境では、画面に出ているデータが前の商談の残りか当日投入したものかを判別する材料になる（OP-8 のリセット漏れの調査）。

### 付けない根拠

- **追記専用のテーブルに `updatedAt` / `updatedById` を付けない**（`CheckRun` `AppStatusHistory` `StatusHistory`）。付けると「更新してよい行である」という誤ったシグナルになる。`CheckRun` を実行ごとの履歴に分離したのは判定履歴を失わないためであり（[判断記録 #6](../requirements/decisions.md#要求ドキュメントからの変更点)）、行を書き換える運用は存在しない。
- **同義の列を名前違いで増やさない。** `Application` の作成者・最終更新者は既存の列がそのまま該当するため、[改名](#改名原本-9-からの差分)して同じ名前に寄せた。別名のまま新しい列を足すと二重管理になり、どちらが正かを実装のたびに判断させることになる。
- **`UsageCounter` に主体は存在しない。** 加算するのはAI呼び出しの経路であって職員ではない。**業務データを保持させない**という同テーブルの規約にも反する。
- **`Tenant` に actor 列を付けない。** 改称を行うのは JV-IT の運用者であり `StaffUser` として存在しない。FK を張れない値だけが入る列になる。

### 実装上の約束

| | 規約 |
|---|---|
| 命名 | [列名の規約](#列名の規約)に従う。主体の列は **`...ById`**（`createdBy` としない） |
| NULL可否 | `createdAt` / `updatedAt` は **NOT NULL**。`createdById` / `updatedById` は既定 **NULL可**（→ StaffUser）だが、**アプリ外で行が作られ得ないテーブルは NOT NULL に強める**（`Application` `CheckRun` `AppStatusHistory` `StatusHistory` — シード投入の対象が職員2件・会員5件のみのため） |
| **`NULL` の意味** | **アプリケーションを経由しない操作**（シード投入 OP-7・OP-10、`wrangler d1 execute` による直接SQL）。記録漏れではなく「画面から行われていない」ことを表す。**この意味以外で NULL にしない** |
| 更新時の設定 | SQLite / D1 に `ON UPDATE` は無い。**`updatedAt` はアプリケーションが必ず設定する**（Drizzle の `$onUpdate`）。DB に任せない |
| 列の並び順 | 監査列は**テーブルの末尾**に `createdAt` → `updatedAt` → `createdById` → `updatedById` の順で置く。業務上の列と混ぜない |
| 作成時の `updatedAt` | 作成時点で `createdAt` と同値を入れる。NULL にしない（`COALESCE` が要る比較を各所に生まないため） |
| 応答への露出 | 監査列を自動的に DTO へ含めない。画面に出す必要が生じた時点で [types.md](../architecture/types.md) と [screen-list.md](../screens/screen-list.md) を更新する。**列を足すだけでは監査にならない** |
| テナント分離 | `createdById` / `updatedById` が指す `StaffUser` は**同一テナントに限る**。結合時も `tenantId` 条件を外さない |

> **今入れる理由**: 実装が未着手のため、マイグレーションも既存行のバックフィルも発生しない。後から足すと既存行が一律 `NULL` になり、上表で定めた **`NULL` の意味（アプリ外の操作）と「記録が無い」が区別できなくなる。**

> **本ページは更新の記録のみを扱う。閲覧の記録（誰がどの個人情報を見たか）は依然として存在しない。** これは MVP の欠落ではなく本番化時の論点として [production-gap.md](../requirements/production-gap.md) に整理してある。

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
| updatedAt | DATETIME | [監査列](#監査列)。`code` / `name` の改称が入り得る |

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
| updatedAt | DATETIME | [監査列](#監査列) |
| createdById | TEXT | → StaffUser・NULL可（[監査列](#監査列)）。F-7-1 の登録者 |
| updatedById | TEXT | → StaffUser・NULL可。**`role` の昇格・`isActive` の無効化を行った者**（F-7-1） |

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
| birthDate | DATE | NULL可。`YYYY-MM-DD`固定。CHECK制約で形式を強制する |
| postalCode | TEXT | NULL可 |
| address | TEXT | NULL可 |
| phone | TEXT | ハイフン除去して保存。CHECK制約で数字のみ・空文字禁止を強制する |
| email | TEXT | NULL可 |
| status | TEXT | `pending` \| `active` \| `suspended` \| `inactive` |
| isSeed | BOOLEAN | 既定 false。シード投入された会員のみ true（F-9-2） |
| createdAt | DATETIME | 画面の**「登録日」**（F-5-2・旧 `registeredAt`）。[列名の規約](#列名の規約) |
| updatedAt | DATETIME | [監査列](#監査列) |
| createdById | TEXT | → StaffUser・NULL可（[監査列](#監査列)）。F-5-1 の登録者・F-8-5 のインポート実行者 |
| updatedById | TEXT | → StaffUser・NULL可。**状態以外の項目（住所・電話・氏名）の修正者**（F-5-1） |

**UNIQUE(tenantId, memberNumber)** — 会員番号はテナントごとに 1 から採番するため、単独の `UNIQUE(memberNumber)` では将来のテナント統合時に**全件が衝突する**。本テーブルが `tenantId` 対応を最優先すべき箇所である。

**INDEX** — 名寄せ・検索に使用する以下3本は、いずれも `tenantId` を先頭列とする複合インデックスとする。インデックスの先頭列は後から変更できないため当初から複合とする。

| インデックス | 用途 |
|---|---|
| `(tenantId, nameNormalized)` | 氏名の正規化照合（F-6） |
| `(tenantId, kanaNormalized)` | カナの正規化照合（F-6） |
| `(tenantId, phone)` | 電話番号一致（F-6） |

**CHECK** — `matching.ts`のスコアリングは`phone`/`birthDate`を`normalizeMemberInput`が出力した形式のまま生の値で比較する。この形式を書き込み経路（Task 011の登録・編集、Task 013のCSVインポート等）を問わずDB側でも強制するため、`phone != '' AND phone NOT GLOB '*[^0-9]*'`（数字のみ・空文字禁止）と`birthDate IS NULL OR birthDate GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`（`YYYY-MM-DD`固定・ゼロ埋め必須）を追加した。`nameNormalized`/`kanaNormalized`は自由なかな漢字のため形式チェックは書けず、`normalizeMemberInput`を経由する運用に引き続き依存する。

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
| appStatus | TEXT | `received` \| `under_review` \| `approved` \| `returned`（既定 `received`）。表示ラベルは[状態値の永続化](#状態値の永続化) |
| latestCheckRunId | TEXT | 最新の業務チェック結果への参照・NULL可 |
| checkRunCount | INTEGER | **既定 0。** 業務チェック（Pass②）の実施回数を数える予約カウンタ。`CheckRun`行の実数ではなくこの列がNF-2-21の判定値になる（詳細は[CheckRun](#checkrun--業務チェック実行結果)） |
| editedCount | INTEGER | **既定 0** |
| processingSec | REAL | |
| memberId | TEXT | → Member・NULL可（紐付け後に設定） |
| createdAt | DATETIME | |
| updatedAt | DATETIME | 項目編集・ステータス変更・`latestCheckRunId` の更新で設定する |
| createdById | TEXT | → StaffUser（**NOT NULL**）。読取を実行した職員（旧 `processedById`） |
| updatedById | TEXT | → StaffUser・NULL可。最終更新者（旧 `lastEditedById`） |

> 読取上限の判定には**本テーブルの件数を使用しない。** 月次上限は独立した [UsageCounter](#usagecounter--ai呼び出しの月次カウンタ) で管理する（NF-2-19）。F-9 のリセットで申請を削除しても枠は戻らない（NF-2-40）。

## CheckRun — 業務チェック実行結果

> 要求ドキュメントでは `triage` 等を `Application` に直接保持し再実施時に上書きする設計だったが、**AIの判定履歴が失われ監査できない**ため、実行ごとの履歴として分離する（[判断記録 #6](../requirements/decisions.md#要求ドキュメントからの変更点)）。

| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | PK |
| tenantId | TEXT | → Tenant（NOT NULL） |
| applicationId | TEXT | → Application |
| triage | TEXT | `approval_candidate` \| `needs_review` \| `return_candidate`。表示ラベルは[状態値の永続化](#状態値の永続化) |
| triageReason | TEXT | |
| consistencyJson | TEXT | 整合性検証結果 |
| deficienciesJson | TEXT | 不備検出結果 |
| letterDraft | TEXT | 差戻し文面の下書き・NULL可（不備または矛盾がある場合のみ生成） |
| createdAt | DATETIME | 実行時刻（旧 `executedAt`）。追記専用のため両者は常に一致する |
| createdById | TEXT | → StaffUser（**NOT NULL**）。実行した職員（旧 `executedById`） |

> 1申請あたりの件数が `MAX_CHECK_RUNS_PER_APPLICATION`（MVP では 5）の判定値になる（NF-2-21）。

> **追記専用。行を書き換えない**ため `updatedAt` / `updatedById` を持たない（[監査列](#監査列)）。再実施は新しい行として記録する（F-4-8）。

> **上限判定は本テーブルの件数を数えてから行わない。** `Application.checkRunCount` への**単一の条件付きUPDATE**（`WHERE id = ? AND checkRunCount < ?`）で、AI呼び出しの**前**に予約する（UsageCounterのNF-2-39と同じ規律）。読み取ってから判定する実装では、上限直前の並行リクエストが両方とも判定を通過してしまう。この予約はCheckRun行の作成より前に確定するため、予約後にAI呼び出しが失敗した場合（`USAGE_LIMIT_EXCEEDED`・`AI_UNAVAILABLE`等）は`checkRunCount`だけが加算されCheckRun行が作られない状態になりうる（fail closed側に倒す設計。NF-2-39がUsageCounterに持つのと同じ既知の限界）。

## MatchCandidate — 名寄せ候補と判断結果

| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | PK |
| tenantId | TEXT | → Tenant（NOT NULL） |
| applicationId | TEXT | → Application |
| memberId | TEXT | → Member |
| ruleScore | REAL | 第1段スコア |
| aiLikelihood | TEXT | `high` \| `medium` \| `low`・NULL可。表示ラベルは[状態値の永続化](#状態値の永続化)。**値はAIではなくルールベースのロジックが算出する**（[決定#27](../requirements/decisions.md)）。列名は歴史的名称として維持する |
| aiReason | TEXT | NULL可。同上、値はルールベースのロジックが生成する |
| status | TEXT | `pending` \| `merged` \| `rejected` \| `hold` \| `stale`（既定 `pending`） |
| decidedById | TEXT | → StaffUser・NULL可 |
| decidedAt | DATETIME | NULL可 |
| createdAt | DATETIME | 候補が最初に算出された時刻 |
| updatedAt | DATETIME | **再実施による `ruleScore` / `aiLikelihood` / `status` の更新時刻**（[監査列](#監査列)） |

**UNIQUE(applicationId, memberId)** — 業務チェック再実施時に同一組み合わせが重複登録されるのを防ぐ。再実施時は既存レコードの `ruleScore` / `aiLikelihood` を更新し、`status` が `rejected` のものは候補として再提示しない（F-6-10）。

> ここは `tenantId` を**制約に含めない**。`applicationId` は `Application` の PK であり全テナントで一意のため、先頭に付けても制約が緩むだけで意味がない。`tenantId` 列自体は他テーブルと同様に保持し、クエリ条件の対象にもなる（テナント分離を例外なく一律に適用するため）。

> **`stale`（コードレビュー指摘#5）** — 業務チェックは何度でも再実施でき（NF-2-21の上限まで）、そのたびに`findMatchCandidates`が現在の申請データで上位5件を再計算する。編集後の再実施で前回の候補が今回の上位5件から外れることがあるが、`pending`/`hold`の行を**削除しない**。`hold`は職員が「保留」を選んだ判断記録（F-6-9・`decidedById`/`decidedAt`）であり、削除すると監査証跡が失われるため。代わりに`status`を`stale`へ更新し、候補カード一覧（`buildMatchCandidateViews`）からは`rejected`と同様に除外する。後の再実施でその会員が再び上位5件に戻った場合は、`stale`のまま固定せず`pending`へ戻す（F-6-8の判断をやり直せるようにする）。`merged`/`rejected`はこの無効化の対象外（`merged`は確定済みの紐付け、`rejected`はF-6-10によりそもそも`findMatchCandidates`のスコアリング対象から除外済み）。

## AppStatusHistory — 申請ステータス変更履歴

| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | PK |
| tenantId | TEXT | → Tenant（NOT NULL） |
| applicationId | TEXT | → Application |
| fromStatus | TEXT | NULL可。初期状態の記録では NULL |
| toStatus | TEXT | NOT NULL |
| note | TEXT | NULL可 |
| createdAt | DATETIME | |
| createdById | TEXT | **→ StaffUser（リレーションとして定義・NOT NULL）**。変更者（旧 `changedById`） |

> **追記専用。**`updatedAt` / `updatedById` を持たない（[監査列](#監査列)）。

## StatusHistory — 会員状態遷移履歴

| カラム | 型 | 備考 |
|---|---|---|
| id | TEXT | PK |
| tenantId | TEXT | → Tenant（NOT NULL） |
| memberId | TEXT | → Member |
| fromStatus | TEXT | NULL可。初期状態の記録では NULL |
| toStatus | TEXT | NOT NULL |
| reason | TEXT | NULL可 |
| createdAt | DATETIME | |
| createdById | TEXT | → StaffUser（**NOT NULL**）。変更者（旧 `changedById`） |

> **追記専用。**`updatedAt` / `updatedById` を持たない（[監査列](#監査列)）。ここに残るのは**状態の遷移だけ**であり、住所・電話・氏名の修正は `Member.updatedById` 側で追う。

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
