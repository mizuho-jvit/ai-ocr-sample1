---
id: "012"
title: "スタッフ管理を実装"
status: pending
priority: 3
dependencies: ["003"]
estimated_complexity: medium
---

# Task: スタッフ管理を実装

## Goal

adminだけが職員を登録・編集・無効化できるAPIと画面を提供する。

## Interfaces

```ts
type CreateStaffRequest = { name: string; email: string; password: string; role: Role }; // 🔵
```

## Test Strategy

- [ ] adminは作成・更新・無効化できる。
- [ ] staffは全スタッフAPIで403となる。
- [ ] 無効化職員は以後ログインできない。

## Implementation Notes

- passwordは認証サービスのPBKDF2関数を再利用し、削除APIを設けない。

## Files

- 新規: `src/worker/routes/staff.ts`, `src/react-app/{api/staff.ts,pages/staff-page.tsx}`
- テスト: `test/worker/routes/staff.test.ts`
