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
