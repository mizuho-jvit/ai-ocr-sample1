---
id: "002"
title: "リポジトリ基盤とシードデータを実装"
status: done
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

- [x] 実D1でTenantごとの取得・更新・削除が他Tenantへ影響しないことを確認した。
- [x] Tenant不存在または2件以上で初期化を拒否することを確認した。
- [x] 固定IDのadmin/staffと「仙臺 一郎」を含む5会員を、TS関数とCLIの各経路で冪等に投入できることを確認した。
- [x] SQLシードとTSシードの値のドリフト、およびREADME記載パスワードとPBKDF2ハッシュの一致を自動テストした。

## Implementation Notes

- `UsageCounter`はグローバルなので通常のテナントrepositoryへ混ぜない。
- DBハンドルをrouteやserviceから直接exportしない。

## Files

- 新規: `src/worker/db/{client,repositories,seed}.ts`
- 変更: `package.json`, `README.md`
- テスト: `test/worker/db/**/*.test.ts`
