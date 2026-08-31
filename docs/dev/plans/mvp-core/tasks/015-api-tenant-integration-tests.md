---
id: "015"
title: "API統合とテナント分離テストを実装"
status: pending
priority: 1
dependencies: ["002", "003", "005", "007", "008", "009", "010", "011", "012", "013", "014"]
estimated_complexity: high
---

# Task: API統合とテナント分離テストを実装

## Goal

API一覧の全エンドポイントを検証対象へ登録し、他テナントの読取・更新・画像・CSV・名寄せを検出する。

## Interfaces

```ts
const API_ENDPOINT_REGISTRY: readonly EndpointDescriptor[]; // 🔵
function assertTenantIsolation(endpoint: EndpointDescriptor): Promise<void>; // 🔵
```

## Test Strategy

- [ ] API仕様の28エンドポイントとレジストリの差分で失敗する。
- [ ] tenant Aで全読取・集計・CSV・画像・名寄せがtenant Bを返さない。
- [ ] tenant BのID更新・削除は404または失敗し、データが変化しない。
- [ ] JOIN先とR2 prefixの漏れを検出する。

## Implementation Notes

- NF-5-15の単一Tenant起動検証は、2テナントの分離テスト時だけ明示的に無効化する。

## Files

- 新規: `test/worker/**/*.integration.test.ts`, `test/worker/api-endpoints.ts`
- 変更: `vitest.config.ts`
