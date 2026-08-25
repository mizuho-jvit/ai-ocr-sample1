# ai-ocr-sample1 Wiki

<!-- 予約ファイル。フロントマターは付けない（SCHEMA.md §3.3）。 -->

AI-OCR 帳票読取・一次審査システム（営業デモ用）の知識ベース。**本 Wiki が正典である。** `input/` `output/` の資料は Wiki に整理され次第使い捨て、保持が必要な原本は `knowledge/ref/doc/` にコピーする（[OKF.md](../OKF.md) §1.1）。

現在のステータス: **要件定義が確定（v1.10・未確定事項なし）、実装は未着手。MVP 1.0はGemini単体、MVP 1.1はDocument AI＋Gemini。**

## 要件・仕様 — `requirements/`

| ページ | 内容 |
|---|---|
| [プロジェクト概要とスコープ](./requirements/overview.md) | 目的、プロダクトポジショニング、デザイン要件、対象／対象外、ロールと権限、制約事項 |
| [機能要件](./requirements/functional.md) | F-1 認証／F-2 帳票読取／F-3 AI業務チェック／F-4 申請管理／F-5 会員管理／F-6 名寄せ／F-7 スタッフ管理／F-8 CSV入出力／F-9 デモデータリセット |
| [非機能要件](./requirements/non-functional.md) | 性能、パスワード管理、AI呼び出し回数の上限、データ保持、保守性、**環境変数一覧** |
| [テナント分離](./requirements/tenant-isolation.md) | マルチテナント方針と4層防御。`TENANT_ID` 固定の根拠 |
| [運用要件](./requirements/operations.md) | 単一デモ環境の共用、シード投入、開発・検証 |
| [受け入れ基準](./requirements/acceptance.md) | 領域別チェックリスト |
| [判断記録](./requirements/decisions.md) | 要求からの変更点12件、確定事項15件、**撤回した判断** |
| [本番化ギャップ](./requirements/production-gap.md) | 本番構成を決める前に答えが必要な問い（Q-1〜Q-8）、**デモ限定の割り切り13件と本番での代替方針**、既に手当て済みの箇所、未記載の要件ギャップ |

## アーキテクチャ — `architecture/`

| ページ | 内容 |
|---|---|
| [システム構成](./architecture/cloudflare-stack.md) | Vite+React / Hono on Workers / D1+Drizzle / R2、無料枠の制約 |
| [外部OCR・AI API](./architecture/ai-api.md) | MVP 1.0のGemini単体構成、MVP 1.1のDocument AI＋Gemini構成、コスト、認証、OCR Pipeline設計 |

## データモデル — `db/`

| ページ | 内容 |
|---|---|
| [データモデル](./db/data-model.md) | 9テーブルの定義と複合制約 |

## 画面 — `screens/`

| ページ | 内容 |
|---|---|
| [画面一覧](./screens/screen-list.md) | 11画面のロールと主な要件 |

## 実装領域（Wiki の外） — `../../docs/dev/`

| ページ | 内容 |
|---|---|
| [実装コンテキスト](../../docs/dev/context.md) | 技術スタック・テスト・ディレクトリ構成・ビルドコマンド。tsumiki の `dev-*` スキルが参照する |
| `../../docs/dev/plans/` | 実装計画とタスク（`dev-plan` が生成。未作成） |

**ここは本 Wiki の派生物であり正典ではない。** 要件・アーキテクチャ・データモデル・画面の正典は本 Wiki 側であり、`docs/dev/` は実装が進むたびに書き換わる作業領域（タスクの `status`、検証レポート）である。要件が変わったときに直すのは Wiki 側で、`docs/dev/` を先に書き換えてはならない。`docs/dev/` 配下は OKF のフロントマター規約（[SCHEMA.md](../SCHEMA.md) §3.2）の適用外。

## 未着手のディレクトリ

`concepts/` `entities/` `synthesis/` `graph/` `_assets/` はページ 0 件。要件定義からの正典化では起点となる資料がないため、資料が `input/` に入り次第起こす。

## 規約

- [SCHEMA.md](../SCHEMA.md) — Wiki の構造・編集規約（憲法）
- [OKF.md](../OKF.md) — 本プロジェクトでの OKF の取り入れ方、`input/` と `ref/` の役割分担
- [log.md](./log.md) — 変更履歴
