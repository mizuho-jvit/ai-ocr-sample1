---
id: "002"
title: "リポジトリ基盤とシードデータを実装"
status: pending
priority: 1
dependencies: ["001"]
estimated_complexity: high
---

# Task: リポジトリ基盤とシードデータを実装

## Goal

テナントスコープ済みのD1アクセスと、固定IDのTenant・職員2件・会員5件を再現可能に投入する。

## Interfaces

```ts
interface TenantRepository { forTenant(tenantId: string): TenantScopedRepositories; } // 🔵
async function seedDemoData(db: D1Database, config: AppConfig): Promise<void>; // 🔵
```

## Test Strategy

- [ ] Tenantごとにスコープした取得・更新・削除へ条件が常に付く。
- [ ] Tenant不存在または本番想定で2件以上なら起動を拒否する。
- [ ] 固定IDのadmin/staffと「仙臺 一郎」を含む5会員を冪等に投入する。

## Implementation Notes

- `UsageCounter`はグローバルなので通常のテナントrepositoryへ混ぜない。
- DBハンドルをrouteやserviceから直接exportしない。

## Files

- 新規: `src/worker/db/{client,repositories,seed}.ts`
- 変更: `package.json`, `README.md`
- テスト: `src/worker/db/**/*.test.ts`
