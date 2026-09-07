---
id: "012"
title: "スタッフ管理を実装"
status: done
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

- [x] adminは作成・更新・無効化できる。
- [x] staffは全スタッフAPIで403となる。
- [x] 無効化職員は以後ログインできない。

## Implementation Notes

- passwordは認証サービスのPBKDF2関数を再利用し、削除APIを設けない。
- 全ルートに`middleware/auth.ts`の`adminGuard()`をまとめて適用し(`routes.use("*", adminGuard())`)、ハンドラ側では検証とセッション解決だけを行う(routes/members.tsと同じ方針)。
- `staff_users_tenant_email_unique`はDBの一意制約だが、D1の制約違反を捕捉して422へ変換する処理は他ルートに前例が無いため、`create`側で事前に`findOne`で重複を検証してから`insert`する方式にした(実装時判断)。**コードレビュー指摘(P2)により、この事前検証だけでは並行登録時に一方が500になる欠陥を修正した(決定#46)。** `insert`をtry/catchし、`DrizzleQueryError.cause.message`の文字列判定で`staff_users_tenant_email_unique`違反を検出したら`422 VALIDATION_ERROR`へ変換する(事前SELECTは早期エラー表示用にそのまま残す)。
- 画面は`screen-list.md`が「スタッフ管理」の1画面のみを定めるため、一覧内のインライン行編集(会員一覧の登録トグルと同じ考え方)で登録・編集・無効化を完結させ、独立した登録・詳細画面は作らない。
- **コードレビュー指摘(P1)により、`StaffService.update`が最後の有効なadminを無効化・staffへ降格できてしまう欠陥を修正した(決定#44)。** 対象行がこの更新で「有効なadmin」でなくなる場合に限り、他に有効なadminが存在するかをDB側で検証する条件付きUPDATE(`atomic-writes.ts`の`updateStaffUserGuarded`)へ回し、存在しなければ`409 INVALID_TRANSITION`で拒否する。並行更新でも不変条件が保たれることをテストで確認済み。
- **コードレビュー指摘(P1)により、無効化した職員の`sessions`行を削除していなかったため再有効化すると古いCookieが復活する欠陥を修正した(決定#45)。** `updateStaffUserGuarded`へ`deleteSessions`オプションを追加し、`isActive`をtrue→falseへ変える更新に限り対象職員のセッションを同一トランザクションで全削除する。
- **コードレビュー指摘(P2)により、メール形式・パスワード強度をサーバー側で検証していなかった欠陥を修正した(決定#47)。** メールは空でないことのみ、パスワードは1文字以上であることのみしか検証しておらず要件にも基準が無かったため、実装時判断としてメールは簡易パターン(前後・埋め込み空白は自動的に拒否)かつ最大254文字、パスワードは最小12文字・最大50文字(ユーザー指定)を採用し、`POST`(メール・パスワード双方)・`PATCH`(パスワードのみ)の境界で検証する。保存する`passwordHash`はハッシュ・salt固定長のBase64であり元のパスワード長とは無関係なため、最大長を50文字にしてもDB格納値の長さには影響しない。

## Files

- 新規: `src/worker/{routes/staff.ts,services/staff-service.ts}`, `src/react-app/{api/staff.ts,pages/staff-page.tsx}`
- テスト: `test/worker/{routes/staff,services/staff-service}.test.ts`, `test/react-app/{api/staff,pages/staff-page}.test.tsx`
