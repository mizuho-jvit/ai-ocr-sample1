---
id: "011"
title: "会員管理と状態履歴を実装"
status: pending
priority: 2
dependencies: ["002", "008"]
estimated_complexity: high
---

# Task: 会員管理と状態履歴を実装

## Goal

会員の検索・登録・編集・無効化・履歴・重複疑い一覧をテナント内で提供する。

## Interfaces

```ts
function createMember(input: CreateMemberRequest, actor: SessionActor): Promise<MemberDetail>; // 🔵
function changeMemberStatus(id: string, input: ChangeMemberStatusRequest, actor: SessionActor): Promise<MemberDetail>; // 🔵
```

## Test Strategy

- [ ] 氏名/カナ/生年月日/電話/状態と表記ゆれで検索する。
- [ ] テナント内連番を採番し、登録・編集で正規化値を再計算する。
- [ ] 物理削除せずinactiveと状態履歴を記録する。
- [ ] 未解決候補と申請/状態履歴を詳細に返す。

## Implementation Notes

- `MAX + 1`採番の同時実行性をD1トランザクションで検証する。

## Files

- 新規: `src/worker/routes/members.ts`, `src/react-app/{api/members.ts,pages/member-*.tsx}`
- テスト: `test/worker/routes/members.test.ts`
