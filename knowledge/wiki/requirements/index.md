# 要件・仕様

<!-- 予約ファイル。フロントマターは付けない（SCHEMA.md §3.3）。 -->

AI-OCR 帳票読取・一次審査システム（営業デモ用）の要件。正典化元は要件定義書 v1.10（`knowledge/ref/doc/claude_code_要件定義_v1.10.md`）で、**確定済み・未確定事項なし**。OCR構成はMVP 1.0をGemini単体、MVP 1.1をDocument AI＋Geminiとする。

| ページ | 元の章 | 内容 |
|---|---|---|
| [overview.md](./overview.md) | §1・§2・§3・§12 | 目的、プロダクトポジショニング、デザイン要件、対象／対象外、ユーザーとロール、権限マトリクス、会員のライフサイクル、制約事項 |
| [functional.md](./functional.md) | §5 | F-1〜F-9 の機能要件 |
| [non-functional.md](./non-functional.md) | §7.1〜§7.4 | 性能、セキュリティ（PBKDF2・AI呼び出し上限）、データ保持、保守性、環境変数一覧 |
| [tenant-isolation.md](./tenant-isolation.md) | §7.5・§9.1 | テナント分離方針、4層防御、`TENANT_ID` 固定 |
| [operations.md](./operations.md) | §11 | 単一デモ環境、開発・検証 |
| [acceptance.md](./acceptance.md) | §14 | 受け入れ基準 |
| [decisions.md](./decisions.md) | §10・§13 | 要求からの変更点、確定事項、撤回した判断 |
| [production-gap.md](./production-gap.md) | — | **本番化ギャップ。** 本番構成を決める前に答えが必要な問い、デモ限定の割り切りと代替方針、手当て済みの箇所、未記載の要件ギャップ |

`production-gap.md` だけは**正典化元を持たない**（要件定義書に対応する章がない）。MVP の要件確定後に、本番化の検討で必要になる論点を整理したページである。**ここに挙がる「問い」は MVP の未確定事項ではない。**

要件定義書の §4（システム構成）・§8（外部AI API）・§9（データモデル）・§6（画面要件）は、ドメイン別に以下へ配置した。

- [../architecture/cloudflare-stack.md](../architecture/cloudflare-stack.md) — §4
- [../architecture/ai-api.md](../architecture/ai-api.md) — §8・付録
- [../db/data-model.md](../db/data-model.md) — §9
- [../screens/screen-list.md](../screens/screen-list.md) — §6

## 読む順序

初見であれば `overview.md` → `functional.md` → `non-functional.md`。**設計の判断理由を追う場合は `decisions.md` から入る**（撤回した論拠が記録されているため、成立しない前提を再利用せずに済む）。
