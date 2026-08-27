---
id: "007"
title: "OCR受付・原本画像管理・読取画面を実装"
status: pending
priority: 2
dependencies: ["003", "004", "006", "017"]
estimated_complexity: high
---

# Task: OCR受付・原本画像管理・読取画面を実装

## Goal

1枚の前処理済み画像を読取り、R2とApplicationへ原子的に近い順序で保存して進捗付きで表示する。

## Interfaces

```ts
type OcrExtractRequest = { image: { base64: string; mimeType: "image/jpeg" } }; // 🔵
function createPresignedImageUrl(key: string, expiresInSeconds: 900): Promise<string>; // 🔵 R2 S3互換GET署名
```

## Test Strategy

- [ ] 未対応/複数枚入力では未完成Applicationを残さない。
- [ ] 上限内の成功時に`received` Applicationと`{tenantId}/{applicationId}` R2キーを作る。
- [ ] 確定した方式で署名URLは15分で、他テナントprefixには発行しない。
- [ ] R2の30日ライフサイクル設定と個別画像削除を検証する。
- [ ] UIが1568px/85%へ縮小し、進捗・429・503を表示する。

## Implementation Notes

- APIは`POST /api/ocr/extract`。画像再表示時は`GET /api/images/:applicationId`で都度新しい署名URLを得る。

## Files

- 新規: `src/worker/{routes/ocr.ts,services/image-storage.ts}`, `src/react-app/{api/ocr.ts,pages/ocr-page.tsx}`
- テスト: `src/worker/routes/ocr.test.ts`, `src/react-app/**/*.test.tsx`
