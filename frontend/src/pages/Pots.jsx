import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Wand2, Coins } from "lucide-react";
import api from "@/lib/api";
import { eur, apiErr } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

export default function Pots() {
  const { t, currentId, currentHousehold } = useApp();
  const [summary, setSummary] = useState(null);
  const [dialog, setDialog] = useState(null);
  const cats = currentHousehold?.categories?.expense || [];

  const load = useCallback(async () => {
    if (!currentId) return;
    const { data } = await api.get(`/households/${currentId}/pots-summary`);
    setSummary(data);
  }, [currentId]);
  useEffect(() => { load(); }, [load]);

  const save = async (vals) => {
    try {
      if (dialog?.initial) await api.put(`/households/${currentId}/pots/${dialog.initial.pot_id}`, vals);
      else await api.post(`/households/${currentId}/pots`, vals);
      toast.success(t("save"));
      setDialog(null);
      load();
    } catch (e) { toast.error(apiErr(e)); }
  };
  const del = async (id) => { await api.delete(`/households/${currentId}/pots/${id}`); load(); };
  const autoDistribute = async () => {
    const pots = summary.pots;
    if (!pots.length) return;
    const each = Math.round(summary.avg_monthly_over / pots.length);
    await Promise.all(pots.map((p) => api.put(`/households/${currentId}/pots/${p.pot_id}`, { monthly_amount: each })));
    toast.success(t("auto_distribute"));
    load();
  };

  if (!summary) return <div className="text-muted-foreground">{t("loading")}</div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight">{t("nav_pots")}</h1>
          <p className="text-muted-foreground mt-1">
            {t("free_surplus")}: <span className={`font-num font-semibold ${summary.free_surplus >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{eur(summary.free_surplus)}</span> / {t("month").toLowerCase()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-1 rounded-full" onClick={autoDistribute} data-testid="auto-distribute-btn"><Wand2 className="h-4 w-4" /> {t("auto_distribute")}</Button>
          <Button className="gap-1 rounded-full" onClick={() => setDialog({})} data-testid="add-pot-btn"><Plus className="h-4 w-4" /> {t("add_pot")}</Button>
        </div>
      </div>

      {!summary.pots.length && <Card className="p-10 text-center text-muted-foreground">{t("none_yet")}</Card>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {summary.pots.map((p) => {
          const usage = p.allocated > 0 ? Math.min((p.spent / p.allocated) * 100, 100) : 0;
          return (
            <motion.div key={p.pot_id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="p-6 space-y-4" data-testid={`pot-card-${p.pot_id}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-9 w-9 grid place-items-center rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900"><Coins className="h-4 w-4" /></span>
                    <div>
                      <h2 className="font-heading font-bold">{p.name}</h2>
                      <p className="text-xs text-muted-foreground">{eur(p.monthly_amount)}/mnd</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDialog({ initial: p })}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => del(p.pot_id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <div className="text-center py-2">
                  <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">{t("pot_balance")}</div>
                  <div className={`font-num font-bold text-3xl mt-1 ${p.balance >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{eur(p.balance)}</div>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>{t("pot_spent")}: {eur(p.spent)}</span>
                    <span>{t("allocated")}: {eur(p.allocated)}</span>
                  </div>
                  <Progress value={usage} className="h-2" />
                </div>
                <div className="flex flex-wrap gap-1">
                  {(p.categories || []).map((c) => <Badge key={c} variant="secondary">{c}</Badge>)}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {dialog && <PotDialog open onClose={() => setDialog(null)} initial={dialog.initial} cats={cats} onSubmit={save} />}
    </div>
  );
}

function PotDialog({ open, onClose, initial, cats, onSubmit }) {
  const { t } = useApp();
  const [name, setName] = useState(initial?.name || "");
  const [amount, setAmount] = useState(initial?.monthly_amount || "");
  const [sel, setSel] = useState(initial?.categories || []);
  const [busy, setBusy] = useState(false);
  const toggle = (c) => setSel((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await onSubmit({ name, monthly_amount: amount, categories: sel }); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-popover" data-testid="dialog-pot">
        <DialogHeader><DialogTitle className="font-heading">{t("add_pot")}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5"><Label>{t("pot_name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} required data-testid="field-pot-name" /></div>
          <div className="space-y-1.5"><Label>{t("monthly_amount")}</Label><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required data-testid="field-pot-amount" /></div>
          <div className="space-y-1.5">
            <Label>{t("linked_categories")}</Label>
            <div className="flex flex-wrap gap-2">
              {cats.map((c) => (
                <button type="button" key={c} onClick={() => toggle(c)} data-testid={`cat-toggle-${c}`}
                  className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                    sel.includes(c)
                      ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900"
                      : "border-border text-muted-foreground hover:border-slate-400"
                  }`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("cancel")}</Button>
            <Button type="submit" disabled={busy} data-testid="dialog-pot-submit">{busy ? t("loading") : t("save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
