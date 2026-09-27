import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AppProvider, useApp } from "@/context/AppContext";
import Login from "@/pages/Login";
import AcceptInvite from "@/pages/AcceptInvite";
import Onboarding from "@/pages/Onboarding";
import Dashboard from "@/pages/Dashboard";
import IncomeExpenses from "@/pages/IncomeExpenses";
import BouwdepotPage from "@/pages/BouwdepotPage";
import Goals from "@/pages/Goals";
import Settings from "@/pages/Settings";
import Header from "@/components/Header";

function Protected({ children }) {
  const { user } = useApp();
  const location = useLocation();
  if (user === undefined)
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Laden...
      </div>
    );
  if (user === null) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

function Shell({ children }) {
  const { currentHousehold, user, ready } = useApp();
  if (!ready)
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Laden...
      </div>
    );
  if (user && !currentHousehold) return <Navigate to="/onboarding" replace />;
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col antialiased">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex-1">
        {children}
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        Huishoudboekje · EUR
      </footer>
    </div>
  );
}

function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route
        path="/onboarding"
        element={
          <Protected>
            <Onboarding />
          </Protected>
        }
      />
      <Route
        path="/"
        element={
          <Protected>
            <Shell>
              <Dashboard />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/inkomsten"
        element={
          <Protected>
            <Shell>
              <IncomeExpenses />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/bouwdepot"
        element={
          <Protected>
            <Shell>
              <BouwdepotPage />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/doelen"
        element={
          <Protected>
            <Shell>
              <Goals />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/instellingen"
        element={
          <Protected>
            <Shell>
              <Settings />
            </Shell>
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <AppProvider>
        <BrowserRouter>
          <AppRouter />
          <Toaster position="top-right" richColors />
        </BrowserRouter>
      </AppProvider>
    </div>
  );
}

export default App;
