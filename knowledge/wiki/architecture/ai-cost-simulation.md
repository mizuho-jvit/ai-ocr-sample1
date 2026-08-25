---
type: architecture
title: AI API利用料シミュレーション
description: MVP 1.0／1.1のAPI呼び出し回数、1文書・1申請・月次の利用料概算、月次上限の設定値、無料枠、計算前提
tags: [ai-ocr, architecture, cost, gemini, document-ai, simulation]
timestamp: 2026-08-21T00:00:00Z
---

# AI API利用料シミュレーション

## 結論

現在の設計では、1文書を「OCR読取＋業務チェック」まで完了する場合、次の呼び出しを行う。

| 製品版 | API呼び出し | 1文書の料金概算 |
|---|---|---:|
| **MVP 1.0** | Gemini 2回（Pass①読取、Pass②業務チェック） | **約0.5円** |
| **MVP 1.1** | Document AI 1回＋Gemini 2回 | **約0.5円＋Document AI分** |

月100枚のデモでは、Document AI Enterprise Document OCRの月1,000ページ無料枠内に収まるため、MVP 1.1のDocument AI利用料は **0円想定**である。MVP 1.1ではDocument AIのOCRテキストがGemini入力に追加されるため、Gemini料金はMVP 1.0よりわずかに増える可能性がある。

## API呼び出し回数

### MVP 1.0：Gemini単体

```text
画像
  → Gemini（Pass①：帳票種別・項目・確信度の抽出）
  → Gemini（Pass②：整合性・不備・名寄せ・トリアージ）
```

| 操作 | Gemini | Document AI |
|---|---:|---:|
| OCR読取だけ | 1回 | 0回 |
| OCR＋業務チェック | **2回** | 0回 |
| 業務チェック再実施1回 | 追加1回 | 0回 |

### MVP 1.1：Document AI＋Gemini

```text
画像
  → Document AI Enterprise Document OCR（前段OCR）
  → Gemini（Pass①：OCR文字・レイアウト＋元画像から項目抽出）
  → Gemini（Pass②：業務チェック）
```

| 操作 | Gemini | Document AI |
|---|---:|---:|
| OCR読取だけ | 1回 | 1回 |
| OCR＋業務チェック | **2回** | **1回** |
| 業務チェック再実施1回 | 追加1回 | 0回 |

Document AIが失敗した場合、Gemini単体へ自動フォールバックしない設計である。再試行時はPipeline全体を再実行するため、呼び出し回数が増える可能性がある。

## 料金単価（2026-08-20確認）

### Gemini 3.1 Flash-Lite

| 項目 | 標準料金（Global、100万トークン当たり） |
|---|---:|
| 入力（テキスト・画像・動画） | $0.25 |
| 出力（テキスト・推論を含む） | $1.50 |

### Gemini 3.5 Flash-Lite（EOLを長くした場合の候補）

| 項目 | 標準料金（Global、100万トークン当たり） |
|---|---:|
| 入力（テキスト・画像・動画・音声） | $0.30 |
| 出力（テキスト・推論を含む） | $2.50 |

Gemini 3.5 Flash-Liteは画像入力とStructured Outputsに対応するが、現在の設計で採用している3.1より入力・出力単価が高い。モデルIDは `GEMINI_MODEL` で切り替えられる。

### Document AI Enterprise Document OCR

| 月間処理ページ数 | 料金 |
|---:|---:|
| 0～1,000ページ | 無料 |
| 1,001～5,000,000ページ | $1.50／1,000ページ |
| 5,000,000ページ超 | $0.60／1,000ページ |

本シミュレーションではOCRアドオン、Custom Extractor、Form Parser、Layout Parserは使用しない。

公式料金：[Gemini](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing)、[Document AI](https://cloud.google.com/products/document-ai/pricing)

## 1文書あたりの概算

既存設計書で置いているGemini 3.1 Flash-Liteの試算を使用する。

| 処理 | Gemini料金の既存概算 |
|---|---:|
| Pass①：OCR読取 | 約0.26円 |
| Pass②：業務チェック | 約0.19円 |
| OCR＋業務チェック | **約0.45円（概算0.5円）** |

### MVP 1.0

| ケース | 呼び出し | Gemini料金概算 |
|---|---:|---:|
| OCR読取だけ | 1回 | 約0.26円 |
| OCR＋業務チェック | 2回 | 約0.45円（概算0.5円） |
| OCR＋業務チェック＋再実施1回 | 3回 | 約0.64円 |
| **OCR＋業務チェック5回（1申請の上限）** | **6回** | **約1.21円** |

### MVP 1.1

| ケース | 呼び出し | 料金概算 |
|---|---:|---:|
| OCR読取だけ | Document AI 1回＋Gemini 1回 | 約0.26円＋OCRテキスト入力分。Document AIは無料枠内なら0円 |
| OCR＋業務チェック | Document AI 1回＋Gemini 2回 | 約0.45円＋OCRテキスト入力分。Document AIは無料枠内なら0円 |
| OCR＋業務チェック＋再実施1回 | Document AI 1回＋Gemini 3回 | 約0.64円＋OCRテキスト入力分。Document AIは無料枠内なら0円 |
| **OCR＋業務チェック5回（1申請の上限）** | **Document AI 1回＋Gemini 6回** | **約1.21円＋OCRテキスト入力分。Document AIは無料枠内なら0円** |

「OCRテキスト入力分」は帳票の文字量によって変わるため、実装後にGeminiの実際のinput token数を計測して更新する。

### 1申請あたりの上限

業務チェックの再実施回数は `MAX_CHECK_RUNS_PER_APPLICATION` で制限し、MVPでは `5` を設定する。つまり1申請で発生し得る最大の呼び出しは次の内訳になる。

| 内訳 | 回数 | 単価 | 小計 |
|---|---:|---:|---:|
| Pass①（読取） | 1回 | 約0.26円 | 約0.26円 |
| Pass②（業務チェック、`CheckRun` 5件まで） | 5回 | 約0.19円 | 約0.95円 |
| **合計** | **6回** | — | **約1.21円** |

Pass②は画像を伴わないが1回ごとに課金されるため、**1申請の上限コストは読取のみの約4.7倍**になる。Document AIは1申請で1回しか呼ばないため、再実施を繰り返してもDocument AI側のページ数は増えない。

## 月次シミュレーション

「1文書＝1ページ」「Gemini 3.1 Flash-Lite」を前提とする。

### 業務チェック1回（想定運用）

| 月間文書数 | Gemini呼び出し | Document AIページ | Gemini料金概算 | Document AI料金 | 合計概算 |
|---:|---:|---:|---:|---:|---:|
| 100 | 200回 | 100 | 約50円 | $0 | **約50円＋微小な入力差** |
| **120（MVPの月次上限）** | **240回** | **120** | **約54円** | **$0** | **約54円＋微小な入力差** |
| 1,000 | 2,000回 | 1,000 | 約500円 | $0 | **約500円＋微小な入力差** |
| 1,100 | 2,200回 | 1,100 | 約550円 | $0.15 | **約550円＋$0.15＋微小な入力差** |

### 業務チェック5回（1申請の上限まで実施した最悪ケース）

全申請で `CheckRun` を上限の5件まで実施した場合。1申請あたり約1.21円で計算する。

| 月間文書数 | Gemini呼び出し | Document AIページ | Gemini料金概算 | Document AI料金 | 合計概算 |
|---:|---:|---:|---:|---:|---:|
| 100 | 600回 | 100 | 約121円 | $0 | **約121円＋微小な入力差** |
| **120（MVPの月次上限）** | **720回** | **120** | **約145円** | **$0** | **約145円＋微小な入力差** |

Document AIのページ数は業務チェックの再実施では増えないため、最悪ケースでも月120ページであり無料枠1,000ページの範囲内に収まる。

MVP 1.0ではDocument AI列・料金は発生しない。MVP 1.1では月間ページ数をGoogle Cloudプロジェクト内の他用途と合算して判定する。

## 月次上限の設定値

課金の歯止めはアプリケーション側の月次カウンタで行う。上限値は環境変数で定義し、コードへハードコードしない。値の変更は環境変数の書き換えと再デプロイのみで完結する。

| 環境変数 | MVP設定値 | 意味 |
|---|---:|---|
| `MAX_OCR_PAGES_PER_MONTH` | `120` | 月間の読取枚数（Pass①の実行回数＝Document AIのページ数） |
| `MAX_GEMINI_CALLS_PER_MONTH` | `720` | 月間のGemini呼び出し回数（Pass①・Pass②の合算） |
| `MAX_CHECK_RUNS_PER_APPLICATION` | `5` | 1申請あたりの `CheckRun` 件数 |

`MAX_GEMINI_CALLS_PER_MONTH=720` は他の2つの上限から導かれる最悪値（読取120回＋業務チェック 120×5＝600回）と一致する。したがって通常運用では発動せず、**申請単位の上限が機能しなかった場合にのみ作動する不変条件チェック**として働く。

**MVP設定値で到達し得る月額の上限は約145円**である。想定運用（各申請で業務チェック1回）では約54円に収まる。

> 上限値の定義、未設定時の起動失敗、期間キーによる月次リセット、`F-9` リセットでカウンタを初期化しない扱いは[非機能要件](../requirements/non-functional.md#ai呼び出し回数の上限アプリケーション側)を参照する。

## 料金に影響する要素

- 業務チェックの再実施1回につきGeminiを1回追加する。1申請あたりの上限は `MAX_CHECK_RUNS_PER_APPLICATION`（MVPでは5件）で抑える。
- API失敗時の再試行は、成功するまでの呼び出し回数を増やす可能性がある。
- AI Gatewayのキャッシュがヒットした場合、Geminiの実課金や待ち時間を抑えられる。ただしMVP 1.1ではDocument AI呼び出し自体を省略できるとは限らない。
- Gemini 3.5 Flash-Liteへ変更する場合、入力・出力単価が上がるため、同じトークン量でも料金は増える。
- Google Cloudの料金、無料枠、為替レートは変更され得るため、実装・デモ開始前に公式料金を再確認する。

## シミュレーションの範囲外

以下はこの表の料金に含めない。

- Cloudflare Workers、D1、R2、通信、ログ保管等のインフラ料金
- Cloudflare AI Gatewayの有料機能・契約プラン料金
- Google Cloud Billingの予算アラート以外の運用費
- OCRアドオン、Custom Extractor、Form Parser、Layout Parser
- 失敗時の再試行回数やキャッシュヒット率による変動

## 関連ページ

- [外部OCR・AI API設計](./ai-api.md)
- [非機能要件](../requirements/non-functional.md)
- [運用要件](../requirements/operations.md)
