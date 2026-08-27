---
id: "001"
title: "共有契約・設定・テナント境界を実装"
status: pending
priority: 1
dependencies: []
estimated_complexity: high
---

# Task: 共有契約・設定・テナント境界を実装

## Goal

全APIが同じDTO、エラー、設定検証、テナント供給源を利用できる基盤を作る。

## Interfaces

```ts
type Role = "admin" | "staff"; // 🔵
type ErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_ERROR" | "INTERNAL"; // 🔵
function loadConfig(env: WorkerEnv): AppConfig; // 🔵
function currentTenantId(config: AppConfig): string; // 🔵
```

## Test Strategy

- [ ] 必須設定、未知のPipelineモード、0以下の上限値で起動を拒否する。
- [ ] `TENANT_ID`はリクエスト値ではなく唯一の設定供給源から得る。
- [ ] 共通エラーが秘密値を含まない。

## Implementation Notes

- 正典: `knowledge/wiki/architecture/types.md`、`requirements/non-functional.md`、`tenant-isolation.md`。
- `R2_ACCOUNT_ID` と、Workers Secretの `R2_S3_ACCESS_KEY_ID` / `R2_S3_SECRET_ACCESS_KEY` を起動時に検証する。

## Files

- 新規: `src/worker/{types,config,db}/**`
- 変更: `src/worker/index.ts`, `worker-configuration.d.ts`, `.env.example`
- テスト: `src/worker/{config,db}/*.test.ts`
