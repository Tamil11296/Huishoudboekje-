import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Coins, Target, CalendarClock, CheckCircle2, AlertTriangle,
  Wand2, Sparkles, PartyPopper,
} from "lucide-react";
import api from "@/lib/api";
import { eur, apiErr } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import RecordDialog from "@/components/RecordDialog";

export default function Goals() {
  const { t, currentId, currentHousehold } = useApp();
  const [summary, setSummary] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [itemDialog, setItemDialog] = useState(null);
  const [tips, setTips] = useState({});
  const [tipBusy, setTipBusy] = useState(null);
  const cats = currentHousehold?.categories?.expense || [];

  const load = useCallback(async () => {
    if (!currentId) return;
    const { data } = await api.get(`/households/${currentId}/goals-summary`);
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

  const saveItem = async (v) => {
    try {
      const payload = { ...v, project_id: itemDialog.potId };
      await api.post(`/households/${currentId}/project-items`, payload);
      toast.success(t("save")); setItemDialog(null); load();
    } catch (e) { toast.error(apiErr(e)); }
  };
  const delItem = async (id) => { await api.delete(`/households/${currentId}/project-items/${id}`); load(); };

  const distribute = async () => {
    try { await api.post(`/households/${currentId}/goals/distribute`); toast.success(t("auto_distribute")); load(); }
    catch (e) { toast.error(apiErr(e)); }
  };
  const getTip = async (id) => {
    setTipBusy(id);
    try { const { data } = await api.post(`/households/${currentId}/goals/${id}/tip`); setTips((p) => ({ ...p, [id]: data.tip })); }
    catch (e) { toast.error(apiErr(e)); }
    finally { setTipBusy(null); }
  };

  if (!summary) return <div className="text-muted-foreground">{t("loading")}</div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight">{t("nav_goals")}</h1>
          <p className="text-muted-foreground mt-1">
            {t("free_surplus")}: <span className={`font-num font-semibold ${summary.free_surplus >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{eur(summary.free_surplus)}</span> / {t("month").toLowerCase()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-1 rounded-full" onClick={distribute} data-testid="distribute-btn">
            <Wand2 className="h-4 w-4" /> {t("auto_distribute")}
          </Button>
          <Button className="gap-1 rounded-full" onClick={() => setDialog({})} data-testid="add-goal-btn">
            <Plus className="h-4 w-4" /> {t("add_goal")}
          </Button>
        </div>
      </div>

      {!summary.goals.length && <Card className="p-10 text-center text-muted-foreground">{t("none_yet")}</Card>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {summary.goals.map((g) => {
          const isEnvelope = (g.categories || []).length > 0 && g.monthly_amount > 0;
          const over = isEnvelope && g.spent_month > g.monthly_amount + 0.005;
          const monthPct = g.monthly_amount > 0 ? Math.round((g.spent_month / g.monthly_amount) * 100) : 0;
          return (
            <motion.div key={g.pot_id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="p-6 space-y-4" data-testid={`goal-card-${g.pot_id}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-9 w-9 grid place-items-center rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 shrink-0">
                      {g.has_target ? <Target className="h-4 w-4" /> : <Coins className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0">
                      <h2 className="font-heading font-bold truncate">{g.name}</h2>
                      <p className="text-xs text-muted-foreground">{eur(g.monthly_amount)}/{t("month").toLowerCase()}</p>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDialog({ initial: g })}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => del(g.pot_id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="gap-1">
                    {g.has_target ? <><CalendarClock className="h-3 w-3" /> {t("goal_project")}</> : <>{t("goal_continuous")}</>}
                  </Badge>
                  {g.completed && (
                    <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 gap-1" data-testid={`goal-completed-${g.pot_id}`}>
                      <PartyPopper className="h-3 w-3" /> {t("goal_completed")}
                    </Badge>
                  )}
                  {g.has_target && (
                    <Button size="sm" variant="outline" className="h-7 gap-1 rounded-full text-xs ml-auto" disabled={tipBusy === g.pot_id}
                      onClick={() => getTip(g.pot_id)} data-testid={`goal-tip-btn-${g.pot_id}`}>
                      <Sparkles className="h-3 w-3" /> {tipBusy === g.pot_id ? t("ai_thinking") : t("ai_tip")}
                    </Button>
                  )}
                </div>
                {tips[g.pot_id] && (
                  <div className="text-xs rounded-lg bg-slate-50 dark:bg-slate-800/50 p-2.5 flex gap-2" data-testid={`goal-tip-${g.pot_id}`}>
                    <Sparkles className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" /> <span>{tips[g.pot_id]}</span>
                  </div>
                )}

                <div className="text-center py-1">
                  <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">{t("pot_balance")}</div>
                  <div className={`font-num font-bold text-3xl mt-1 ${g.balance >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{eur(g.balance)}</div>
                </div>

                {g.history && g.history.length > 1 && (
                  <div className="h-12" data-testid={`goal-history-${g.pot_id}`}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={g.history} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
                        <defs>
                          <linearGradient id={`gg-${g.pot_id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#059669" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#059669" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Area type="monotone" dataKey="balance" stroke="#059669" strokeWidth={2} fill={`url(#gg-${g.pot_id})`} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {isEnvelope && (
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{t("this_month")}: <span className={over ? "text-rose-600 font-semibold" : ""}>{eur(g.spent_month)}</span> / {eur(g.monthly_amount)}</span>
                      {over
                        ? <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-200 gap-1 text-xs"><AlertTriangle className="h-3 w-3" />{t("over_budget")}</Badge>
                        : <span className="text-muted-foreground">{monthPct}%</span>}
                    </div>
                    <Progress value={Math.min(monthPct, 100)} className="h-2" />
                    <div className="flex flex-wrap gap-1 mt-2">
                      {g.categories.map((c) => <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>)}
                    </div>
                  </div>
                )}

                {g.has_target && (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-2">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{t("total_cost")}</div>
                        <div className="font-num font-bold mt-0.5 text-sm">{eur(g.total_cost)}</div>
                      </div>
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-2">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{t("remaining")}</div>
                        <div className="font-num font-bold mt-0.5 text-sm">{eur(g.remaining)}</div>
                      </div>
                      <div className="rounded-lg bg-slate-900 text-white p-2">
                        <div className="text-[10px] uppercase tracking-wider text-slate-300 font-semibold">{t("required_monthly")}</div>
                        <div className="font-num font-bold mt-0.5 text-sm">{eur(g.required_monthly)}</div>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>{eur(g.balance)} {t("saved_of")} {eur(g.total_cost)}</span>
                        <span>{Math.round(g.progress || 0)}%</span>
                      </div>
                      <Progress value={Math.min(g.progress || 0, 100)} className="h-2" />
                    </div>
                    {g.target_date && (
                      <div className={`flex items-center gap-2 text-sm rounded-lg p-2.5 ${g.feasible ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300" : "bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300"}`} data-testid={`goal-feasible-${g.pot_id}`}>
                        {g.feasible ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                        {g.target_date} · {g.months_left} {t("months_left")} — {g.feasible ? t("feasible") : t("not_feasible")}
                      </div>
                    )}
                    <div className="border-t border-border pt-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{t("project_items")}</span>
                        <Button size="sm" variant="outline" className="gap-1 h-7 rounded-full text-xs"
                                onClick={() => setItemDialog({ potId: g.pot_id })} data-testid={`add-item-btn-${g.pot_id}`}>
                          <Plus className="h-3 w-3" /> {t("add")}
                        </Button>
                      </div>
                      {(g.items || []).map((it) => (
                        <div key={it.item_id} className="flex items-center justify-between text-sm py-1 group">
                          <span>{it.name}</span>
                          <span className="flex items-center gap-2">
                            <span className="font-num">{eur(it.amount)}</span>
                            <button className="opacity-0 group-hover:opacity-100 text-rose-600" onClick={() => delItem(it.item_id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        </div>
                      ))}
                      {!(g.items || []).length && <p className="text-xs text-muted-foreground">{t("none_yet")}</p>}
                    </div>
                  </>
                )}
              </Card>
            </motion.div>
          );
        })}
      </div>

      {dialog && <GoalDialog open onClose={() => setDialog(null)} initial={dialog.initial} cats={cats} onSubmit={save} />}
      {itemDialog && (
        <RecordDialog open onOpenChange={(o) => !o && setItemDialog(null)} title={t("add_cost_item")}
          fields={[
            { name: "name", label: t("cost_item"), type: "text", required: true },
            { name: "amount", label: t("amount"), type: "number", required: true },
          ]}
          onSubmit={saveItem} testid="dialog-item" />
      )}
    </div>
  );
}

function GoalDialog({ open, onClose, initial, cats, onSubmit }) {
  const { t } = useApp();
  const [name, setName] = useState(initial?.name || "");
  const [amount, setAmount] = useState(initial?.monthly_amount ?? "");
  const [targetDate, setTargetDate] = useState(initial?.target_date || "");
  const [alreadySaved, setAlreadySaved] = useState(initial?.already_saved ?? "");
  const [sel, setSel] = useState(initial?.categories || []);
  const [busy, setBusy] = useState(false);
  const toggle = (c) => setSel((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit({
        name, monthly_amount: amount, categories: sel,
        target_date: targetDate || null, already_saved: alreadySaved === "" ? 0 : alreadySaved,
      });
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-popover max-h-[90vh] overflow-y-auto" data-testid="dialog-goal">
        <DialogHeader><DialogTitle className="font-heading">{t("add_goal")}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5"><Label>{t("goal_name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} required data-testid="field-goal-name" /></div>
          <div className="space-y-1.5"><Label>{t("monthly_deposit")}</Label><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required data-testid="field-goal-amount" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>{t("target_date")}</Label><Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} data-testid="field-goal-target" /></div>
            <div className="space-y-1.5"><Label>{t("already_saved")}</Label><Input type="number" step="0.01" value={alreadySaved} onChange={(e) => setAlreadySaved(e.target.value)} data-testid="field-goal-saved" /></div>
          </div>
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
            <Button type="submit" disabled={busy} data-testid="dialog-goal-submit">{busy ? t("loading") : t("save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
