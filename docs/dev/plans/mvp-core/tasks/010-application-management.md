---
id: "010"
title: "申請管理と名寄せ判断画面を実装"
status: pending
priority: 2
dependencies: ["003", "004", "009"]
estimated_complexity: high
---

# Task: 申請管理と名寄せ判断画面を実装

## Goal

申請の一覧、詳細、項目編集、状態遷移、CheckRun履歴、候補判断を職員が扱えるようにする。

## Interfaces

```ts
function changeApplicationStatus(id: string, input: ChangeAppStatusRequest, actor: SessionActor): Promise<ChangeAppStatusResponse>; // 🔵
function decideMatch(id: string, candidateId: string, input: DecideMatchRequest): Promise<DecideMatchResponse>; // 🔵
```

## Test Strategy

- [ ] 指定フィルタと要審査ビューでテナント内だけを返す。
- [ ] 編集者と編集済みフラグを記録しAI確信度は変えない。
- [ ] 許可遷移だけを通し、承認でpending会員をactive化して履歴化する。
- [ ] merged/rejected/holdの判断と左右差分表示が正しい。

## Implementation Notes

- 静的ルートを`:id`より先に登録する。後着優先で排他制御はしない。

## Files

- 新規: `src/worker/routes/applications.ts`, `src/react-app/{api/applications.ts,pages/application-*.tsx}`
- テスト: `test/worker/routes/applications.test.ts`, `test/react-app/**/*.test.tsx`
