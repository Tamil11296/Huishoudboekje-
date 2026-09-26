import React, { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell, AreaChart, Area, ReferenceLine,
} from "recharts";
import {
  TrendingUp, TrendingDown, Wallet, PiggyBank, Receipt, ArrowUpRight,
  FileSpreadsheet, FileText, Sparkles, AlertTriangle, Target,
} from "lucide-react";
import api, { downloadFile } from "@/lib/api";
import { eur, pct } from "@/lib/format";
import { Button } from "@/components/ui/button";
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

  useEffect(() => {
    if (!currentId) return;
    api.get(`/households/${currentId}/dashboard`, { params: { year } })
      .then((r) => setData(r.data))
      .catch(() => {});
  }, [currentId, year]);

  const personName = useMemo(() => {
    const map = {};
    (data?.persons || []).forEach((p) => (map[p.person_id] = p.name));
    return map;
  }, [data]);

  if (!data)
    return <div className="text-muted-foreground">{t("loading")}</div>;

  const a = data.annual;
  const chartData = data.months.map((m) => ({
    name: m.label.slice(0, 3),
    [t("income")]: m.income,
    [t("total_expenses")]: m.expenses,
  }));

  const years = [year - 1, year, year + 1];
  const savingsData = data.months.map((m) => ({ name: m.label.slice(0, 3), [t("over")]: m.over }));
  const categoryData = Object.entries(data.expense_by_category || {}).map(([name, value]) => ({ name, value }));
  const catBudgets = data.category_budgets || [];
  const overCount = catBudgets.filter((c) => c.over_month).length;

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
          <Button variant="outline" size="sm" className="gap-1" data-testid="export-pdf-btn"
                  onClick={() => downloadFile(`/households/${currentId}/export/pdf`, `${currentHousehold?.name || "overzicht"}.pdf`)}>
            <FileText className="h-4 w-4" /> PDF
          </Button>
          <Button variant="outline" size="sm" className="gap-1" data-testid="export-excel-btn"
                  onClick={() => downloadFile(`/households/${currentId}/export/excel`, `${currentHousehold?.name || "overzicht"}.xlsx`)}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
        </div>
      </div>

      {overCount > 0 && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
          data-testid="budget-alert-banner">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span><span className="font-semibold">{overCount}</span> {t("categories_over_budget")}</span>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" data-testid="dashboard-kpis">
        <Kpi icon={Wallet} label={t("total_income")} value={eur(a.income)} />
        <Kpi icon={Receipt} label={t("total_expenses")} value={eur(a.expenses)}
             sub={`${t("fixed_expenses")}: ${eur(a.fixed)} · ${t("variable_expenses")}: ${eur(a.variable)}`} />
        <Kpi
          icon={a.over >= 0 ? TrendingUp : TrendingDown}
          label={a.over >= 0 ? t("surplus") : t("deficit")}
          value={eur(a.over)}
          tone={a.over >= 0 ? "pos" : "neg"}
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
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 32% 91%)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(215 16% 47%)" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(215 16% 47%)" tickFormatter={(v) => `€${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v) => eur(v)} contentStyle={{ borderRadius: 12, border: "1px solid hsl(214 32% 91%)" }} />
                <ReferenceLine y={a.avg_monthly_over} stroke="#0f172a" strokeDasharray="4 4" />
                <Area type="monotone" dataKey={t("over")} stroke="#059669" strokeWidth={2} fill="url(#savg)" />
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

      {catBudgets.length > 0 ? (
        <Card className="p-6" data-testid="category-budget-block">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-heading text-lg font-semibold flex items-center gap-2">
              <Target className="h-5 w-5 text-slate-400" /> {t("category_budget")}
            </h2>
            {data.current_month_label && <span className="text-sm text-muted-foreground">{data.current_month_label}</span>}
          </div>
          <p className="text-xs text-muted-foreground mb-4">{t("cat_budget_desc")}</p>
          <div className="space-y-4">
            {catBudgets.map((c) => {
              const pct = Math.min(c.month_pct, 100);
              const over = c.over_month;
              return (
                <div key={c.category} data-testid={`budget-row-${c.category}`}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium">{c.category}</span>
                    <span className="font-num">
                      <span className={over ? "text-rose-600 font-semibold" : ""}>{eur(c.spent_month)}</span>
                      <span className="text-muted-foreground"> {t("of_budget")} {eur(c.monthly_budget)}</span>
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${over ? "bg-rose-500" : c.month_pct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                         style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-muted-foreground">
                      {t("spent_this_year")}: <span className="font-num">{eur(c.spent_year)}</span> {t("of_budget")} {eur(c.annual_budget)}
                    </span>
                    {over
                      ? <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-200 gap-1"><AlertTriangle className="h-3 w-3" />{t("over_budget")}</Badge>
                      : <Badge variant="secondary" className="text-xs">{c.month_pct}%</Badge>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <Card className="p-6 text-sm text-muted-foreground flex items-center gap-2" data-testid="category-budget-empty">
          <Target className="h-4 w-4" /> {t("no_budgets_set")}
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
                {data.persons.map((p) => (
                  <TableHead key={p.person_id} className="text-right">{p.name}</TableHead>
                ))}
                <TableHead className="text-right">{t("cumulative")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.months.map((m) => (
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
                  {data.persons.map((p) => (
                    <TableCell key={p.person_id} className={`text-right font-num ${(m.per_person[p.person_id]?.net || 0) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {eur(m.per_person[p.person_id]?.net)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-num text-muted-foreground">{eur(m.cumulative)}</TableCell>
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
