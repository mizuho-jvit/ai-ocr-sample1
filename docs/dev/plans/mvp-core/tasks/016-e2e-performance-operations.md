---
id: "016"
title: "E2E・性能検証・運用手順を整備"
status: pending
priority: 2
dependencies: ["004", "007", "010", "012", "013", "014", "015"]
estimated_complexity: high
---

# Task: E2E・性能検証・運用手順を整備

## Goal

商談で使う一連の動線、性能目標、シード・デプロイ・リセット手順を検証可能な状態で完成させる。

## Interfaces

```ts
type DemoScenario = "login" | "ocr-to-approval" | "reset"; // 🔵
```

## Test Strategy

- [ ] login→OCR→チェック→名寄せ→承認→CSVの主要動線をE2Eで実行する。
- [ ] staff/adminの画面・API制約とリセット確認画面を確認する。
- [ ] remote環境でMVP 1.0のOCR/チェック/PBKDF2の性能目標を実測する。
- [ ] 1コマンド構築、Secret設定、AI Gateway設定、R2 30日保持、商談前後リセット手順をREADMEへ記載する。

## Implementation Notes

- 実在個人情報を使わない合成フィクスチャだけを使用する。

## Files

- 新規: `test/e2e/**`, `docs/dev/plans/mvp-core/reports/**`
- 変更: `README.md`, `.env.example`, `.github/workflows/ci.yml`
