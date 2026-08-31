---
id: "004"
title: "SPA認証シェルとログイン画面を実装"
status: done
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

- [x] 起動時401でログイン画面へ遷移する。
- [x] ログイン成功で認証済み画面へ遷移する。
- [x] admin専用リンクをstaffに表示しない（API認可の代替にはしない）。

## Implementation Notes

- Worker実装はimportせず、`/api/auth/*`だけを呼ぶ。型は `src/worker/types/contracts.ts` から `import type` で共有する（実行時コードは持ち込まない）。
- 画面一覧は`knowledge/wiki/screens/`に従う。
- **401は3種類ある。** Basic認証のチャレンジ（`WWW-Authenticate: Basic`・非JSON）、セッション切れ（`UNAUTHENTICATED`）、資格情報の誤り（`INVALID_CREDENTIALS`）。ログイン画面へ誘導する条件はステータスではなく `code === "UNAUTHENTICATED"` で判定する。
- **`UNAUTHENTICATED` 以外の失敗をログイン画面に落とさない。** 落とすとバックエンド障害が「ログインしても戻される」ループに化ける。再試行できるエラー表示にする。
- **セッションはHTTPOnly Cookieのため、JS側に認証状態を保存できない。** 唯一の情報源は `GET /api/auth/session` の結果。localStorage / sessionStorage は使わない。
- ログイン応答は `user` のみを返し `features` を含まないため、ログイン成功後に `session()` を引き直す。

## Files

- 新規: `src/react-app/{api/auth.ts,components/auth-guard.tsx,components/app-shell.tsx,pages/login-page.tsx,styles/theme.css}`
- 変更: `src/react-app/main.tsx`、`tsconfig.app.json`（`types: ["vite/client"]`）
- テスト: `test/react-app/{api/auth.test.ts,components/auth-guard.test.tsx,components/app-shell.test.tsx,pages/login-page.test.tsx}`
- テスト基盤: `vitest.config.ts`（`test.projects` で worker / react-app を分割）、`test/react-app/test-setup.ts`、`package.json`（`happy-dom` / `@testing-library/react` を追加）

## 実績メモ

- `AppNav` は `role` を単独のpropにするとBiomeの `useValidAriaRole` がJSXのARIA属性と誤認するため、`session` ごと受け取る形にした。
- `AuthGuard` の `api` prop（テスト差し替え用）は `useRef` で固定した。固定しないと、呼び出し側がJSXでオブジェクトリテラルを渡した瞬間に再取得ループになる。
- 各画面の遷移先は後続タスクのため、メニュー項目は `disabled` のボタンとして描画している。ルーターは未導入。
- **ログアウトは成功時だけ未認証へ遷移する。** 失敗時は認証済みのまま「ログアウトできませんでした。」と再試行を表示する。サーバー側セッションが残っている可能性があるため、画面だけログアウト済みにしない。
- 常時表示注記は `knowledge/wiki/screens/screen-list.md?raw` を突き合わせるテストで正典との一致を担保している（定数だけを見る照合は循環して乖離を検出できない）。この `?raw` の型宣言のため `tsconfig.app.json` の include に `src/worker/types/raw-imports.d.ts` を追加した。
- 見た目は[デザイン要件](../../../../../knowledge/wiki/requirements/overview.md#デザイン要件)に合わせ `src/react-app/styles/theme.css` を追加した。`role`/ラベルテキストは変えていないため既存テストは無改修で通る。`*.css` の副作用importに `noUncheckedSideEffectImports` が型宣言を要求するため `tsconfig.app.json` に `types: ["vite/client"]` を追加した。
- 入力欄・ボタンには自動採番でなく固定の `id`（`login-email` `login-submit` `logout-button` `nav-home` 等）を付与した。E2E（Task 016）からの参照を安定させるため。
