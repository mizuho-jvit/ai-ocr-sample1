---
type: requirement
title: 運用要件（単一デモ環境・開発検証）
description: 単一デモ環境、MVP 1.0／1.1のOCR設定、Document AIの権限・費用監視、シード投入、開発検証
tags: [ai-ocr, operations, deployment, seed, cloudflare, document-ai]
timestamp: 2026-09-18T12:00:00Z
---

# 運用要件（単一デモ環境・開発検証）

> 正典化元: 要件定義書 v1.11 §11（原本は `knowledge/ref/doc/claude_code_要件定義_v1.11.md`）

## 単一デモ環境

**MVP はデモ専用であり、顧客ごとの環境払い出しは行わない。** 単一の実行環境を JV-IT が運用し、**すべての商談で共用する。**

```
（単一環境）  → Worker  → D1: ai-ocr-demo  → R2 prefix: {TENANT_ID}/
                          ↑ Tenant 1件・TENANT_ID 固定（NF-5-1）
```

| ID | 要件 |
|---|---|
| OP-1 | Worker・D1・R2 を各1つ用意する。顧客ごとの分離は行わない |
| OP-2 | 環境構築（D1作成・マイグレーション・シード投入・デプロイ）をスクリプト化し、単一コマンドで実行可能とする |
| OP-3 | `PBKDF2_ITERATIONS` `TENANT_ID` 等の環境変数を `wrangler.toml` で設定する（[環境変数の一覧](./non-functional.md#環境変数の一覧統合)） |
| OP-4 | シード投入時に `Tenant` を**1件だけ**作成し、その `id` を `TENANT_ID` に設定する。`code` にも値を設定する（MVP では使用しないが、後から採番すると既存レコードとの対応付けが必要になるため）。以降の全レコードは `id` を `tenantId` に持つ（NF-5-1） |
| OP-12 | **公開URLは `*.workers.dev` を使用する。独自ドメインは取得しない**（[判断記録 #9](./decisions.md#確定事項)）。製品版への移行時にドメイン構成（単一ドメインまたはサブドメイン）を改めて判断する |
| OP-13 | デプロイ先ごとに `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD` をWorkers Secretとして登録する。ローカル開発ではGit追跡外の `.dev.vars` または `.env` を使用し、両方を併用しない |
| OP-14 | MVP 1.0では `OCR_PIPELINE_MODE=gemini`、MVP 1.1では `OCR_PIPELINE_MODE=document-ai-gemini` をデプロイ時に固定する。MVP 1.1ではEnterprise Document OCR Processorと専用サービスアカウントを作成し、`roles/documentai.apiUser` のみを付与する |
| OP-15 | MVP 1.1ではDocument AIのページ数とGoogle Cloud請求額を月次で確認し、月1,000ページ無料枠の他用途との合算を確認する。Google Cloud Billingの予算アラートを設定するが、自動停止ではないことを手順書に明記する |

### 共用に伴う運用上の帰結

**ある商談で投入したデータが、次の商談でそのまま見える。** これは環境を共用する以上避けられない。以下を運用の前提とする。

| ID | 要件 |
|---|---|
| OP-8 | **商談の前後に F-9 のデモデータリセットを実行する**ことを標準手順とする。前の商談で読み取った申請・画像が次の顧客に表示されることを防ぐ |
| OP-9 | NF-3-3（実在の個人情報を投入しない）の重要性が環境分離時より高い。**投入したデータは他の顧客の目に触れ得る**という前提で運用する。README および操作手順に明記する |

> **環境払い出しを取りやめた理由**: MVP はデモとしてのみ使用し、顧客へ環境を引き渡す運用を行わないため。分離すべき顧客データがそもそも存在しない。
>
> なお要件定義書 v1.3 まではこれを「コードの正しさに依存しない最後の防御層」として位置づけていた（NF-5-14）。将来マルチテナント化する場合、この層が無いことを踏まえて[第2層（SQL検査）](./tenant-isolation.md#第2層-実行前にsqlを検査する-mvp対象外将来必須)の導入を必須とする。

## 開発・検証

| ID | 要件 |
|---|---|
| OP-5 | ローカル開発は `wrangler dev` を使用する（Workers ランタイム・D1・R2 がローカルで動作する）。**ただし原本画像の署名付きURL（NF-2-14）はR2 S3互換APIで実クラウドのR2エンドポイントを直接指すため、ローカルのR2バインディングを経由せず、ローカル環境では原理的に確認できない**（アップロード自体はローカルR2バインディングで成功する。画像はローカルにしか保存されないため、表示確認には`wrangler dev --remote`でのアップロードからのやり直しが必要。[アーキテクチャ](../architecture/api.md#原本画像)を参照） |
| OP-6 | **ローカル環境ではCPU時間制限が適用されない**ため、認証処理の実装後は `wrangler dev --remote` または本番デプロイ後の実測でCPU時間を検証する |
| OP-7 | デモ用シードデータ（職員2件・会員5件）を投入するスクリプトを用意する |
| OP-10 | シード投入時、会員には **`isSeed = true`** を設定する（F-9-2 の判定に使用）。`id` はスクリプト内の固定値とし、実行のたびに採番しない（DB再構築時にデモ手順書のURLが変わらないようにするため） |

## デプロイ運用（リリースブランチ、実装時判断）

要件定義にはCI/CDのブランチ運用の定めが無く、実装時の判断として以下のとおり確定した（[判断記録 #53](./decisions.md#確定事項)）。

- **Cloudflareへの実デプロイ対象は `release` ブランチとする。** `main` は開発を継続する場所のまま変えず、リリース準備が整った時点で `main` の内容を `release` へマージしたときだけ本番へ反映する。
- **本番反映前のステージング確認（ワンクッション）は設けない。** 営業デモ用の単一環境であり、`release` へマージした内容がそのままCloudflareへ出る。
- **リリース後に過去バージョンだけを緊急修正する場合は、`release` ブランチ側で直接修正し、修正後に `main` へも反映する。**
- `.github/workflows/ci.yml` は `main` へのpush/PRでlint・test・buildのみを実行する（デプロイは行わない）。**`.github/workflows/deploy.yml` が `release` へのpushを契機にデプロイを実行する**（`main` へのpushでは動かさない）。依存監査・lint・test・buildを`ci.yml`と同じ内容で独立に再実行してから`pnpm run deploy`（`wrangler deploy`）を呼ぶ。外部の`cloudflare/wrangler-action`は使わず、既存のdevDependencyの`wrangler`をそのまま使う（新規の外部Action依存を増やさないため）。
- 本番用のCloudflare前提の整備状況（2026-09-18時点）:
  - **本番D1データベース(`ai-ocr-sample1`)を作成済み。** `wrangler.toml`の`database_id`を実際の値へ反映し、`wrangler d1 migrations apply DB --remote`でマイグレーション4件・`wrangler d1 execute DB --remote --file=scripts/db/seed.sql`でデモ用シード(テナント1件・職員2件・会員5件)を投入済み
  - **R2バケット(`ai-ocr-sample1-images`)を作成済み。** 事前にCloudflareダッシュボードでアカウント側のR2機能自体を有効化する必要があった（未有効化のアカウントでは`wrangler r2 bucket list`等が`[code: 10042]`で失敗する）
  - **GitHub Actions用のCloudflare APIトークンを登録済み。** Cloudflareダッシュボードで「Edit Cloudflare Workers」テンプレート（Account Resourcesは対象アカウントのみ、Zone Resourcesは「アカウントにあるすべてのゾーン」で対象アカウントのみに限定。独自ドメインを使わずゾーン権限自体は実質未使用）でトークンを発行し、当該リポジトリのSecretsへ`CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID`として登録した。**トークンの値自体はこのwiki・チャットのいずれにも記録しない**（登録済みという事実のみ記録する）
  - 以上でデプロイ自動化に必要なCloudflare側の前提が整い、`.github/workflows/deploy.yml`を実装した

### リリース手順（main → release マージ）

リリースのたびに、以下の手順で `main` の内容を `release` へ反映する。

```sh
# 1. mainを最新化する
git checkout main
git pull origin main

# 2. mainのCI（.github/workflows/ci.yml）が green であることを確認する

# 3. releaseブランチへ切り替え、最新化する
git checkout release
git pull origin release

# 4. mainの内容をreleaseへ取り込む
git merge main

# 5. コンフリクトが無ければそのままpush。コンフリクトが出た場合は該当ファイルを直してから
#    git add <直したファイル> → git commit → push する
git push origin release

# 6. 作業をmainへ戻す
git checkout main
```

- **`merge` を使い `rebase` は使わない。** `rebase` は履歴を書き換えるため、共有ブランチ（`release`）に対して行うと force push が必要になりやすく事故りやすい。`merge` の方が安全で、Git操作に不慣れな体制でも扱いやすい
- push前に必ずCIが緑であることを確認する
- `release` ブランチ側で緊急修正（直接コミット）を行った場合、このステップ4で修正コミットが自然に `main` へ合流する。逆に修正を先に `main` へ反映したい場合は `git checkout main && git merge release` で取り込む

## 関連ページ

- [機能要件 F-9 デモデータのリセット](./functional.md#f-9-デモデータのリセットadmin-のみ)
- [非機能要件](./non-functional.md)
- [テナント分離](./tenant-isolation.md)
- [システム構成](../architecture/cloudflare-stack.md)
- [判断記録 #53](./decisions.md#確定事項)
