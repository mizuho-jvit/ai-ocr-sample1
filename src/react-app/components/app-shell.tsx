import { useState } from "react";

import type { Role, SessionResponse } from "../../worker/types/contracts";
import { toErrorMessage } from "../api/auth";
import { ocrApi } from "../api/ocr";
import { OcrPage } from "../pages/ocr-page";
import { useAuth } from "./auth-guard";

interface NavItem {
  adminOnly: boolean;
  id: string;
  label: string;
  requiresDataReset: boolean;
}

/** 画面一覧（`knowledge/wiki/screens/screen-list.md`）のうち、上位メニューに出す画面。 */
const NAV_ITEMS: readonly NavItem[] = [
  { adminOnly: false, id: "home", label: "ホーム", requiresDataReset: false },
  {
    adminOnly: false,
    id: "applications",
    label: "申請状況一覧",
    requiresDataReset: false,
  },
  {
    adminOnly: false,
    id: "members",
    label: "会員一覧・検索",
    requiresDataReset: false,
  },
  {
    adminOnly: false,
    id: "duplicates",
    label: "重複疑いリスト",
    requiresDataReset: false,
  },
  {
    adminOnly: true,
    id: "staff",
    label: "スタッフ管理",
    requiresDataReset: false,
  },
  {
    adminOnly: true,
    id: "data-reset",
    label: "デモデータ初期化",
    requiresDataReset: true,
  },
];

/**
 * 営業戦略に直結するため、機能追加・改修時も失わない注記。
 * 文面は正典（`knowledge/wiki/screens/screen-list.md` の「画面上に常時表示する注記」）と
 * 一字一句そろえる。言い換えるとテストが正典との差分を検出できなくなる。
 */
export const MANDATORY_NOTICES: readonly string[] = [
  "最終判断は必ず職員が行う",
  "AIが申請者へ直接連絡することはない",
  "AIの確信度は「目安」であり統計的な精度保証ではない",
];

export const LOGOUT_FAILED_MESSAGE = "ログアウトできませんでした。";

const ROLE_LABELS: Record<Role, string> = {
  admin: "管理者",
  staff: "担当者",
};

export interface AppNavProps {
  // `role` を単独のpropにするとJSX上のARIA属性と衝突するため、セッションごと渡す。
  session: SessionResponse;
}

/**
 * 🔵 Intent: roleとfeatureでメニューを出し分ける。これは表示上の配慮にすぎず、
 * API側のロール認可（F-1-11〜15）の代替にはしない。admin専用APIはWorkerで再検証する。
 */
export function AppNav({ session }: AppNavProps) {
  const items = NAV_ITEMS.filter(
    (item) =>
      (!item.adminOnly || session.user.role === "admin") &&
      (!item.requiresDataReset || session.features.dataReset),
  );

  return (
    <nav aria-label="メインメニュー" className="app-nav">
      {items.map((item) => (
        // 遷移先の画面は後続タスクで実装するため、まだ無効化しておく。
        <button
          className="app-nav-item"
          disabled
          id={`nav-${item.id}`}
          key={item.label}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

/**
 * 🟡 Intent: 認証済の共通枠。全画面で必要な注記とログアウトをここへ集約する。
 * 見出し・配色は `knowledge/wiki/requirements/overview.md` のデザイン要件
 * （プロトタイプ ai-ocr-demo.jsx のカラーパレット踏襲）に合わせる。
 */
export function AppShell() {
  const { logout, session } = useAuth();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // 成功時はこのコンポーネントが差し替わるため、送信中フラグは戻さない。
  async function handleLogout() {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    setLogoutError(null);
    try {
      await logout();
    } catch (error) {
      setLogoutError(toErrorMessage(error));
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="goth app-shell">
      <header className="app-header">
        <h1 className="serif app-title">AI-OCR 帳票読取・一次審査</h1>
        <div className="app-user">
          {session.user.name}（{ROLE_LABELS[session.user.role]}）
          <button
            className="btn btn-ghost btn-small"
            disabled={isLoggingOut}
            id="logout-button"
            onClick={() => void handleLogout()}
            style={{ marginLeft: 10 }}
            type="button"
          >
            ログアウト
          </button>
        </div>
      </header>
      {logoutError !== null && (
        <div className="alert" role="alert" style={{ marginBottom: 16 }}>
          <p style={{ margin: "0 0 6px" }}>{LOGOUT_FAILED_MESSAGE}</p>
          <p style={{ margin: "0 0 10px" }}>{logoutError}</p>
          <button
            className="btn btn-ghost btn-small"
            disabled={isLoggingOut}
            id="logout-retry-button"
            onClick={() => void handleLogout()}
            type="button"
          >
            再試行
          </button>
        </div>
      )}
      <AppNav session={session} />
      {/*
       * 🟡 Intent: ルーターは未導入のため、唯一実装済みの画面（帳票読取）を常時表示する。
       * 他のメニュー項目は後続タスクで画面が揃うまで disabled のまま。
       */}
      <main style={{ marginBottom: 24 }}>
        <OcrPage api={ocrApi} />
      </main>
      <footer className="app-footer">
        <ul>
          {MANDATORY_NOTICES.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      </footer>
    </div>
  );
}
