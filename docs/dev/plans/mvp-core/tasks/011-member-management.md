---
id: "011"
title: "会員管理と状態履歴を実装"
status: done
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

- [x] 氏名/カナ/生年月日/電話/状態と表記ゆれで検索する。
- [x] テナント内連番を採番し、登録・編集で正規化値を再計算する。
- [x] 物理削除せずinactiveと状態履歴を記録する。
- [x] 未解決候補と申請/状態履歴を詳細に返す。

## Implementation Notes

- `MAX + 1`採番の同時実行性をD1トランザクションで検証する。
  → `src/worker/db/atomic-writes.ts`の`insertMemberWithNextNumber`(`INSERT`のカラム値へサブクエリを埋め込む単一SQL文)で実現。3件を並行作成して番号が重複しないことを確認するテスト(`member-service-write.test.ts`)を追加し、実装を一時的に「読み取ってから書く」ナイーブ版へ戻すミューテーションテストで、意図どおり`UNIQUE(tenantId, memberNumber)`違反として検出されることを確認した。

## Files

- 新規: `src/worker/routes/members.ts`, `src/worker/services/{member-service,member-view}.ts`, `src/worker/db/atomic-writes.ts`, `src/react-app/{api/members.ts,pages/member-list-page.tsx,pages/member-detail-page.tsx,pages/member-duplicates-page.tsx}`
- テスト: `test/worker/routes/members-{query,mutation}.test.ts`, `test/worker/services/member-service-{read,write}.test.ts`, `test/react-app/{api/members,pages/member-list-page,pages/member-detail-page,pages/member-duplicates-page}.test.tsx`
