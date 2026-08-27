# ai-ocr-sample1

AI-OCR 帳票読取・一次審査システムの営業デモです。

## ディレクトリ構成と公開範囲

| パス | 用途 | Cloudflare Workers からの公開 |
|---|---|---|
| `src/` | Worker とアプリケーションコード | コードとしてデプロイ |
| `public/` | 公開してよい静的アセットのみ | 公開対象にできる |
| `knowledge/` | 要件・設計資料 | 公開しない |
| `docs/` | 開発向けドキュメント | 公開しない |
| `input/`, `output/`, `inbox/` | 入出力資料・生成物など | Git 管理・公開の対象外 |

Wrangler の `assets.directory` には `public/` または専用のビルド成果物ディレクトリのみを指定します。リポジトリ直下、`knowledge/`、`docs/` を指定してはいけません。

## セットアップと開発

Node.js 24 と Corepack を使用します。依存関係をインストールした後、次のコマンドで確認できます。

```sh
corepack pnpm install
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

単一のテストファイルは `corepack pnpm test -- src/worker/index.test.ts` で実行します。ローカル開発サーバーは `corepack pnpm dev`、Cloudflare上でCPU時間を確認するリモート開発は `corepack pnpm dev:remote` を使用します。

`.env.example` を参照して、ローカル開発用の `.dev.vars` を作成してください。実際のAPIキー、Basic認証情報、Googleサービスアカウント秘密鍵、顧客データはコミットしてはいけません。
