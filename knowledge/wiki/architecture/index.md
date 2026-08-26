# アーキテクチャ

<!-- 予約ファイル。フロントマターは付けない（SCHEMA.md §3.3）。 -->

| ページ | 元の章 | 内容 |
|---|---|---|
| [cloudflare-stack.md](./cloudflare-stack.md) | 要件定義書 v1.11 §4 | 全体構成、技術スタックと選定理由、Workers 無料枠の制約と対応 |
| [ai-api.md](./ai-api.md) | 要件定義書 v1.11 §8・付録 | MVP 1.0のGemini単体構成、MVP 1.1のDocument AI＋Gemini構成、コスト、認証、OCR Pipeline設計 |
| [ai-cost-simulation.md](./ai-cost-simulation.md) | 要件定義書 v1.11 §8・付録 | MVP 1.0／1.1のAPI呼び出し回数、1文書・月次の利用料概算、無料枠、計算前提 |
| [api.md](./api.md) | **要件から導出**（正典化元なし） | 全28エンドポイントのメソッド・パス・ロール・要求／応答・ステータスコード、共通のエラー規約 |
| [types.md](./types.md) | **要件から導出**（正典化元なし） | SPA と Worker が共有する TypeScript 型。列挙型・OCR抽出・業務チェック・名寄せ・DTO・環境設定・スコープ済みハンドル |
| [dataflow.md](./dataflow.md) | **要件から導出**（正典化元なし） | リクエストの通過順、読取・業務チェック・名寄せの順序、申請と会員の状態遷移、リセット手順（Mermaid） |

> **末尾3ページは要件定義書の章を正典化したものではない。** [機能要件](../requirements/functional.md)・
> [非機能要件](../requirements/non-functional.md)・[データモデル](../db/data-model.md)から導出した設計であり、
> 各記述に根拠の要件IDを付している。要件に明記がない判断は各ページ末尾の「設計判断」節に列挙する。

## 構成の要点

- **Cloudflare 無料枠に収める**ことが構成上の最大の制約。有料プランへ移行しない
- **CPU時間 10ms／リクエスト**の制約は計算処理にのみ適用され、AI応答待ちには適用されない。この理解が構成全体の前提になっている
- **GeminiとDocument AIが従量課金対象**。月約100枚ではDocument AIの月1,000ページ無料枠内を想定する。歯止めはアプリケーション側の**月次上限**（読取120枚・Gemini呼び出し720回）、AI Gatewayの予算上限、Google Cloud Billingの予算アラートで構成する

## 関連

- [データモデル](../db/data-model.md)
- [非機能要件](../requirements/non-functional.md)
- [運用要件](../requirements/operations.md)
