import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Home } from "lucide-react";
import api from "@/lib/api";
import { apiErr } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";

export default function AcceptInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { t, user, loadHouseholds, setCurrentId } = useApp();
  const [invite, setInvite] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/invites/${token}`).then(({ data }) => setInvite(data)).catch(() => setInvite(false));
  }, [token]);

  const accept = async () => {
    if (!user) {
      localStorage.setItem("pending_invite", token);
      navigate("/login");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post(`/invites/${token}/accept`);
      await loadHouseholds();
      setCurrentId(data.household_id);
      toast.success("Uitnodiging geaccepteerd");
      navigate("/");
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
      <div className="w-full max-w-md bg-card rounded-2xl border border-border shadow-sm p-8 text-center">
        <span className="inline-grid place-items-center h-12 w-12 rounded-xl bg-slate-900 text-white mb-4">
          <Home className="h-6 w-6" />
        </span>
        <h1 className="font-heading text-2xl font-extrabold">{t("invite_title")}</h1>
        {invite === false && (
          <>
            <p className="mt-3 text-muted-foreground">Deze uitnodiging is al gebruikt of verlopen.</p>
            {user && (
              <Button className="w-full mt-6 rounded-full" onClick={() => navigate("/")}>Naar het dashboard</Button>
            )}
          </>
        )}
        {invite && (
          <>
            <p className="mt-3 text-muted-foreground">
              {t("invite_by")} <strong>{invite.invited_by}</strong>
            </p>
            <p className="mt-1 text-lg font-semibold">{invite.household_name}</p>
            <p className="mt-3 text-sm text-muted-foreground">
              Log in met het Google-account <strong>{invite.email}</strong>.
            </p>
            <Button
              className="w-full mt-6 rounded-full"
              onClick={accept}
              disabled={busy}
              data-testid="accept-invite-btn"
            >
              {user ? t("accept_invite") : t("login_to_accept")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
