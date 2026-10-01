import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Home } from "lucide-react";
import api from "@/lib/api";
import { apiErr } from "@/lib/format";
import { useApp } from "@/context/AppContext";

export default function Login() {
  const { t, user, setUser, loadHouseholds } = useApp();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);

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

  const signIn = async (credential) => {
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
  };

  useEffect(() => {
    api.get("/config").then(({ data }) => setDemo(!!data.demo)).catch(() => {});
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

          {demo ? (
            <div className="mt-8 space-y-3" data-testid="demo-login">
              <p className="text-sm rounded-lg bg-amber-50 text-amber-900 border border-amber-200 p-3">
                Demomodus: gegevens staan alleen in het geheugen en verdwijnen bij herstarten.
              </p>
              <button type="button" onClick={() => signIn("robeson@demo.nl")} disabled={busy}
                      className="w-full h-11 rounded-full bg-slate-900 text-white font-semibold">
                Inloggen als Robeson (eigenaar)
              </button>
              <button type="button" onClick={() => signIn("miraja@demo.nl")} disabled={busy}
                      className="w-full h-11 rounded-full border border-slate-300 font-semibold">
                Inloggen als Miraja (partner)
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => signIn()} disabled={busy} data-testid="google-login-btn"
                    className="mt-8 w-full h-12 rounded-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-center gap-3 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60">
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              Inloggen met Google
            </button>
          )}

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
