import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("React root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <main>
      <h1>AI-OCR 帳票読取・一次審査</h1>
      <p>アプリケーションを準備しています。</p>
    </main>
  </StrictMode>,
);
