import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Home } from "lucide-react";
import api from "@/lib/api";
import { apiErr } from "@/lib/format";
import { useApp } from "@/context/AppContext";

const GSI_SRC = "https://accounts.google.com/gsi/client";

function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let s = document.querySelector(`script[src="${GSI_SRC}"]`);
    if (!s) {
      s = document.createElement("script");
      s.src = GSI_SRC;
      s.async = true;
      document.head.appendChild(s);
    }
    s.addEventListener("load", () => resolve());
    s.addEventListener("error", () => reject(new Error("Google-login kon niet laden")));
  });
}

export default function Login() {
  const { t, user, setUser, loadHouseholds } = useApp();
  const navigate = useNavigate();
  const btnRef = useRef(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const afterLogin = () => {
    const pending = localStorage.getItem("pending_invite");
    if (pending) {
      localStorage.removeItem("pending_invite");
      navigate(`/invite/${pending}`, { replace: true });
    } else {
      navigate("/", { replace: true });
    }
  };

  useEffect(() => {
    if (user) afterLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ data: cfg }] = await Promise.all([api.get("/config"), loadGsi()]);
        if (cancelled) return;
        if (!cfg.google_client_id) {
          setError("Google-login is nog niet ingesteld (GOOGLE_CLIENT_ID ontbreekt).");
          return;
        }
        window.google.accounts.id.initialize({
          client_id: cfg.google_client_id,
          ux_mode: "popup",
          callback: async ({ credential }) => {
            setBusy(true);
            setError("");
            try {
              const { data } = await api.post("/auth/google", { credential });
              setUser(data);
              await loadHouseholds();
              afterLogin();
            } catch (e) {
              setError(apiErr(e));
              toast.error(apiErr(e));
            } finally {
              setBusy(false);
            }
          },
        });
        if (btnRef.current) {
          window.google.accounts.id.renderButton(btnRef.current, {
            theme: "outline", size: "large", shape: "pill", text: "signin_with",
            locale: "nl", width: 300,
          });
        }
      } catch (e) {
        if (!cancelled) setError(apiErr(e));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-slate-50 dark:bg-slate-950">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-slate-900 text-white">
        <div className="flex items-center gap-2 font-heading font-extrabold text-xl">
          <span className="grid place-items-center h-9 w-9 rounded-lg bg-white text-slate-900">
            <Home className="h-5 w-5" />
          </span>
          {t("app_name")}
        </div>
        <div>
          <h2 className="font-heading text-4xl font-extrabold leading-tight">{t("tagline")}</h2>
          <p className="mt-4 text-slate-300 max-w-md">
            Dashboard, verdeling per persoon en een compleet bouwdepot-overzicht — privé per huishouden.
          </p>
        </div>
        <div className="text-slate-400 text-sm">EUR · Nederlands & English</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-sm"
        >
          <h1 className="font-heading text-3xl font-extrabold tracking-tight">{t("login")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("app_name")}</p>

          <div className="mt-8 flex justify-center min-h-[44px]" ref={btnRef} data-testid="google-login-btn" />

          {busy && <p className="mt-4 text-sm text-center text-muted-foreground">{t("loading")}</p>}
          {error && (
            <p className="mt-4 text-sm text-center text-rose-600" role="alert" data-testid="login-error">{error}</p>
          )}

          <p className="text-xs text-center mt-8 text-muted-foreground">
            Alleen toegankelijk voor leden van het huishouden. Nieuw? Vraag de eigenaar om een uitnodiging.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
