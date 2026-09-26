import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "@/lib/api";
import { translations } from "@/lib/i18n";

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = checking
  const [households, setHouseholds] = useState([]);
  const [currentId, setCurrentId] = useState(localStorage.getItem("hh_id") || null);
  const [lang, setLang] = useState(localStorage.getItem("lang") || "nl");
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "light");
  const [ready, setReady] = useState(false); // true once auth + households resolved

  const t = useCallback((key) => translations[lang][key] || translations.nl[key] || key, [lang]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => localStorage.setItem("lang", lang), [lang]);

  const loadHouseholds = useCallback(async () => {
    const { data } = await api.get("/households");
    setHouseholds(data);
    setCurrentId((prev) => {
      if (prev && data.some((h) => h.household_id === prev)) return prev;
      return data[0]?.household_id || null;
    });
    return data;
  }, []);

  const checkAuth = useCallback(async () => {
    if (window.location.hash?.includes("session_id=")) {
      return; // AuthCallback will handle
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
      await loadHouseholds();
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, [loadHouseholds]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (currentId) localStorage.setItem("hh_id", currentId);
  }, [currentId]);

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    setUser(null);
    setHouseholds([]);
    setCurrentId(null);
    localStorage.removeItem("hh_id");
  };

  const currentHousehold = households.find((h) => h.household_id === currentId) || null;

  const value = {
    user, setUser, households, setHouseholds, loadHouseholds,
    currentId, setCurrentId, currentHousehold,
    lang, setLang, theme, setTheme, t, logout, checkAuth, ready,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
