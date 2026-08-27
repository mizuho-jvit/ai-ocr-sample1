---
id: "017"
title: "R2署名URLの実装方針を確定"
status: done
priority: 1
dependencies: []
estimated_complexity: medium
---

# Task: R2署名URLの実装方針を確定

## Goal

NF-2-14の「原本画像は15分の署名付きURLだけで配信」を満たすための、WorkerからのURL発行方式と必要なSecretを正典へ確定する。

## Interfaces

```ts
interface SignedImageUrlIssuer {
  issue(imageKey: ImageKey, expiresInSeconds: 900): Promise<{ url: string; expiresAt: string }>;
} // 🔵 R2 S3互換APIのGET署名URLを都度発行
```

## Test Strategy

- [ ] 選定方式でURLが15分後に失効することを確認する。
- [ ] 認証情報をGit、D1、R2、ログ、応答へ含めないことを確認する。
- [ ] 他テナントprefixのオブジェクトには発行できないことを確認する。

## Implementation Notes

- Workerが認可・prefix検証後にR2 S3互換APIのGET署名URLを都度発行する方式を採用した。
- `R2_ACCOUNT_ID`は通常の環境変数、Access Key IDとSecret Access KeyはWorkers Secretとし、URL・資格情報を保存しない。
- Wikiの環境変数一覧、API、型、判断記録と後続タスクへ反映済み。

## Files

- 変更: `knowledge/wiki/{architecture/api.md,architecture/types.md,requirements/non-functional.md,requirements/decisions.md}`
- 変更: `docs/dev/plans/mvp-core/**`
- テスト: 選定後に007へ追加
