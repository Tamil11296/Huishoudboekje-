import React, { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { toast } from "sonner";
import { motion } from "framer-motion";
import api from "@/lib/api";
import { apiErr } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export default function Onboarding() {
  const { t, loadHouseholds, setCurrentId, logout, ready, currentHousehold } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [split, setSplit] = useState("5050");
  const [busy, setBusy] = useState(false);

  if (!ready)
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Laden...
      </div>
    );
  if (currentHousehold) return <Navigate to="/" replace />;

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/households", { name, split_rule: split });
      await loadHouseholds();
      setCurrentId(data.household_id);
      toast.success(`${data.name} aangemaakt`);
      navigate("/");
    } catch (err) {
      toast.error(apiErr(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-card rounded-2xl border border-border shadow-sm p-8"
      >
        <h1 className="font-heading text-2xl font-extrabold">{t("onboarding_title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("onboarding_sub")}</p>
        <form onSubmit={create} className="space-y-4 mt-6">
          <div className="space-y-1.5">
            <Label>{t("household_name")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bijv. Huize Jansen"
              required
              data-testid="household-name-input"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("split_rule")}</Label>
            <Select value={split} onValueChange={setSplit}>
              <SelectTrigger data-testid="split-rule-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5050">{t("split_5050")}</SelectItem>
                <SelectItem value="income">{t("split_income")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" className="w-full rounded-full" disabled={busy} data-testid="create-household-btn">
            {busy ? t("loading") : t("create_household")}
          </Button>
        </form>
        <button
          className="text-xs text-muted-foreground underline mt-4 mx-auto block"
          onClick={async () => { await logout(); navigate("/login"); }}
        >
          {t("logout")}
        </button>
      </motion.div>
    </div>
  );
}
