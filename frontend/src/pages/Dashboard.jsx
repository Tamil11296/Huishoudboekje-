import React, { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, Wallet, PiggyBank, Receipt, ArrowUpRight,
} from "lucide-react";
import api from "@/lib/api";
import { eur, pct } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const statusStyle = {
  afgesloten: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  lopend: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200",
  prognose: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200",
};

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

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight">{t("nav_dashboard")}</h1>
          <p className="text-muted-foreground mt-1">{currentHousehold?.name} · {year}</p>
        </div>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-32" data-testid="year-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
                  <TableCell className="text-right font-num text-muted-foreground">{eur(m.cumulative)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
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
