---
id: "009"
title: "AI業務チェックとCheckRun保存を実装"
status: pending
priority: 1
dependencies: ["003", "005", "006", "008"]
estimated_complexity: high
---

# Task: AI業務チェックとCheckRun保存を実装

## Goal

申請の整合性・不備・トリアージ・差戻し案・AI名寄せ判定を実行し、履歴として保存する。

## Interfaces

```ts
async function runBusinessCheck(actor: SessionActor, applicationId: string): Promise<RunCheckResponse>; // 🔵
```

## Test Strategy

- [ ] approvedまたは回数上限では409を返しAIを呼ばない。
- [ ] receivedはunder_reviewへ遷移して履歴を残す。
- [ ] 候補5件だけをAIへ渡し、CheckRun/最新ID/MatchCandidateを保存する。
- [ ] 不備時のみ200字以内の下書きを返し、Gemini上限で429にする。

## Implementation Notes

- 状態遷移、Usage、CheckRun、候補更新は整合するトランザクション境界を設計する。

## Files

- 新規: `src/worker/{services/business-check.ts,routes/checks.ts}`
- テスト: `src/worker/{services/business-check,routes/checks}.test.ts`
