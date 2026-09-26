import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useApp } from "@/context/AppContext";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { setUser, loadHouseholds } = useApp();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const hash = window.location.hash;
    const sessionId = new URLSearchParams(hash.replace(/^#/, "")).get("session_id");
    const run = async () => {
      try {
        const { data } = await api.post("/auth/session", { session_id: sessionId });
        setUser(data);
        window.history.replaceState(null, "", "/");
        await loadHouseholds();
        navigate("/", { replace: true });
      } catch {
        navigate("/login", { replace: true });
      }
    };
    if (sessionId) run();
    else navigate("/login", { replace: true });
  }, [navigate, setUser, loadHouseholds]);

  return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      Bezig met inloggen...
    </div>
  );
}
