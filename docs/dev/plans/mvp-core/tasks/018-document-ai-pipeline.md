---
id: "018"
title: "MVP 1.1のDocument AI Pipelineを追加"
status: pending
priority: 3
dependencies: ["006", "007", "016"]
estimated_complexity: high
---

# Task: MVP 1.1のDocument AI Pipelineを追加

## Goal

MVP 1.0の画面・API・保存形式を変えず、Document AI Enterprise OCRを前段に加えたMVP 1.1を実装・回帰検証する。

## Interfaces

```ts
class DocumentAiGeminiPipeline implements OcrPipeline { // 🔵
  extract(image: PreparedImage): Promise<ExtractedApplication>;
}
```

## Test Strategy

- [ ] `document-ai-gemini`で必須のGoogle設定・Secret不足を起動時に拒否する。
- [ ] OCR文字・必要なレイアウト参照と元画像だけをGeminiへ渡し、生レスポンスを保存しない。
- [ ] Document AI障害はGemini単体へフォールバックせず、再試行可能な503にする。
- [ ] MVP 1.0と同じ`POST /api/ocr/extract` DTO・画面・Application保存形式で回帰する。
- [ ] Document AIのページ数・請求アラートと20秒性能目標をremote環境で検証する。

## Implementation Notes

- 同期`process`のみを使う。バッチ、Custom Extractor、Form Parser、OCRアドオンは対象外。
- 専用サービスアカウントには`roles/documentai.apiUser`だけを付与し、OAuthトークンはメモリだけで扱う。

## Files

- 新規: `src/worker/services/document-ai-client.ts`
- 変更: `src/worker/{config,services/ocr-pipeline}.ts`, `README.md`
- テスト: `test/worker/services/document-ai-pipeline.test.ts`
