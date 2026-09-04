---
id: "020"
title: "差戻し文面の編集・コピーを実装"
status: done
priority: 3
dependencies: ["010", "019"]
estimated_complexity: low
---

# Task: 差戻し文面の編集・コピーを実装

## Goal

申請詳細画面で `CheckRun.letterDraft`（差戻し文面の下書き）を職員が編集し、クリップボードへコピーして
メールソフト等へ貼り付けられるようにする（F-3-5「職員が編集・コピー可能であること」、
コードレビュー指摘 `output/task-010-code-review.md` #3）。編集内容は**保存しない**
（[決定#34](../../../../knowledge/wiki/requirements/decisions.md)）。

## Interfaces

```ts
interface LetterDraftEditorProps {
  draft: string;                                     // CheckRun.letterDraft（非null）
  writeClipboard?: (text: string) => Promise<void>;  // 既定は navigator.clipboard.writeText 🔵
}
```

## Test Strategy

- [x] `letterDraft` が非nullのとき、編集可能な `textarea` に下書きが初期表示される。`null` のときは編集UIを出さない。
- [x] 「コピー」で `textarea` の**現在の（編集後の）値**がクリップボードへ書き込まれ、成功を通知する。
- [x] クリップボードへの書き込みに失敗した場合、手動コピーを促す文言を表示し、画面は壊れない。
- [x] 「編集内容は保存されない」注記が表示される。
- [x] 業務チェックを再実施すると、編集途中の内容は破棄され新しい `CheckRun` の下書きに置き換わる（編集状態を古い `CheckRun` に引きずらない）。

## Implementation Notes

- **保存先・保存APIは作らない。** `CheckRun` は追記専用（data-model.md「監査列」）で、AI下書きを編集結果で上書きすると決定#6（判定履歴の監査性）に反する。要件（F-3-5・overview「差戻し文面は下書き生成までが仕様」）にも永続化の要求は無い（決定#34）。
- コンポーネントは `src/react-app/components/letter-draft-editor.tsx` へ分離する（`application-detail-page.tsx` が472行で、追加すると500行ルールを超えるため。`match-candidate-card.tsx`・`ocr-field-row.tsx` と同じ方針）。
- クリップボード書き込みは `writeClipboard` プロップで注入可能にし、テストでは `vi.fn()` を渡す。既定実装は `navigator.clipboard` が無い環境（非HTTPS等）で明示的に失敗させ、フォールバック（`execCommand` 等）は入れない。
- 再実施時のリセットは、ページ側で `key={latestCheckRun.id}` を付けて再マウントする（`useEffect` で同期しない）。
- 将来「差戻し時の文面を証跡として残したい」となった場合は、`POST /api/applications/:id/status` が既に受け付ける `note` に渡す拡張で足りる（新カラム不要）。本タスクでは行わない。

## Files

- 新規: `src/react-app/components/letter-draft-editor.tsx`, `test/react-app/components/letter-draft-editor.test.tsx`
- 変更: `src/react-app/pages/application-detail-page.tsx`, `test/react-app/pages/application-detail-page.test.tsx`, `knowledge/wiki/requirements/decisions.md`, `knowledge/wiki/screens/screen-list.md`
