---
id: "019"
title: "業務チェックへの画面動線を実装"
status: done
priority: 2
dependencies: ["007", "009", "010"]
estimated_complexity: medium
---

# Task: 業務チェックへの画面動線を実装

## Goal

OCR読取確認画面の「業務チェックへ進む」ボタンと、申請詳細画面の「業務チェックを再実施」ボタンから
`POST /api/checks/run` を呼び出せるようにし、商談で提示する「OCR読取 → 業務チェック → 名寄せ →
承認」の動線をUIから実行できるようにする（コードレビュー指摘、`output/task-010-code-review.md` #2）。

## Interfaces

```ts
interface ChecksApi {
  run(input: RunCheckRequest): Promise<RunCheckResponse>; // 🔵
}
```

## Test Strategy

- [x] OCR確認画面でその場修正した項目が`updateFields`経由で保存されてから業務チェックが実行される（決定#33）。保存に失敗した場合は業務チェックを実行しない。
- [x] 業務チェック成功後、申請詳細画面へ遷移する。
- [x] `CHECK_RUN_LIMIT`(409)・`USAGE_LIMIT_EXCEEDED`(429・`checks.test.ts`で検証)・`AI_UNAVAILABLE`(503)のサーバー文言がそのまま画面に表示され、読取確認画面から離脱しない（再試行できる）。
- [x] 申請詳細画面の再実施ボタンは`appStatus: approved`のとき実行不可。
- [x] 申請詳細画面で再実施成功後、`ApplicationDetail`（最新の業務チェック結果・名寄せ候補・ステータス）と残り実施回数(`remainingRuns`)が画面へ反映される。

## Implementation Notes

- `src/react-app/api/checks.ts`は`api/ocr.ts`の`OcrApiError`/`toErrorMessage`と同じ構成にする（`ChecksApiError`は`retryable`を持ち、`AI_UNAVAILABLE`(503)の再試行可否を画面が判断できるようにする）。
- OCR確認画面でその場修正した値は、「業務チェックへ進む」押下時に`applicationsApi.updateFields`で保存してから`checksApi.run`を呼ぶ（ユーザー判断・[決定#33](../../../../knowledge/wiki/requirements/decisions.md)）。
- 業務チェック成功後の申請詳細への遷移は、SPAにルーターを導入しない方針（決定#31）に沿い、`AppShell`の既存`handleSelectApplication`をそのまま再利用する。
- 画面一覧の「業務チェック結果」は独立画面を作らず、Task 010で統合した申請詳細画面のままとする（決定#2）。`knowledge/wiki/screens/screen-list.md`を実態に合わせて更新する（画面数11→10）。
- エラー表示は各APIモジュールが独自の例外クラス（`OcrApiError`/`ApplicationsApiError`/`ChecksApiError`）を持つ既存方針を維持し、複数APIをまたぐ画面側でのみローカルな解決関数でメッセージを取り出す（型を跨いだ共通クラス化はしない）。

## Files

- 新規: `src/react-app/{api/checks.ts,components/ocr-field-row.tsx}`
- 変更: `src/react-app/{pages/ocr-page.tsx,pages/application-detail-page.tsx,components/app-shell.tsx}`, `knowledge/wiki/screens/screen-list.md`
- テスト: `test/react-app/{api/checks.test.ts,pages/ocr-page.test.tsx,pages/application-detail-page.test.tsx}`

## Note

- `ocr-page.tsx`が500行ルールを超えたため、読取確認行コンポーネント`OcrFieldRow`（`CONFIDENCE_HIGHLIGHT_THRESHOLD`・`EditableField`を含む）を`src/react-app/components/ocr-field-row.tsx`へ分離した（`match-candidate-card.tsx`と同じ方針）。
- `AppShell`側の変更は`onProceedToCheck={handleSelectApplication}`を渡す1行のみで、既存のナビゲーション処理を再利用したため、`app-shell.test.tsx`への新規テストは追加していない（OcrPage単体の`onProceedToCheck`呼び出しテストでカバー済み）。
