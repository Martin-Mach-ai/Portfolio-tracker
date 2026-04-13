import { BrowserRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { DashboardPage } from "./pages/dashboard-page";
import { AssetsPage } from "./pages/assets-page";
import { ImportPage } from "./pages/import-page";
import { TransactionsPage } from "./pages/transactions-page";
import { ToastProvider } from "./components/toast";
import { getHealth } from "./lib/api";
import { t } from "./lib/i18n";

function AppShell() {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    staleTime: 30_000,
  });

  let healthLabel: string = t.app.apiChecking;

  if (healthQuery.isError) {
    healthLabel = t.app.apiUnavailable;
  } else if (healthQuery.data) {
    healthLabel = healthQuery.data.status === "ok" ? t.app.apiOnline : t.app.apiUnknown;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__eyebrow">{t.app.brand}</span>
          <h1>{t.app.tagline}</h1>
        </div>
        <div
          className={`status-pill ${healthQuery.isError ? "status-pill--error" : "status-pill--ok"}`}
        >
          {healthLabel}
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <nav className="nav">
            <NavLink
              to="/dashboard"
              className={({ isActive }) => `nav__link ${isActive ? "nav__link--active" : ""}`}
            >
              {t.app.navDashboard}
            </NavLink>
            <NavLink
              to="/assets"
              className={({ isActive }) => `nav__link ${isActive ? "nav__link--active" : ""}`}
            >
              {t.app.navAssets}
            </NavLink>
            <NavLink
              to="/transactions"
              className={({ isActive }) => `nav__link ${isActive ? "nav__link--active" : ""}`}
            >
              {t.app.navTransactions}
            </NavLink>
            <NavLink
              to="/import"
              className={({ isActive }) => `nav__link ${isActive ? "nav__link--active" : ""}`}
            >
              {t.app.navImport}
            </NavLink>
          </nav>
          <p className="sidebar__hint">{t.app.sidebarHint}</p>
        </aside>

        <main className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/assets" element={<AssetsPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/import" element={<ImportPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AppShell />
      </BrowserRouter>
    </ToastProvider>
  );
}
