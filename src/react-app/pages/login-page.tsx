import { type FormEvent, useState } from "react";

import { type AuthApi, toErrorMessage } from "../api/auth";

export interface LoginPageProps {
  api: Pick<AuthApi, "login">;
  onAuthenticated: () => void;
}

/**
 * 🔵 Intent: 画面一覧の定めどおりテナントコード欄を持たない（テナントは環境設定で固定）。
 * エラー文言はF-1-7でAPI側に統一されているため、画面では加工せずそのまま表示する。
 * 🟡 Intent: 見出し・配色は `knowledge/wiki/requirements/overview.md` のデザイン要件
 * （プロトタイプ ai-ocr-demo.jsx のカラーパレット踏襲）に合わせる。
 */
export function LoginPage({ api, onAuthenticated }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await api.login({ email, password });
      // 成功時はこのコンポーネントが差し替わるため、送信中フラグは戻さない。
      onAuthenticated();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
      setIsSubmitting(false);
    }
  }

  return (
    <div className="goth login-page">
      <div className="login-container">
        <header className="login-header">
          <h1 className="serif app-title">AI-OCR 帳票読取・一次審査</h1>
          <p className="login-subtitle">職員用ログイン</p>
        </header>
        <div className="card" style={{ padding: 24 }}>
          <h2 className="serif" style={{ margin: "0 0 16px", fontSize: 16 }}>
            ログイン
          </h2>
          {errorMessage !== null && (
            <p
              className="alert"
              id="login-error"
              role="alert"
              style={{ marginBottom: 14 }}
            >
              {errorMessage}
            </p>
          )}
          <form onSubmit={handleSubmit}>
            <div className="field-group">
              <label className="field-label" htmlFor="login-email">
                メールアドレス
              </label>
              <input
                autoComplete="email"
                className="field-input"
                id="login-email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="login-password">
                パスワード
              </label>
              <input
                autoComplete="current-password"
                className="field-input"
                id="login-password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </div>
            <button
              className="btn btn-primary"
              disabled={isSubmitting}
              id="login-submit"
              style={{ width: "100%" }}
              type="submit"
            >
              ログイン
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
