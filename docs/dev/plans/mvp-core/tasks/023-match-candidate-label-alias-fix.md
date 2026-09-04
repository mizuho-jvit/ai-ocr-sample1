---
id: "023"
title: "名寄せ候補カードのOCRラベル別名対応"
status: done
priority: 3
dependencies: ["010"]
estimated_complexity: low
---

# Task: 名寄せ候補カードのOCRラベル別名対応

## Goal

名寄せ判定（`business-check.ts`）はOCRラベルの表記ゆれ（「フリガナ」「ふりがな」「氏名（カナ）」
「電話」等）を辞書で吸収しているが、申請詳細画面の名寄せ候補カード（`match-candidate-card.tsx`）
は「氏名カナ」「電話番号」の完全一致だけで申請データ側の値を探しており、別表記のOCR結果を
拾えず空欄・不一致ハイライトとして誤表示していた欠陥を修正する（コードレビュー指摘
`output/task-010-code-review.md` #6）。

## Interfaces

`MatchCandidateCard`の props（`ApplicationDetail`・`MatchCandidateView`）は変更しない。

## Test Strategy

- [x] OCRラベルが「フリガナ」「電話」等の別表記であっても、候補カードの申請データ側に値が表示される。
- [x] 別表記であっても会員データと値が一致していれば不一致ハイライト（`data-differs`）が付かない。
- [x] 表記ゆれ辞書の判定ロジック（trim・空文字はnull扱い）を単体で確認する。

## Implementation Notes

- **表記ゆれ辞書（`NAME_LABELS`・`NAME_KANA_LABELS`・`BIRTH_DATE_LABELS`・`PHONE_LABELS`）と
  判定関数`findFieldValueByLabels`を、Worker固有の`services/`からもSPA固有の`react-app/`からも
  独立した`src/shared/field-label-aliases.ts`へ切り出した（[決定#38](../../../../knowledge/wiki/requirements/decisions.md)）。**
  外部I/O・Cloudflare依存を持たない純粋データ・純粋関数のみで構成し、`business-check.ts`と
  `match-candidate-card.tsx`の両方から同じ辞書を参照する。
- 既存の「SPAからWorkerの型は`import type`でのみ共有し、実行時コードは持ち込まない」境界
  （`context.md`）は維持しつつ、この1ファイルだけを「外部I/O非依存の純粋データ」という条件で
  通常importの例外として認めた。境界そのものを広げる決定なので`context.md`へも反映した。
- `matching-constants.ts`からは表記ゆれ辞書を削除し、名寄せスコアの重み（`SCORE_WEIGHTS`、
  Worker固有ロジック）だけを残した。
- Vitestに`test/shared/**`を対象とする3つ目のプロジェクト（`shared`、workerd/happy-domどちらの
  環境も不要な純粋ロジック用）を追加した。

## Files

- 新規: `src/shared/field-label-aliases.ts`
- 変更: `src/worker/services/{matching-constants.ts,business-check.ts}`, `src/react-app/components/match-candidate-card.tsx`, `vitest.config.ts`, `docs/dev/context.md`, `knowledge/wiki/requirements/decisions.md`
- テスト: `test/shared/field-label-aliases.test.ts`（新規）, `test/react-app/pages/application-detail-page.test.tsx`
