# Plan: mvp-core

## Requirements Summary

営業デモ用AI-OCR一次審査システムのMVP全体を実装する。対象は職員認証、OCR、AI業務チェック、申請・会員・スタッフ管理、名寄せ、CSV、デモリセットである。詳細は [requirements.md](requirements.md)、[user-stories.md](user-stories.md)、[acceptance-criteria.md](acceptance-criteria.md) を参照する。

MVP 1.0はGemini単体で先に完成させ、同じ `OcrPipeline` 契約のままMVP 1.1のDocument AI＋Geminiを後続フェーズで追加する。要件・API・型の正典は `knowledge/wiki/` であり、本Planはそれを実装可能な順序へ分割したもの。

## Design Overview

`Request → Basic Auth → application session → role check → currentTenantId → forTenant → route → service → repository` を全APIの共通経路とする。SPAは共有DTOのみを利用して `/api/*` を呼び、Workerのサービス実装をimportしない。

- `src/worker/types/`: WikiのDTO・列挙型・エラー契約を実装する。
- `src/worker/config/`: 必須環境変数を起動時に検証する。秘密値はWorkerの`env`からだけ読む。
- `src/worker/db/`: Drizzle/D1の生ハンドルを公開せず、`currentTenantId` と `forTenant` を必須にしたrepository群を置く。
- `src/worker/services/`: 認証、利用量、OCR Pipeline、名寄せ、業務チェック、状態遷移、CSV、リセットを集約する。
- `src/worker/routes/`: 入力検証・認証/認可・HTTP応答変換だけを担う。
- `src/react-app/`: 画像リサイズ、画面遷移、進捗、DTOの表示を担う。API認可はしない。

R2の15分署名URL（NF-2-14）は、Workerがアプリ内認可とテナントprefix検証の後にR2 S3互換APIのGET URLを都度発行する。`R2_S3_ACCESS_KEY_ID` / `R2_S3_SECRET_ACCESS_KEY` はWorkers Secret、`R2_ACCOUNT_ID` は通常の環境変数とし、URL自体は保存しない。

## Task Dependency Graph

```text
001 → 002 → 003 → 004
001 → 005 → 006 → 007 → 009 → 010 → 015 → 016 → 018
001 → 008 → 009
001 → 011 → 013 → 016
003 → 004 → 007 → 010 → 015
003 → 012 → 016
003 → 014 → 016
002 → 015
017 → 007 → 015
```

| ID | Task | Depends on |
|---|---|---|
| 001 | 共有契約・設定・テナント境界を実装 | — |
| 002 | DB接続・リポジトリ基盤・シードを実装 | 001 |
| 003 | アプリ内認証・セッション・ロール認可を実装 | 002 |
| 004 | SPAの認証シェルとログイン画面を実装 | 003 |
| 005 | 月次利用量制御を実装 | 001, 002 |
| 006 | OCR PipelineとAI設定を実装 | 001, 005 |
| 007 | OCR受付・R2原本管理・読取画面を実装 | 003, 004, 006 |
| 008 | 名寄せの正規化と候補抽出を実装 | 001, 002 |
| 009 | AI業務チェックとCheckRun保存を実装 | 003, 005, 006, 008 |
| 010 | 申請の一覧・詳細・状態遷移を実装 | 003, 004, 009 |
| 011 | 会員管理と状態履歴を実装 | 002, 008 |
| 012 | スタッフ管理を実装 | 003 |
| 013 | CSV入出力を実装 | 003, 010, 011 |
| 014 | デモデータリセットを実装 | 003, 002 |
| 015 | テナント分離・API統合テストを実装 | 002, 003, 005, 007, 008, 009, 010, 011, 012, 013, 014 |
| 016 | E2E・性能・運用手順を整備 | 004, 007, 010, 012, 013, 014, 015 |
| 017 | R2署名URLの実装方針を確定 | — |
| 018 | MVP 1.1のDocument AI Pipelineを追加 | 006, 007, 016 |

## Cross-Plan Dependencies

017で署名URLの発行方式を正典へ反映済み。MVP 1.1はMVP 1.0受入基準を満たした後に018で着手する。

## Verification

- 各タスクで対象Vitestを追加し、`corepack pnpm lint`、`corepack pnpm test`、`corepack pnpm build`を実行する。
- 015でAPI一覧とクロステナント検証対象を突合し、未登録エンドポイントを失敗させる。
- 016で`dev:remote`またはデプロイ環境にてPBKDF2とAI処理の性能目標を実測する。
