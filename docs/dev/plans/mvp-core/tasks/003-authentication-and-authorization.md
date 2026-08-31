---
id: "003"
title: "アプリ内認証・セッション・ロール認可を実装"
status: done
priority: 1
dependencies: ["002"]
estimated_complexity: high
---

# Task: アプリ内認証・セッション・ロール認可を実装

## Goal

PBKDF2認証、D1セッション、ログインロック、API認可を実装し、Basic認証後も業務APIを保護する。

## Interfaces

```ts
interface AuthService { login(input: LoginRequest): Promise<LoginResponse>; logout(sessionId: string): Promise<void>; } // 🔵
function requireSession(context: Context): Promise<SessionActor>; // 🔵
function requireAdmin(actor: SessionActor): void; // 🔵
```

## Test Strategy

- [x] 正しい資格情報でSecure/HTTPOnly/SameSite=Lax CookieとD1セッションを作る。
- [x] 不正、無効、ロック中の全てで同じ401文言を返す。
- [x] 5連続失敗で15分ロックし、成功時はカウンタを戻して必要なら再ハッシュする。
- [x] 未認証は401、staffのadmin APIは403、logout後は401となる。
      admin専用APIの実体はTask 012。ここでは `requireAdmin` を付けたルートで403を検証している。

## Implementation Notes

- WebCryptoの自己記述PBKDF2形式を使い、JWT/localStorageを使わない。
- `api.md`のlogin/logout/session契約と既存Basic middlewareを維持する。

## Files

- 新規: `src/worker/{services/auth.ts,routes/auth.ts,middleware/auth.ts}`
- 変更: `src/worker/index.ts`
- テスト: `test/worker/{services/auth,routes/auth,middleware/auth}.test.ts`
