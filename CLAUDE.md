# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

`ai-ocr-sample1` は `jv-it` ワークスペース配下の子プロジェクト。AI-OCR 帳票読取・一次審査システム(営業デモ用)。

**要件定義は v1.10 で確定済み(未確定事項なし)。技術スタックも確定済み。実装は未着手**(ソースコード・package.json はまだ存在しない)。

## 正典と派生物

- **要件・アーキテクチャ・データモデル・画面の正典は `knowledge/wiki/`。** 起点は [`knowledge/wiki/index.md`](knowledge/wiki/index.md)
- `docs/dev/` は wiki から派生した**実装用の作業領域**。要件を再掲せず、wiki へリンクで参照する
- 要件が変わったときに直すのは **wiki 側**。`docs/dev/` を先に書き換えない
- **長寿命の設計情報が `docs/dev/` に生成されたら wiki へ正典化する。** 具体的には画面仕様書: `dev-screen-spec` は `docs/dev/screen-specs/` に出力するが、画面仕様の正典は `SCHEMA.md` §2 の定めどおり `knowledge/wiki/screens/`。生成後に wiki へ移し、`docs/dev/` 側は使い捨てる
- `docs/dev/` 配下は OKF のフロントマター規約(`SCHEMA.md` §3.2)の適用外。tsumiki のタスクファイルは `type` を持たず `status` が書き換わるため、wiki の規約とは寿命が違う

Wiki の構造・編集規約は `knowledge/SCHEMA.md`(憲法)と `knowledge/OKF.md` に従う。

## ディレクトリ

| パス | 役割 | Git |
|---|---|---|
| `knowledge/wiki/` | 要件・設計の正典(OKF 準拠 Markdown) | 追跡 |
| `knowledge/ref/doc/` | 要件定義書などの原本。一度入れたら変更しない | **除外** |
| `docs/dev/` | 実装コンテキスト・計画(`context.md`、tsumiki の `plans/`) | 追跡 |
| `src/` | Cloudflare Workers のアプリケーションコード | 追跡 |
| `public/` | 公開してよい静的アセットのみ | 追跡 |
| `input/` | 入力データ・資料の投入口。Wiki 化したら使い捨て | **除外** |
| `output/` | 生成物の置き場 | **除外** |
| `inbox/` | 未整理の受領物 | **除外** |

除外対象には個人情報を含む資料が入る。**コミットしないこと。**

### Cloudflare Workers の公開境界

- `knowledge/` と `docs/` は設計・開発文書用であり、Worker の公開アセットに含めない。
- `wrangler.toml` の `assets.directory` は `public/` または専用のビルド成果物ディレクトリ(`dist/` など)に限定する。リポジトリ直下、`knowledge/`、`docs/` は指定しない。
- Worker コードから `knowledge/` や `docs/` のファイルをインポートまたは配信しない。公開が必要な場合は、明示的な承認を得て `public/` へ配置する。

## 技術スタック

確定済み。選定理由と却下した代替案は [`knowledge/wiki/architecture/cloudflare-stack.md`](knowledge/wiki/architecture/cloudflare-stack.md) と [`requirements/decisions.md`](knowledge/wiki/requirements/decisions.md) を読む。

- フロントエンド: Vite + React(SPA) / バックエンド: Hono on Cloudflare Workers
- DB: Cloudflare D1 + Drizzle ORM / ストレージ: R2 / AI: Cloudflare AI Gateway → Gemini
- 構成: **一体型(単一 package.json)**。pnpm / Biome / Vitest。Docker は使わない

実装前に必ず [`docs/dev/context.md`](docs/dev/context.md) を読む。

### 違反すると事故る制約(詳細は context.md と wiki)

- Workers の CPU 時間は 10ms/リクエスト。`wrangler dev` では制限が適用されないため、実測は `--remote` か本番デプロイ後に行う
- `wrangler.toml` に `assets.run_worker_first = true` を設定する。設定しないと Static Assets が Basic 認証を迂回する
- セッションは HTTPOnly / Secure / SameSite=Lax の Cookie + D1。**JWT を localStorage に保存しない**
- ロール認可は API レベルで必ず検証する。画面側の制御だけでは不可

## ビルド・テスト

package.json はまだ存在しない。**予定しているコマンドは [`docs/dev/context.md`](docs/dev/context.md) の Build & Run に記載**(すべて 🔴 = 未確定)。実際に作成したら lockfile をコミットし、確定したコマンド(単一テストの実行方法を含む)をこのファイルと `README.md` に追記すること。

現時点でのコミット前チェック:

```sh
git status --short   # 意図しない/未追跡ファイルの検出
git diff --check     # 空白エラーの検出
```

コーディングスタイル・コミット/PR の規約は `AGENTS.md` を参照。
