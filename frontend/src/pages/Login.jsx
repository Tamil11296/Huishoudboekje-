import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Home } from "lucide-react";
import api from "@/lib/api";
import { apiErr } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { t, user, setUser, loadHouseholds } = useApp();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) navigate("/");
  }, [user, navigate]);

  const googleLogin = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const payload = mode === "login"
        ? { email: form.email, password: form.password }
        : form;
      const { data } = await api.post(path, payload);
      setUser(data);
      await loadHouseholds();
      navigate("/");
    } catch (err) {
      toast.error(apiErr(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-slate-50 dark:bg-slate-950">
      <div className="hidden lg:block relative overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1564703048291-bcf7f001d83d?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200"
          alt="verbouwing"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-slate-900/70" />
        <div className="relative z-10 h-full flex flex-col justify-between p-12 text-white">
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
      </div>

      <div className="flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-sm"
        >
          <h1 className="font-heading text-3xl font-extrabold tracking-tight">
            {mode === "login" ? t("login") : t("register")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("app_name")}</p>

          <Button
            onClick={googleLogin}
            variant="outline"
            className="w-full mt-6 gap-2 rounded-full"
            data-testid="google-login-btn"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" className="h-4 w-4" />
            {t("login_google")}
          </Button>

          <div className="flex items-center gap-3 my-5 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> {t("or")} <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && (
              <div className="space-y-1.5">
                <Label>{t("name")}</Label>
                <Input
                  data-testid="name-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t("email")}</Label>
              <Input
                type="email"
                data-testid="email-input"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("password")}</Label>
              <Input
                type="password"
                data-testid="password-input"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            <Button type="submit" className="w-full rounded-full" disabled={loading} data-testid="submit-auth-btn">
              {loading ? t("loading") : mode === "login" ? t("login") : t("register")}
            </Button>
          </form>

          <p className="text-sm text-center mt-5 text-muted-foreground">
            {mode === "login" ? t("no_account") : t("have_account")}{" "}
            <button
              className="font-semibold text-slate-900 dark:text-white underline"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
              data-testid="toggle-auth-mode"
            >
              {mode === "login" ? t("register") : t("login")}
            </button>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
