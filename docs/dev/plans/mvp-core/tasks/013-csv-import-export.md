---
id: "013"
title: "CSV入出力を実装"
status: pending
priority: 3
dependencies: ["003", "010", "011"]
estimated_complexity: high
---

# Task: CSV入出力を実装

## Goal

申請台帳のBOM付きワイドCSVと、会員名簿のUTF-8/Shift_JISインポート・同形式エクスポートを提供する。

## Interfaces

```ts
function exportApplications(repositories: TenantScopedRepositories): Promise<Response>; // 🔵
function importMembers(file: File, actor: SessionActor): Promise<ImportMembersResponse>; // 🔵
```

## Test Strategy

- [ ] 台帳CSVがBOM、AI判定・理由・処理者・原ラベル列を含む。
- [ ] UTF-8/Shift_JISの500行以内を新規だけ登録する。
- [ ] 重複と不正行をスキップし件数・エラー内容を返す。
- [ ] 501行で413、会員エクスポートはインポート形式と一致する。

## Implementation Notes

- CSV・集計もテナントスコープを必須にする。
- `exportApplications`は`TenantScopedRepositories`（DI・`context.get("repository").forTenant()`）をそのまま受け取る。Task 008の`matching.ts`が定義する`TenantScope`（`applicationId`必須）はF-6-10の「対象申請に対するrejected除外」専用の型であり、`exportApplications`は`findMatchCandidates`を呼ばず対象申請という概念も無いため、この型を再利用しないこと（[決定#24](../../../../../knowledge/wiki/requirements/decisions.md)）。

## Files

- 新規: `src/worker/{services/csv.ts,routes/csv.ts}`
- 変更: `src/worker/routes/{applications,members}.ts`
- テスト: `test/worker/services/csv.test.ts`
