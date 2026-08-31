import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppShell } from "./components/app-shell";
import { AuthGuard } from "./components/auth-guard";
import "./styles/theme.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("React root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <AuthGuard>
      <AppShell />
    </AuthGuard>
  </StrictMode>,
);
