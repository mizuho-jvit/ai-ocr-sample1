---
id: "008"
title: "名寄せの正規化と候補抽出を実装"
status: pending
priority: 1
dependencies: ["001", "002"]
estimated_complexity: high
---

# Task: 名寄せの正規化と候補抽出を実装

## Goal

AIを使わない決定的な正規化とテナント内上位5件候補抽出を作る。

## Interfaces

```ts
function normalizeMemberInput(input: MemberIdentity): NormalizedMemberIdentity; // 🔵
function findMatchCandidates(scope: TenantScope, input: NormalizedMemberIdentity): Promise<RuleMatchCandidate[]>; // 🔵
```

## Test Strategy

- [ ] 仙臺/仙台、NFKC、かな、和暦、電話ハイフンを正規化する。
- [ ] 未登録文字と原文を変更しない。
- [ ] カナ+生年月日、電話、氏名+住所で採点し上位5件だけ返す。
- [ ] 他テナントとrejected済み候補を返さない。

## Implementation Notes

- 対応表はGit追跡JSON。ルール段階でAIを呼ばない。

## Files

- 新規: `src/worker/services/{member-normalizer,matching}.ts`, `src/worker/assets/variant-map.json`
- テスト: `test/worker/services/{member-normalizer,matching}.test.ts`
