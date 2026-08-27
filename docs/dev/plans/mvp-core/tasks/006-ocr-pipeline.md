---
id: "006"
title: "MVP 1.0のOCR PipelineとAI設定を実装"
status: pending
priority: 1
dependencies: ["001", "005"]
estimated_complexity: high
---

# Task: MVP 1.0のOCR PipelineとAI設定を実装

## Goal

Gemini単体のMVP 1.0 `extract` 契約とStructured Outputを実装し、MVP 1.1を追加できる拡張点を定義する。

## Interfaces

```ts
interface OcrPipeline { extract(image: PreparedImage): Promise<ExtractedApplication>; } // 🔵
interface BusinessCheckPipeline { run(input: CheckInput): Promise<CheckResult>; } // 🔵
```

## Test Strategy

- [ ] `gemini`を設定から選択し、未知のモードを起動時に拒否する。
- [ ] Gemini出力の必須項目、空欄、確信度範囲を検証する。
- [ ] payloadログ無効化ヘッダを付与し本文を記録しない。

## Implementation Notes

- プロバイダ固有コードをrouteへ置かない。MVP 1.1のDocument AI実装・設定検証は018へ分離する。

## Files

- 新規: `src/worker/services/{ocr-pipeline,gemini-client}.ts`
- テスト: `src/worker/services/*pipeline*.test.ts`
