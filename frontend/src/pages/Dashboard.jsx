import React, { useEffect, useState, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell, AreaChart, Area, ReferenceLine,
} from "recharts";
import {
  TrendingUp, TrendingDown, Wallet, PiggyBank, Receipt, ArrowUpRight,
  Sparkles, AlertTriangle, Coins, Zap, Plus,
} from "lucide-react";
import { toast } from "sonner";
import api, { downloadFile } from "@/lib/api";
import { eur, pct, apiErr } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApp } from "@/context/AppContext";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";

const statusStyle = {
  afgesloten: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  lopend: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200",
  prognose: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200",
};

const PIE_COLORS = ["#0f172a", "#059669", "#f59e0b", "#6366f1", "#ec4899",
  "#14b8a6", "#ef4444", "#8b5cf6", "#0ea5e9", "#84cc16"];

function Kpi({ icon: Icon, label, value, tone, sub }) {
  const toneCls =
    tone === "pos"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "neg"
      ? "text-rose-600 dark:text-rose-400"
      : "text-slate-900 dark:text-slate-100";
  return (
    <motion.div whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-widest font-semibold text-slate-500">{label}</span>
          <Icon className="h-4 w-4 text-slate-400" />
        </div>
        <div className={`font-num font-bold text-2xl sm:text-3xl mt-3 ${toneCls}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </Card>
    </motion.div>
  );
}

export default function Dashboard() {
  const { t, currentId, currentHousehold } = useApp();
  const [data, setData] = useState(null);
  const [year, setYear] = useState(currentHousehold?.dashboard_year || new Date().getFullYear());
  const [insights, setInsights] = useState(null);
  const [insLoading, setInsLoading] = useState(false);
  const [selectedCat, setSelectedCat] = useState(null);
  const [pots, setGoals] = useState(null);

  const loadData = useCallback(() => {
    if (!currentId) return;
    api.get(`/households/${currentId}/dashboard`, { params: { year } })
      .then((r) => setData(r.data)).catch(() => {});
    api.get(`/households/${currentId}/goals-summary`)
      .then((r) => setGoals(r.data)).catch(() => {});
  }, [currentId, year]);
  useEffect(() => { loadData(); }, [loadData]);

  const personName = useMemo(() => {
    const map = {};
    (data?.persons || []).forEach((p) => (map[p.person_id] = p.name));
    return map;
  }, [data]);

  if (!data)
    return <div className="text-muted-foreground">{t("loading")}</div>;

  const a = data.annual;
  const potsMonthly = pots?.total_monthly || 0;
  const potsAnnual = Math.round(potsMonthly * 12 * 100) / 100;
  const annualFree = Math.round((a.over - potsAnnual) * 100) / 100;
  const cumAfterPots = (() => {
    let c = 0;
    return data.months.map((m) => { c += (m.over - potsMonthly); return Math.round(c * 100) / 100; });
  })();
  const chartData = data.months.map((m) => ({
    name: m.label.slice(0, 3),
    [t("income")]: m.income,
    [t("total_expenses")]: m.expenses,
  }));

  const years = [year - 1, year, year + 1];
  const savingsData = data.months.map((m) => ({
    name: m.label.slice(0, 3),
    [t("over")]: m.over,
    [t("after_pots")]: Math.round((m.over - potsMonthly) * 100) / 100,
  }));
  const categoryData = Object.entries(data.expense_by_category || {}).map(([name, value]) => ({ name, value }));
  const potBudgets = (pots?.goals || []).filter((p) => (p.categories || []).length > 0 && p.monthly_amount > 0);
  const overCount = potBudgets.filter((p) => p.spent_month > p.monthly_amount + 0.005).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight">{t("nav_dashboard")}</h1>
          <p className="text-muted-foreground mt-1">{currentHousehold?.name} · {year}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28" data-testid="year-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {overCount > 0 && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
          data-testid="budget-alert-banner">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span><span className="font-semibold">{overCount}</span> {t("goals_over_budget")}</span>
        </motion.div>
      )}

      <QuickAddFab
        currentId={currentId}
        cats={currentHousehold?.categories?.expense || []}
        persons={currentHousehold?.persons || []}
        pots={pots?.goals || []}
        defaultMonth={data.current_month ? `${data.year}-${String(data.current_month).padStart(2, "0")}` : `${data.year}-01`}
        onAdded={loadData}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="dashboard-kpis">
        <Kpi icon={Wallet} label={t("total_income")} value={eur(a.income)} />
        <Kpi icon={Receipt} label={t("total_expenses")} value={eur(a.expenses)}
             sub={`${t("fixed_expenses")}: ${eur(a.fixed)} · ${t("variable_expenses")}: ${eur(a.variable)}`} />
        <Kpi
          icon={a.over >= 0 ? TrendingUp : TrendingDown}
          label={a.over >= 0 ? t("surplus") : t("deficit")}
          value={eur(a.over)}
          tone={a.over >= 0 ? "pos" : "neg"}
          sub={potsMonthly > 0 ? `${t("reserved_pots")}: −${eur(potsAnnual)} · ${t("after_pots")}: ${eur(annualFree)}` : undefined}
        />
        <Kpi icon={PiggyBank} label={t("savings_rate")} value={pct(a.savings_rate)}
             tone={a.savings_rate >= 0 ? "pos" : "neg"} />
      </div>

      <Card className="p-6" data-testid="ai-insights-card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-slate-400" /> {t("ai_insights")}
          </h2>
          <Button size="sm" variant="outline" className="gap-1" disabled={insLoading} data-testid="generate-insights-btn"
            onClick={async () => {
              setInsLoading(true);
              try {
                const { data } = await api.post(`/households/${currentId}/ai/insights`);
                setInsights(data.tips);
              } finally { setInsLoading(false); }
            }}>
            <Sparkles className="h-4 w-4" /> {insLoading ? t("ai_thinking") : t("ai_insights")}
          </Button>
        </div>
        {!insights && !insLoading && <p className="text-sm text-muted-foreground">{t("ai_intro")}</p>}
        <ul className="space-y-2">
          {(insights || []).map((tip, i) => (
            <li key={i} className="flex gap-2 text-sm" data-testid={`insight-${i}`}>
              <span className="text-emerald-600 font-bold">•</span><span>{tip}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-6">
        <h2 className="font-heading text-lg font-semibold mb-4">{t("income_vs_expense")}</h2>
        <div className="h-72" data-testid="dashboard-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 32% 91%)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(215 16% 47%)" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(215 16% 47%)" tickFormatter={(v) => `€${v / 1000}k`} />
              <Tooltip formatter={(v) => eur(v)} contentStyle={{ borderRadius: 12, border: "1px solid hsl(214 32% 91%)" }} />
              <Legend />
              <Bar dataKey={t("income")} fill="#059669" radius={[4, 4, 0, 0]} />
              <Bar dataKey={t("total_expenses")} fill="#0f172a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading text-lg font-semibold">{t("monthly_savings")}</h2>
            <span className="text-sm text-muted-foreground">
              {t("avg_monthly_saving")}: <span className="font-num font-semibold text-emerald-600">{eur(a.avg_monthly_over)}</span>
              {potsMonthly > 0 && (
                <> · {t("after_pots")}: <span className="font-num font-semibold text-indigo-600 dark:text-indigo-400">{eur(a.avg_monthly_over - potsMonthly)}</span></>
              )}
            </span>
          </div>
          <div className="h-64" data-testid="savings-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={savingsData} margin={{ left: -10 }}>
                <defs>
                  <linearGradient id="savg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#059669" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="safter" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 32% 91%)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(215 16% 47%)" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(215 16% 47%)" tickFormatter={(v) => `€${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v) => eur(v)} contentStyle={{ borderRadius: 12, border: "1px solid hsl(214 32% 91%)" }} />
                <ReferenceLine y={a.avg_monthly_over} stroke="#0f172a" strokeDasharray="4 4" />
                <Area type="monotone" dataKey={t("over")} stroke="#059669" strokeWidth={2} fill="url(#savg)" />
                {potsMonthly > 0 && (
                  <Area type="monotone" dataKey={t("after_pots")} stroke="#6366f1" strokeWidth={2} fill="url(#safter)" />
                )}
                {potsMonthly > 0 && <Legend />}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="font-heading text-lg font-semibold mb-1">{t("category_breakdown")}</h2>
          <p className="text-xs text-muted-foreground mb-3">{t("click_category")}</p>
          <div className="h-64" data-testid="category-pie">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}
                     className="cursor-pointer" onClick={(d) => d && setSelectedCat(d.name)}>
                  {categoryData.map((entry, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => eur(v)} contentStyle={{ borderRadius: 12, border: "1px solid hsl(214 32% 91%)" }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {pots?.goals?.length > 0 && (
        <Card className="p-6" data-testid="dashboard-pots-block">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-heading text-lg font-semibold flex items-center gap-2">
              <Coins className="h-5 w-5 text-slate-400" /> {t("nav_goals")}
            </h2>
            <span className="text-sm text-muted-foreground">
              {t("reserved_pots")}: <span className="font-num font-semibold">{eur(potsMonthly)}/{t("month").toLowerCase()}</span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            {t("after_pots")}: <span className={`font-num font-semibold ${annualFree >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{eur(annualFree)}</span> / {t("annual").toLowerCase()}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pots.goals.map((p) => {
              const budget = p.monthly_amount || 0;
              const spent = p.spent_month || 0;
              const isEnvelope = (p.categories || []).length > 0 && budget > 0;
              const monthPct = budget > 0 ? Math.round((spent / budget) * 100) : 0;
              const over = isEnvelope && spent > budget + 0.005;
              const barPct = isEnvelope ? Math.min(monthPct, 100) : (p.has_target ? Math.min(p.progress || 0, 100) : 0);
              return (
                <div key={p.pot_id} className="rounded-lg border border-border p-3" data-testid={`dashboard-pot-${p.pot_id}`}>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground font-num">
                        {isEnvelope
                          ? <>{t("this_month")}: <span className={over ? "text-rose-600 font-semibold" : ""}>{eur(spent)}</span> {t("of_budget")} {eur(budget)}</>
                          : <>{eur(budget)}/{t("month").toLowerCase()}</>}
                      </div>
                    </div>
                    {over
                      ? <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-200 gap-1 shrink-0"><AlertTriangle className="h-3 w-3" />{t("over_budget")}</Badge>
                      : <Badge variant="secondary" className="text-xs shrink-0">{isEnvelope ? `${monthPct}%` : (p.has_target ? `${Math.round(p.progress || 0)}%` : t("goal_continuous"))}</Badge>}
                  </div>
                  {(isEnvelope || p.has_target) && (
                    <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${over ? "bg-rose-500" : isEnvelope && monthPct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                           style={{ width: `${barPct}%` }} />
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-1.5 text-xs">
                    <span className="text-muted-foreground">{t("pot_balance")}</span>
                    <span className={`font-num font-semibold ${p.balance >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{eur(p.balance)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div>
        <h2 className="font-heading text-xl font-bold mb-4">{t("per_person")} — {t("what_left")}</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" data-testid="per-person-cards">
          {data.persons.map((p) => {
            const pp = data.per_person_year[p.person_id] || {};
            return (
              <Card key={p.person_id} className="p-6" data-testid="per-person-split-card">
                <div className="flex items-center justify-between">
                  <span className="font-heading font-semibold text-lg">{p.name}</span>
                  <Badge variant="secondary">{data.split_rule === "income" ? t("split_income") : t("split_5050")}</Badge>
                </div>
                <div className="mt-4 space-y-2 text-sm">
                  <Row label={t("earns")} value={eur(pp.income)} />
                  <Row label={t("pays")} value={eur(pp.own)} />
                  <Row label={t("joint_share")} value={eur(pp.joint_share)} />
                  <div className="border-t border-border pt-2 flex items-center justify-between">
                    <span className="font-semibold">{t("keeps")}</span>
                    <span className={`font-num font-bold text-lg ${pp.net >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {eur(pp.net)}
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="p-6 pb-2 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold">{t("actual_vs_forecast")}</h2>
          <ArrowUpRight className="h-4 w-4 text-slate-400" />
        </div>
        <div className="w-full overflow-x-auto">
          <Table data-testid="months-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("month")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead className="text-right">{t("total_income")}</TableHead>
                <TableHead className="text-right">{t("fixed_expenses")}</TableHead>
                <TableHead className="text-right">{t("variable_expenses")}</TableHead>
                <TableHead className="text-right">{t("over")}</TableHead>
                {potsMonthly > 0 && <TableHead className="text-right">{t("nav_pots")}</TableHead>}
                {potsMonthly > 0 && <TableHead className="text-right">{t("after_pots")}</TableHead>}
                {data.persons.map((p) => (
                  <TableHead key={p.person_id} className="text-right">{p.name}</TableHead>
                ))}
                <TableHead className="text-right">{t("cumulative")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.months.map((m, idx) => (
                <TableRow key={m.month} data-testid={`month-row-${m.month}`}>
                  <TableCell className="font-medium">{m.label}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusStyle[m.status]}`}>
                      {t(m.status)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-num">{eur(m.income)}</TableCell>
                  <TableCell className="text-right font-num">{eur(m.fixed)}</TableCell>
                  <TableCell className="text-right font-num">{eur(m.variable)}</TableCell>
                  <TableCell className={`text-right font-num font-semibold ${m.over >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {eur(m.over)}
                  </TableCell>
                  {potsMonthly > 0 && (
                    <TableCell className="text-right font-num text-muted-foreground">−{eur(potsMonthly)}</TableCell>
                  )}
                  {potsMonthly > 0 && (
                    <TableCell className={`text-right font-num font-semibold ${(m.over - potsMonthly) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {eur(m.over - potsMonthly)}
                    </TableCell>
                  )}
                  {data.persons.map((p) => (
                    <TableCell key={p.person_id} className={`text-right font-num ${(m.per_person[p.person_id]?.net || 0) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {eur(m.per_person[p.person_id]?.net)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-num text-muted-foreground">{eur(potsMonthly > 0 ? cumAfterPots[idx] : m.cumulative)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={!!selectedCat} onOpenChange={(o) => !o && setSelectedCat(null)}>
        <DialogContent className="bg-popover" data-testid="category-detail-dialog">
          <DialogHeader><DialogTitle className="font-heading">{selectedCat}</DialogTitle></DialogHeader>
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            {(data.category_items?.[selectedCat] || []).map((it, i) => (
              <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-border/60 last:border-0">
                <span>{it.description}</span>
                <span className="font-num font-medium">{eur(it.amount)}</span>
              </div>
            ))}
            {!(data.category_items?.[selectedCat] || []).length && <p className="text-sm text-muted-foreground">{t("none_yet")}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-num">{value}</span>
    </div>
  );
}


const PRESET_AMTS = { Boodschappen: 50, "Uit eten": 30, "Etentjes & uitjes": 30, Vervoer: 60, Kleding: 40, "Vrije tijd": 25 };

const FREQ = ["maandelijks", "wekelijks", "per_kwartaal", "halfjaarlijks", "jaarlijks", "eenmalig"];

function QuickAddFab({ currentId, cats, persons, pots, defaultMonth, onAdded }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("variable");
  const done = () => { onAdded(); setOpen(false); };
  return (
    <>
      <motion.button
        whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
        onClick={() => setOpen(true)} data-testid="quick-add-fab"
        className="fixed bottom-6 right-24 z-40 h-14 w-14 rounded-full bg-slate-900 text-white shadow-lg shadow-slate-900/30 grid place-items-center hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
        title={t("quick_add")}>
        <Plus className="h-6 w-6" />
      </motion.button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-popover max-h-[90vh] overflow-y-auto" data-testid="quick-add-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500" /> {t("quick_add")}
            </DialogTitle>
          </DialogHeader>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid grid-cols-3 w-full" data-testid="quick-add-tabs">
              <TabsTrigger value="variable" data-testid="quick-tab-variable">{t("type_variable")}</TabsTrigger>
              <TabsTrigger value="fixed" data-testid="quick-tab-fixed">{t("type_fixed")}</TabsTrigger>
              <TabsTrigger value="pot" data-testid="quick-tab-pot">{t("type_pot")}</TabsTrigger>
            </TabsList>
            <TabsContent value="variable" className="pt-4">
              <VariableForm currentId={currentId} cats={cats} persons={persons} defaultMonth={defaultMonth} onDone={done} />
            </TabsContent>
            <TabsContent value="fixed" className="pt-4">
              <FixedForm currentId={currentId} cats={cats} persons={persons} onDone={done} />
            </TabsContent>
            <TabsContent value="pot" className="pt-4">
              <PotForm currentId={currentId} pots={pots} persons={persons} defaultMonth={defaultMonth} onDone={done} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}

function VariableForm({ currentId, cats, persons, defaultMonth, onDone }) {
  const { t } = useApp();
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [month, setMonth] = useState(defaultMonth);
  const [paidBy, setPaidBy] = useState("joint");
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const known = cats.filter((c) => PRESET_AMTS[c]);
  const rest = cats.filter((c) => !PRESET_AMTS[c]);
  const presets = [...known, ...rest].slice(0, 5).map((c) => ({ category: c, amount: PRESET_AMTS[c] || 25 }));
  const post = (c, amt, d) => api.post(`/households/${currentId}/variable-expenses`, {
    category: c, amount: Number(amt), description: d || c, month, paid_by: paidBy,
  });
  const add = async () => {
    if (!category || !amount) { toast.error(t("category") + " + " + t("amount")); return; }
    setBusy(true);
    try { await post(category, amount, desc); toast.success(t("added")); onDone(); }
    catch (e) { toast.error(apiErr(e)); } finally { setBusy(false); }
  };
  const quick = async (p) => {
    setBusy(true);
    try { await post(p.category, p.amount, p.category); toast.success(`${p.category} ${eur(p.amount)}`); onDone(); }
    catch (e) { toast.error(apiErr(e)); } finally { setBusy(false); }
  };
  const suggest = async () => {
    if (!desc || category) return;
    setSuggesting(true);
    try {
      const { data } = await api.post(`/households/${currentId}/ai/categorize`,
        { description: desc, amount: amount ? Number(amount) : undefined });
      if (data.category && cats.includes(data.category)) {
        setCategory(data.category); toast.success(`${t("ai_suggested")}: ${data.category}`);
      }
    } catch (e) { /* silent */ } finally { setSuggesting(false); }
  };
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>{t("category")}</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger data-testid="quick-expense-category"><SelectValue placeholder={t("category")} /></SelectTrigger>
          <SelectContent>{cats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label>{t("amount")}</Label>
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="font-num" data-testid="quick-expense-amount" /></div>
        <div className="space-y-1.5"><Label>{t("month")}</Label>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="quick-expense-month" /></div>
      </div>
      <div className="space-y-1.5">
        <Label>{t("description")}</Label>
        <div className="relative">
          <Input placeholder={t("description")} value={desc} onBlur={suggest}
                 onChange={(e) => setDesc(e.target.value)} className="pr-9" data-testid="quick-expense-desc" />
          <button type="button" onClick={suggest} disabled={suggesting || !desc} title={t("ai_suggested")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-amber-500 disabled:opacity-40" data-testid="quick-expense-ai">
            <Sparkles className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>{t("paid_by")}</Label>
        <Select value={paidBy} onValueChange={setPaidBy}>
          <SelectTrigger data-testid="quick-expense-person"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="joint">{t("joint")}</SelectItem>
            {persons.map((p) => <SelectItem key={p.person_id} value={p.person_id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("quick_presets")}:</span>
          {presets.map((p) => (
            <button key={p.category} type="button" onClick={() => quick(p)} disabled={busy}
              className="px-3 py-1 rounded-full text-xs border border-border hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors font-num"
              data-testid={`quick-preset-${p.category}`}>
              {p.category} {eur(p.amount)}
            </button>
          ))}
        </div>
      )}
      <Button onClick={add} disabled={busy} className="w-full gap-1 rounded-full" data-testid="quick-expense-add">
        <Plus className="h-4 w-4" /> {t("add")}
      </Button>
    </div>
  );
}

function FixedForm({ currentId, cats, persons, onDone }) {
  const { t } = useApp();
  const [category, setCategory] = useState("");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("maandelijks");
  const [paidBy, setPaidBy] = useState("joint");
  const [startDate, setStartDate] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!category || !amount || !desc) { toast.error(t("category") + " + " + t("amount")); return; }
    setBusy(true);
    try {
      await api.post(`/households/${currentId}/fixed-expenses`, {
        category, description: desc, amount: Number(amount), frequency, paid_by: paidBy, start_date: startDate || null,
      });
      toast.success(t("added")); onDone();
    } catch (e) { toast.error(apiErr(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>{t("category")}</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger data-testid="quick-fixed-category"><SelectValue placeholder={t("category")} /></SelectTrigger>
          <SelectContent>{cats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5"><Label>{t("description")}</Label>
        <Input value={desc} onChange={(e) => setDesc(e.target.value)} data-testid="quick-fixed-desc" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label>{t("amount")}</Label>
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="font-num" data-testid="quick-fixed-amount" /></div>
        <div className="space-y-1.5"><Label>{t("frequency")}</Label>
          <Select value={frequency} onValueChange={setFrequency}>
            <SelectTrigger data-testid="quick-fixed-freq"><SelectValue /></SelectTrigger>
            <SelectContent>{FREQ.map((f) => <SelectItem key={f} value={f}>{t(`freq_${f}`)}</SelectItem>)}</SelectContent>
          </Select></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label>{t("paid_by")}</Label>
          <Select value={paidBy} onValueChange={setPaidBy}>
            <SelectTrigger data-testid="quick-fixed-person"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="joint">{t("joint")}</SelectItem>
              {persons.map((p) => <SelectItem key={p.person_id} value={p.person_id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select></div>
        <div className="space-y-1.5"><Label>{t("start_date")}</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} data-testid="quick-fixed-start" /></div>
      </div>
      <Button onClick={add} disabled={busy} className="w-full gap-1 rounded-full" data-testid="quick-fixed-add">
        <Plus className="h-4 w-4" /> {t("add")}
      </Button>
    </div>
  );
}

function PotForm({ currentId, pots, persons, defaultMonth, onDone }) {
  const { t } = useApp();
  const [potId, setPotId] = useState(pots[0]?.pot_id || "");
  const [mode, setMode] = useState("deposit");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [month, setMonth] = useState(defaultMonth);
  const [paidBy, setPaidBy] = useState("joint");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const pot = pots.find((p) => p.pot_id === potId);
  const potCats = pot?.categories || [];
  if (!pots.length) return <p className="text-muted-foreground text-sm py-6 text-center">{t("none_yet")}</p>;
  const add = async () => {
    if (!potId || !amount) { toast.error(t("select_pot") + " + " + t("amount")); return; }
    setBusy(true);
    try {
      if (mode === "deposit") {
        await api.post(`/households/${currentId}/pots/${potId}/deposit`, { amount: Number(amount) });
        toast.success(t("deposit_done"));
      } else {
        const c = category || potCats[0];
        if (!c) { toast.error(t("category")); setBusy(false); return; }
        await api.post(`/households/${currentId}/variable-expenses`, {
          category: c, amount: Number(amount), description: desc || pot?.name, month, paid_by: paidBy,
        });
        toast.success(t("added"));
      }
      onDone();
    } catch (e) { toast.error(apiErr(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>{t("select_pot")}</Label>
        <Select value={potId} onValueChange={setPotId}>
          <SelectTrigger data-testid="quick-pot-select"><SelectValue placeholder={t("select_pot")} /></SelectTrigger>
          <SelectContent>{pots.map((p) => <SelectItem key={p.pot_id} value={p.pot_id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Tabs value={mode} onValueChange={setMode}>
        <TabsList className="grid grid-cols-2 w-full">
          <TabsTrigger value="deposit" data-testid="quick-pot-mode-deposit">{t("pot_deposit")}</TabsTrigger>
          <TabsTrigger value="spend" data-testid="quick-pot-mode-spend" disabled={!potCats.length}>{t("pot_spend")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="space-y-1.5"><Label>{t("amount")}</Label>
        <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="font-num" data-testid="quick-pot-amount" /></div>
      {mode === "spend" && potCats.length > 0 && (
        <>
          <div className="space-y-1.5">
            <Label>{t("category")}</Label>
            <Select value={category || potCats[0]} onValueChange={setCategory}>
              <SelectTrigger data-testid="quick-pot-category"><SelectValue /></SelectTrigger>
              <SelectContent>{potCats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>{t("month")}</Label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="quick-pot-month" /></div>
            <div className="space-y-1.5"><Label>{t("paid_by")}</Label>
              <Select value={paidBy} onValueChange={setPaidBy}>
                <SelectTrigger data-testid="quick-pot-person"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="joint">{t("joint")}</SelectItem>
                  {persons.map((p) => <SelectItem key={p.person_id} value={p.person_id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select></div>
          </div>
          <div className="space-y-1.5"><Label>{t("description")}</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} data-testid="quick-pot-desc" /></div>
        </>
      )}
      <Button onClick={add} disabled={busy} className="w-full gap-1 rounded-full" data-testid="quick-pot-add">
        <Plus className="h-4 w-4" /> {mode === "deposit" ? t("pot_deposit") : t("add")}
      </Button>
    </div>
  );
}
