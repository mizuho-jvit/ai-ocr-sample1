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

- [x] 未対応/複数枚入力では未完成Applicationを残さない。
- [x] 上限内の成功時に`received` Applicationと`{tenantId}/{applicationId}` R2キーを作る。
- [x] 確定した方式で署名URLは15分で、他テナントprefixには発行しない。
- [ ] R2の30日ライフサイクル設定と個別画像削除を検証する。（**個別画像削除は実装・テスト済み。30日ライフサイクル設定はCloudflare側の手動設定が未実施**）
- [x] UIが1568px/85%へ縮小し、進捗・429・503を表示する。

## Implementation Notes

- APIは`POST /api/ocr/extract`。画像再表示時は`GET /api/images/:applicationId`で都度新しい署名URLを得る。
- **コード側は実装・テスト済みだが、R2の30日ライフサイクル削除(NF-3-1)はCloudflare側の手動設定(ダッシュボードまたは`wrangler r2 bucket lifecycle-rule add`)が未実施のため`status`を`done`にしていない。** 設定・確認後にdoneへ変更すること。詳細は`knowledge/wiki/log.md`のTask 007の項を参照。

## Files

- 新規: `src/worker/{routes/ocr.ts,services/image-storage.ts}`, `src/react-app/{api/ocr.ts,pages/ocr-page.tsx}`
- テスト: `test/worker/routes/{ocr-extract.test.ts,ocr-images.test.ts}`（500行ルールにより分割）, `test/worker/services/image-storage.test.ts`, `test/react-app/{api/ocr.test.ts,pages/ocr-page.test.tsx}`
