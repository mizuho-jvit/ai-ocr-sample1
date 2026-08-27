---
id: "004"
title: "SPA認証シェルとログイン画面を実装"
status: pending
priority: 2
dependencies: ["003"]
estimated_complexity: medium
---

# Task: SPA認証シェルとログイン画面を実装

## Goal

セッション確認、未認証時ログイン誘導、roleとfeatureの画面出し分けを行うSPAの土台を作る。

## Interfaces

```ts
interface AuthApi { session(): Promise<SessionResponse>; login(input: LoginRequest): Promise<LoginResponse>; logout(): Promise<void>; } // 🔵
```

## Test Strategy

- [ ] 起動時401でログイン画面へ遷移する。
- [ ] ログイン成功で認証済み画面へ遷移する。
- [ ] admin専用リンクをstaffに表示しない（API認可の代替にはしない）。

## Implementation Notes

- Worker実装はimportせず、`/api/auth/*`だけを呼ぶ。
- 画面一覧は`knowledge/wiki/screens/`に従う。

## Files

- 新規: `src/react-app/{api/auth.ts,components/auth-guard.tsx,pages/login-page.tsx}`
- 変更: `src/react-app/main.tsx`
- テスト: `src/react-app/**/*.test.tsx`
