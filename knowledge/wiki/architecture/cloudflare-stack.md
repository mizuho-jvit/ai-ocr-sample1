---
type: architecture
title: システム構成（Cloudflare 無料枠）
description: Vite+React SPA / Hono on Workers / D1+Drizzle / R2 / Gemini / Document AI の全体構成と、無料枠の制約への対応
tags: [ai-ocr, architecture, cloudflare, workers, d1, r2, free-tier, gemini, document-ai]
timestamp: 2026-08-20T00:00:00Z
---

# システム構成（Cloudflare 無料枠）

> 正典化元: 要件定義書 v1.11 §4（原本は `knowledge/ref/doc/claude_code_要件定義_v1.11.md`）

## 全体構成

```
[ブラウザ]
   ↓  Basic認証（静的アセット・SPA・全API共通の前段ゲート）
[React SPA (Vite)]
   │  画像を長辺1568px / JPEG品質85% にリサイズ → base64化
   │  ※ 画像処理はクライアント側で実施し、Worker のCPU消費を回避する
   ↓  same-origin fetch + HTTPOnly Cookie
[Cloudflare Workers]  Hono Basic Auth Middleware + Workers Static Assets
   ├ /api/auth/*        認証・セッション検証
   ├ /api/applications/*  申請CRUD・ステータス遷移
   ├ /api/members/*     会員CRUD・検索・名寄せ第1段
   ├ /api/staff/*       スタッフ管理（admin のみ）
   ├ /api/usage         当月のAI利用量（残り読取可能枚数）
   ├ /api/demo/reset    デモデータのリセット（admin のみ）
   ├ /api/ocr/extract  ─┼→ [OCR Pipeline]
   │                      ├ MVP 1.0: [AI Gateway] → Gemini API
   │                      └ MVP 1.1: Document AI Enterprise OCR
   │                                  ↓ OCR文字・レイアウト＋元画像
   │                                 [AI Gateway] → Gemini API
   ├ /api/checks/run   ─┼→ [AI Gateway] → Gemini API
   └ /api/images/:id   ─┼→ [R2] 原本画像
                        └→ [D1] 業務データ
```

**上図は概略である。** メソッド・パス・要求／応答・ステータスコードを含む網羅的な一覧は
[APIエンドポイント仕様](./api.md)が正典であり、CSV入出力（F-8）等はそちらにのみ記載する。
処理の順序は [データフロー](./dataflow.md)、SPA と Worker が共有する型は [共有型定義](./types.md)。

## 技術スタック

| レイヤ | 採用技術 | 選定理由 |
|---|---|---|
| フロントエンド | Vite + React（SPA） | プロトタイプがクライアントサイドSPAであり移植が最短。バンドルが軽く無料枠に収まる。Basic認証を全アセットへ適用するため、Static AssetsはWorker先行で配信する |
| APIサーバー | Hono on Cloudflare Workers | 軽量。無料枠のバンドルサイズ制限（3MB gzip）に対し十分な余裕がある |
| データベース | Cloudflare D1（SQLite互換） | 無料枠で利用可。SQLiteベースのため既存設計をそのまま適用できる |
| ORM | Drizzle ORM | D1ネイティブ対応。Prisma に比べバンドルサイズが小さい |
| オブジェクトストレージ | Cloudflare R2 | 原本画像の保存。無料枠 10GB、エグレス無料 |
| AIゲートウェイ | Cloudflare AI Gateway | キャッシュ・予算上限・リトライ・ログ集約。**ログはメタデータのみ収集し、ペイロード（元画像を含む本文）の収集は無効化する**（NF-2-42・AI-7a） |
| OCR前処理（MVP 1.1） | Google Cloud Document AI Enterprise Document OCR | 日本語手書きを含むOCR文字・レイアウトをGeminiのPass①へ補助入力する。MVP 1.0では使用しない |
| 認証 | Hono Basic Auth Middleware + 自前実装（WebCrypto PBKDF2 + D1セッション） | Basic認証をデモ環境への前段ゲートとし、アプリ内ログインで職員識別・ロール認可を行う |

Workers Static Assets は既定では一致する静的ファイルをWorkerより先に配信するため、`assets.binding = "ASSETS"` と **`assets.run_worker_first = true`** を設定する。全リクエストをHonoのBasic認証ミドルウェアへ通し、成功後のみAPIハンドラまたは `env.ASSETS.fetch()` へ進める。

> **要求ドキュメントからの変更点**: 要求では Next.js + SQLite（ローカルファイル）+ Prisma + `/uploads` ローカル保存が推奨されていたが、Cloudflare Workers には永続ファイルシステムが存在せず、また Next.js は無料枠のバンドルサイズ制限に抵触するリスクが高いため、上記構成に変更する（[判断記録 #1〜#4](../requirements/decisions.md#要求ドキュメントからの変更点)）。

## 実行環境の制約と対応

Cloudflare Workers 無料枠の制限は以下のとおり（2026年8月時点）。

| 制限項目 | 無料枠の値 | 本システムへの影響と対応 |
|---|---|---|
| CPU時間 | 10ms／リクエスト | **ネットワーク待機時間はカウントされない**ため、AI API 応答待ち（10〜15秒）は影響しない。計算処理を伴うパスワードハッシュのみ対応が必要（[パスワード管理](../requirements/non-functional.md#パスワード管理)） |
| リクエスト数 | 100,000／日 | `run_worker_first = true` により静的アセットもWorkerリクエスト数を消費する。営業デモ規模では十分だが、利用状況を監視する |
| Workerサイズ | 3MB（gzip） | Hono + Drizzle 構成で十分な余裕がある |
| サブリクエスト数 | 50／リクエスト | MVP 1.0はGemini 1回、MVP 1.1はDocument AI＋Geminiに必要に応じたOAuthトークン取得を加えても上限内 |
| D1 ストレージ | 5GB | 業務データのみのため十分 |
| R2 ストレージ | 10GB／月 | 1枚200KB換算で約5万枚。デモ用途では十分 |

出典: [Cloudflare Workers Platform Limits](https://developers.cloudflare.com/workers/platform/limits)

> **CPU時間制約の主な帰結**は2つある。
> 1. パスワードハッシュの反復回数をデモ環境では20,000回とし、実装後にリモート環境でCPU時間を検証する（NF-2-7）
> 2. 画像リサイズをクライアント側で行っている（F-2-2）
>
> ローカルの `wrangler dev` では CPU 時間制限が適用されないため、実測は `--remote` または本番デプロイ後に行う（OP-6）。

## 関連ページ

- [外部AI API](./ai-api.md)
- [データモデル](../db/data-model.md)
- [非機能要件](../requirements/non-functional.md)
- [運用要件](../requirements/operations.md)
- [判断記録](../requirements/decisions.md)
