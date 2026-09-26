import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Target, CalendarClock, CheckCircle2, AlertTriangle,
} from "lucide-react";
import api from "@/lib/api";
import { eur, apiErr } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import RecordDialog from "@/components/RecordDialog";

export default function Projects() {
  const { t, currentId } = useApp();
  const [summary, setSummary] = useState(null);
  const [dialog, setDialog] = useState(null);

  const load = useCallback(async () => {
    if (!currentId) return;
    const { data } = await api.get(`/households/${currentId}/projects-summary`);
    setSummary(data);
  }, [currentId]);
  useEffect(() => { load(); }, [load]);

  const projectFields = [
    { name: "name", label: t("project_name"), type: "text", required: true },
    { name: "target_date", label: t("target_date"), type: "date" },
    { name: "already_saved", label: t("already_saved"), type: "number" },
  ];
  const itemFields = [
    { name: "name", label: t("cost_item"), type: "text", required: true },
    { name: "amount", label: t("amount"), type: "number", required: true },
  ];

  const saveProject = async (v) => {
    try {
      if (dialog?.initial) await api.put(`/households/${currentId}/projects/${dialog.initial.project_id}`, v);
      else await api.post(`/households/${currentId}/projects`, v);
      toast.success(t("save")); load();
    } catch (e) { toast.error(apiErr(e)); }
  };
  const saveItem = async (v) => {
    try {
      const payload = { ...v, project_id: dialog.projectId };
      if (dialog?.initial) await api.put(`/households/${currentId}/project-items/${dialog.initial.item_id}`, payload);
      else await api.post(`/households/${currentId}/project-items`, payload);
      toast.success(t("save")); load();
    } catch (e) { toast.error(apiErr(e)); }
  };
  const delProject = async (id) => { await api.delete(`/households/${currentId}/projects/${id}`); load(); };
  const delItem = async (id) => { await api.delete(`/households/${currentId}/project-items/${id}`); load(); };

  if (!summary) return <div className="text-muted-foreground">{t("loading")}</div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight">{t("nav_projects")}</h1>
          <p className="text-muted-foreground mt-1">
            {t("surplus_avail")}: <span className="font-num font-semibold text-emerald-600">{eur(summary.avg_monthly_over)}</span> / {t("month").toLowerCase()}
          </p>
        </div>
        <Button className="gap-1 rounded-full" onClick={() => setDialog({ kind: "project" })} data-testid="add-project-btn">
          <Plus className="h-4 w-4" /> {t("add_project")}
        </Button>
      </div>

      {!summary.projects.length && (
        <Card className="p-10 text-center text-muted-foreground">{t("none_yet")}</Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {summary.projects.map((pr) => {
          const progress = pr.total_cost > 0 ? Math.min((pr.already_saved / pr.total_cost) * 100, 100) : 0;
          return (
            <motion.div key={pr.project_id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="p-6 space-y-4" data-testid={`project-card-${pr.project_id}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Target className="h-5 w-5 text-slate-400" />
                      <h2 className="font-heading text-xl font-bold">{pr.name}</h2>
                    </div>
                    {pr.target_date && (
                      <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                        <CalendarClock className="h-3.5 w-3.5" /> {pr.target_date} · {pr.months_left} {t("months_left")}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDialog({ kind: "project", initial: pr })}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => delProject(pr.project_id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{t("total_cost")}</div>
                    <div className="font-num font-bold mt-1 text-sm">{eur(pr.total_cost)}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{t("remaining")}</div>
                    <div className="font-num font-bold mt-1 text-sm">{eur(pr.remaining)}</div>
                  </div>
                  <div className="rounded-lg bg-slate-900 text-white p-3">
                    <div className="text-[10px] uppercase tracking-wider text-slate-300 font-semibold">{t("required_monthly")}</div>
                    <div className="font-num font-bold mt-1 text-sm">{eur(pr.required_monthly)}</div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>{eur(pr.already_saved)} {t("saved_of")} {eur(pr.total_cost)}</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>

                <div
                  className={`flex items-center gap-2 text-sm rounded-lg p-2.5 ${
                    pr.feasible
                      ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                      : "bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300"
                  }`}
                  data-testid={`project-feasible-${pr.project_id}`}
                >
                  {pr.feasible ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                  {pr.feasible ? t("feasible") : t("not_feasible")}
                </div>

                <div className="border-t border-border pt-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{t("project_items")}</span>
                    <Button size="sm" variant="outline" className="gap-1 h-7 rounded-full text-xs"
                            onClick={() => setDialog({ kind: "item", projectId: pr.project_id })}
                            data-testid={`add-item-btn-${pr.project_id}`}>
                      <Plus className="h-3 w-3" /> {t("add")}
                    </Button>
                  </div>
                  {pr.items.map((it) => (
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
                  {!pr.items.length && <p className="text-xs text-muted-foreground">{t("none_yet")}</p>}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {dialog?.kind === "project" && (
        <RecordDialog open onOpenChange={(o) => !o && setDialog(null)} title={t("add_project")}
          fields={projectFields} initial={dialog.initial} onSubmit={saveProject} testid="dialog-project" />
      )}
      {dialog?.kind === "item" && (
        <RecordDialog open onOpenChange={(o) => !o && setDialog(null)} title={t("add_cost_item")}
          fields={itemFields} initial={dialog.initial} onSubmit={saveItem} testid="dialog-item" />
      )}
    </div>
  );
}
