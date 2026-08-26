# データモデル

<!-- 予約ファイル。フロントマターは付けない（SCHEMA.md §3.3）。 -->

| ページ | 元の章 | 内容 |
|---|---|---|
| [data-model.md](./data-model.md) | 要件定義書 v1.11 §9・§9.2 | Tenant / StaffUser / Member / Application / CheckRun / UsageCounter / MatchCandidate / AppStatusHistory / StatusHistory / Session の10テーブル、列名の規約、監査列（`createdAt` / `updatedAt` / `createdById` / `updatedById`） |

規模が小さいため当面1ファイルにまとめる（[OKF.md](../../OKF.md) §6）。テーブル数が増えてドメイン別の分割が必要になった時点で分ける。

## 前提

- **全テーブルが `tenantId` を NOT NULL で持つ。** クエリ条件の付与も MVP から実装する。方針と強制手段は [テナント分離](../requirements/tenant-isolation.md)
- ログインする職員（`StaffUser`）とログインしない会員（`Member`）は**別テーブル**
- D1（SQLite互換）+ Drizzle ORM。**`UNIQUE` 制約とインデックスの先頭列は後から変更するとテーブル再作成を要する**ため、複合キーは当初から設定する
