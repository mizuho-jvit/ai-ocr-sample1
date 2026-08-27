---
id: "005"
title: "月次利用量制御を実装"
status: pending
priority: 1
dependencies: ["001", "002"]
estimated_complexity: high
---

# Task: 月次利用量制御を実装

## Goal

OCR/Gemini/再実施の上限をJST月次でfail closedに制御し、残量を取得できるようにする。

## Interfaces

```ts
interface UsageService { consumeOcr(): Promise<UsageResponse>; consumeGemini(): Promise<UsageResponse>; getUsage(): Promise<UsageResponse>; } // 🔵
```

## Test Strategy

- [ ] JST月替わりは0扱いで当月キーへ更新する。
- [ ] 条件付きUPDATEの影響0を429相当の上限到達として扱う。
- [ ] AI呼び出し前に加算し、上限引下げ後もfail closedにする。
- [ ] resetでUsageCounterを変更しない。

## Implementation Notes

- 読み取り→判定→更新の3段階実装を禁止する。

## Files

- 新規: `src/worker/{services/usage.ts,routes/usage.ts}`
- テスト: `src/worker/services/usage.test.ts`
