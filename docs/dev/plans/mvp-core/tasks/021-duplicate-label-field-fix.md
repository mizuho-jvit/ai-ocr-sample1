---
id: "021"
title: "同一ラベル複数項目の編集を修正"
status: done
priority: 3
dependencies: ["010"]
estimated_complexity: low
---

# Task: 同一ラベル複数項目の編集を修正

## Goal

`PATCH /api/applications/:id/fields`（F-4-5）が、同じラベルを持つ項目が複数ある帳票
（例: 氏名欄が2箇所ある様式）で編集を壊す欠陥を修正する（コードレビュー指摘
`output/task-010-code-review.md` #5）。実際にOCR確認画面から「業務チェックへ進む」を
実行すると、正しく読み取れていた氏名・氏名カナが空欄化する不具合として顕在化した。

## Interfaces

`UpdateFieldsRequest`（`{label, value}[]`）のAPI契約は変更しない。既存の部分更新
（一部ラベルだけを送ると、未指定ラベルの項目はそのまま）も維持する。

## Test Strategy

- [x] 同ラベルが複数ある申請の全項目を、受信した並び順どおりに送り返すと、各項目が対応する位置の値へ個別に反映される（互いに上書きしない）。
- [x] 部分更新（一部ラベルだけを送る）では、まだ対応付けていない同ラベルの最初の項目へ適用される。
- [x] 既存の単一ラベルに対する部分更新・`edited`維持・`editedCount`再計算の挙動は壊れていない。
- [x] 申請詳細画面で同ラベルの項目が2つあるとき、一方を編集してももう一方の値・DOM `id` は独立している。

## Implementation Notes

- **`application-service.ts`の`updateFields`を、ラベルだけの`Map`から「受信順に1件ずつ消費し、まだ対応付けていない同ラベルの最初の項目へ割り当てる」方式に変更した（[決定#35](../../../../knowledge/wiki/requirements/decisions.md)）。** 画面は常に`application.fields`と同じ並び順で全項目を送り返す（`ocr-page.tsx`のF-4-6進む・`application-detail-page.tsx`の項目保存、どちらも決定#33/既存実装）ため、この消費方式で出現順の対応関係を復元できる。APIの入出力形状（`{label, value}[]`）は変更していないため、部分更新の既存テストもそのまま成立する。
- 画面側（`ocr-page.tsx`・`application-detail-page.tsx`）のReactの`key`とHTMLの`id`/`htmlFor`が`field.label`を使っており同ラベルで衝突していた（Reactの重複key警告、HTMLの重複id）。並び順が変わらない`index`へ変更した。
- `match-candidate-card.tsx`の`findFieldValue`（ラベル完全一致でのAI-OCR値取得。指摘#6相当）は本タスクの対象外。同ラベル複数項目のうちどちらを名寄せに使うかは別の判断が必要なため、着手しない。

## Files

- 変更: `src/worker/services/application-service.ts`, `src/react-app/pages/{ocr-page.tsx,application-detail-page.tsx}`, `knowledge/wiki/requirements/decisions.md`
- テスト: `test/worker/services/application-service-read.test.ts`, `test/react-app/pages/application-detail-page.test.tsx`
