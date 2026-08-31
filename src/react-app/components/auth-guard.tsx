import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import type { SessionResponse } from "../../worker/types/contracts";
import {
  type AuthApi,
  AuthApiError,
  authApi,
  toErrorMessage,
} from "../api/auth";
import { LoginPage } from "../pages/login-page";

export interface AuthContextValue {
  logout: () => Promise<void>;
  session: SessionResponse;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** 🟡 Intent: 認証済コンテキストの外で使われたことを黙って無視せず、開発時に落とす。 */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error("useAuth must be called inside AuthGuard.");
  }
  return value;
}

type GuardState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; session: SessionResponse }
  | { status: "failed"; message: string };

export interface AuthGuardProps {
  api?: AuthApi;
  children: ReactNode;
}

/**
 * 🔵 Intent: 起動時に `GET /api/auth/session` を引き、未認証ならログイン画面を出す。
 * UNAUTHENTICATED 以外の失敗はログイン画面に落とさない。落とすと、バックエンド障害が
 * 「ログインしても戻される」無限ループに化けて原因が読めなくなる。
 */
export function AuthGuard({ api = authApi, children }: AuthGuardProps) {
  const [state, setState] = useState<GuardState>({ status: "loading" });
  // `api` はテスト差し替え用。refで固定しないと、呼び出し側がJSX上で
  // オブジェクトリテラルを渡した瞬間にコールバックの同一性が毎レンダー変わり、
  // 「session取得 → 再レンダー → 再取得」の無限ループになる。
  const apiRef = useRef(api);
  apiRef.current = api;

  const loadSession = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({
        session: await apiRef.current.session(),
        status: "authenticated",
      });
    } catch (error) {
      if (error instanceof AuthApiError && error.code === "UNAUTHENTICATED") {
        setState({ status: "unauthenticated" });
        return;
      }
      setState({ message: toErrorMessage(error), status: "failed" });
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // 🔵 Intent: 失敗時は未認証へ遷移させず、例外を呼び出し側へ渡す。
  // 通信障害や500ではサーバー側のセッションが残っている可能性があり、
  // 画面だけログアウト済みにすると「ログアウトしたつもりで有効なまま」になる。
  const logout = useCallback(async () => {
    await apiRef.current.logout();
    setState({ status: "unauthenticated" });
  }, []);

  if (state.status === "loading") {
    return (
      <div className="goth login-page">
        <div className="login-container">
          <p className="status-message" role="status">
            読み込み中です。
          </p>
        </div>
      </div>
    );
  }

  if (state.status === "failed") {
    return (
      <div className="goth login-page">
        <div className="login-container">
          <header className="login-header">
            <h1 className="serif app-title">AI-OCR 帳票読取・一次審査</h1>
          </header>
          <div className="card" style={{ padding: 24 }}>
            <p className="alert" role="alert" style={{ marginBottom: 14 }}>
              {state.message}
            </p>
            <button
              className="btn btn-primary"
              id="session-retry-button"
              onClick={() => void loadSession()}
              style={{ width: "100%" }}
              type="button"
            >
              再試行
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === "unauthenticated") {
    return <LoginPage api={api} onAuthenticated={() => void loadSession()} />;
  }

  return (
    <AuthContext.Provider value={{ logout, session: state.session }}>
      {children}
    </AuthContext.Provider>
  );
}
