---
id: "014"
title: "デモデータリセットを実装"
status: done
priority: 2
dependencies: ["002", "003"]
estimated_complexity: high
---

# Task: デモデータリセットを実装

## Goal

adminが確認語とプレビューを経てデモデータだけを安全に削除できるようにする。

## Interfaces

```ts
function previewReset(actor: SessionActor): Promise<ResetPreviewResponse>; // 🔵
function resetDemoData(input: ResetRequest, actor: SessionActor): Promise<ResetResponse>; // 🔵
```

## Test Strategy

- [x] 無効設定なら404、staffなら403、確認語不一致なら422で削除しない。
- [x] previewで申請・画像・非seed会員数と確認語を返す。
- [x] imageKey収集→子からD1削除→1000件単位R2削除の順に実行する。
- [x] seed会員、職員、Tenant、Session、UsageCounterを保持する。

## Implementation Notes

- 実行者・日時・件数だけをログに出し、OCR/個人データは出さない。

## Files

- 新規: `src/worker/{services/demo-reset.ts,routes/demo.ts}`, `src/react-app/pages/reset-page.tsx`
- テスト: `test/worker/services/demo-reset.test.ts`
