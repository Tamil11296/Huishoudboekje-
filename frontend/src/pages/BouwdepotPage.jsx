import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Wallet, Banknote, Send, FileClock, PiggyBank, CalendarClock,
  Paperclip, AlertTriangle,
} from "lucide-react";
import api from "@/lib/api";
import { eur, apiErr } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import RecordDialog from "@/components/RecordDialog";
import InvoiceDialog from "@/components/InvoiceDialog";
import ControlCheckPanel from "@/components/ControlCheckPanel";

function Metric({ icon: Icon, label, value, accent }) {
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 p-4">
      <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wider font-semibold">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className={`font-num font-bold text-xl sm:text-2xl mt-2 ${accent || "text-white"}`}>{value}</div>
    </div>
  );
}

export default function BouwdepotPage() {
  const { t, currentId, currentHousehold } = useApp();
  const [summary, setSummary] = useState(null);
  const [depotId, setDepotId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async () => {
    if (!currentId) return;
    const { data } = await api.get(`/households/${currentId}/bouwdepot-summary`);
    setSummary(data);
    setDepotId((prev) => (prev && data.depots.some((d) => d.bouwdepot_id === prev) ? prev : data.depots[0]?.bouwdepot_id || null));
  }, [currentId]);

  useEffect(() => { load(); }, [load]);

  const depot = useMemo(
    () => summary?.depots.find((d) => d.bouwdepot_id === depotId) || null,
    [summary, depotId]
  );
  const posts = depot?.posts || [];
  const invoices = (summary?.invoices || []).filter((i) => i.bouwdepot_id === depotId);
  const shownInvoices = statusFilter === "all" ? invoices : invoices.filter((i) => i.derived_status === statusFilter);
  const rawPosts = (summary?.bouwposten || []).filter((b) => b.bouwdepot_id === depotId);

  const cats = currentHousehold?.categories?.bouwpost || [];
  const statuses = currentHousehold?.quote_statuses || ["ontvangen", "geaccepteerd"];

  const postOpts = rawPosts.map((b) => ({ value: b.bouwpost_id, label: b.name }));
  const postName = useMemo(() => {
    const m = {};
    rawPosts.forEach((b) => (m[b.bouwpost_id] = b.name));
    return m;
  }, [rawPosts]);
  const offertes = invoices.filter((i) => i.type === "offerte");
  const quoteById = useMemo(() => {
    const m = {};
    invoices.forEach((i) => { if (i.type === "offerte") m[i.invoice_id] = i.supplier; });
    return m;
  }, [invoices]);

  const fileRef = useRef();
  const [upTarget, setUpTarget] = useState(null);
  const pickFile = (id) => { setUpTarget(id); setTimeout(() => fileRef.current?.click(), 0); };
  const onUpload = async (e) => {
    const f = e.target.files?.[0];
    if (!f || !upTarget) return;
    const fd = new FormData(); fd.append("file", f);
    try { await api.post(`/households/${currentId}/invoices/${upTarget}/attachment`, fd); toast.success(t("save")); load(); }
    catch (err) { toast.error(apiErr(err)); }
    finally { e.target.value = ""; setUpTarget(null); }
  };
  const STATUS_CLS = {
    betaald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200",
    geaccepteerd: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200",
    ingediend: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200",
    ingepland: "bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200",
    telaat: "bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200",
    ontvangen: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    open: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };
  const STATUS_LABEL = {
    betaald: t("st_betaald"), ingediend: t("st_ingediend"), ingepland: t("st_ingepland"),
    telaat: t("st_telaat"), open: t("st_open"), geaccepteerd: t("geaccepteerd"), ontvangen: t("ontvangen"),
  };

  const configs = {
    depot: {
      path: "bouwdepots", id: "bouwdepot_id", title: t("add_depot"),
      fields: [
        { name: "name", label: t("bouwdepot"), type: "text", required: true },
        { name: "start_amount", label: t("start_amount"), type: "number", required: true },
        { name: "start_date", label: t("start_date"), type: "date" },
        { name: "end_date", label: t("deposit_end"), type: "date" },
      ],
      extra: { active: true },
    },
    bouwpost: {
      path: "bouwposten", id: "bouwpost_id", title: t("add_bouwpost"),
      fields: [
        { name: "name", label: t("bouwposten"), type: "text", required: true },
        { name: "category", label: t("category"), type: "select", options: cats.map((c) => ({ value: c, label: c })) },
        { name: "budget", label: t("budget"), type: "number", required: true },
      ],
      extra: { bouwdepot_id: depotId },
    },
    invoice: {
      path: "invoices", id: "invoice_id", title: t("add_invoice"),
      fields: [
        { name: "supplier", label: t("supplier"), type: "text", required: true },
        { name: "bouwpost_id", label: t("bouwposten"), type: "select", options: postOpts, required: true },
        { name: "type", label: t("type"), type: "select", options: [{ value: "offerte", label: t("offerte") }, { value: "factuur", label: t("factuur") }], default: "offerte", required: true },
        { name: "amount_incl_vat", label: t("amount_incl_vat"), type: "number", required: true },
        { name: "status", label: t("status"), type: "select", options: statuses.map((s) => ({ value: s, label: t(s) })), default: "ontvangen" },
        { name: "valid_until", label: t("valid_until"), type: "date" },
        { name: "invoice_amount", label: t("invoice_amount"), type: "number" },
        { name: "submitted_to_bank", label: t("submitted_to_bank"), type: "switch" },
        { name: "submitted_on", label: t("submitted_to_bank"), type: "date" },
        { name: "paid_on", label: t("paid_on"), type: "date" },
        { name: "description", label: t("description"), type: "text" },
      ],
      extra: { bouwdepot_id: depotId },
    },
  };

  const save = async (kind, values) => {
    const cfg = configs[kind];
    const payload = { ...values, ...cfg.extra };
    try {
      let res;
      if (dialog?.initial) res = await api.put(`/households/${currentId}/${cfg.path}/${dialog.initial[cfg.id]}`, payload);
      else res = await api.post(`/households/${currentId}/${cfg.path}`, payload);
      toast.success(t("save"));
      load();
      return res.data;
    } catch (e) { toast.error(apiErr(e)); throw e; }
  };

  const uploadAttachment = async (id, f) => {
    const fd = new FormData(); fd.append("file", f);
    await api.post(`/households/${currentId}/invoices/${id}/attachment`, fd);
  };
  const deleteAttachment = async (id, attId) => {
    await api.delete(`/households/${currentId}/invoices/${id}/attachment/${attId}`);
  };

  const del = async (kind, item) => {
    const cfg = configs[kind];
    await api.delete(`/households/${currentId}/${cfg.path}/${item[cfg.id]}`);
    toast.success(t("delete"));
    load();
  };

  const openDialog = (kind, initial = null) => setDialog({ kind, initial });

  if (!summary) return <div className="text-muted-foreground">{t("loading")}</div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight">{t("nav_bouwdepot")}</h1>
          <p className="text-muted-foreground mt-1">{currentHousehold?.name}</p>
        </div>
        <div className="flex gap-2">
          {summary.depots.length > 0 && (
            <Select value={depotId || ""} onValueChange={setDepotId}>
              <SelectTrigger className="w-48" data-testid="depot-select"><SelectValue placeholder={t("bouwdepot")} /></SelectTrigger>
              <SelectContent>
                {summary.depots.map((d) => (
                  <SelectItem key={d.bouwdepot_id} value={d.bouwdepot_id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" className="gap-1 rounded-full" onClick={() => openDialog("depot")} data-testid="add-depot-btn">
            <Plus className="h-4 w-4" /> {t("add_depot")}
          </Button>
        </div>
      </div>

      <input type="file" ref={fileRef} className="hidden" accept=".pdf,image/*" onChange={onUpload} data-testid="attachment-input" />

      {summary.overdue_count > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200" data-testid="overdue-banner">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span><span className="font-semibold">{summary.overdue_count}</span> {t("overdue_alert")}</span>
        </div>
      )}

      {!depot ? (
        <Card className="p-10 text-center text-muted-foreground">{t("none_yet")}</Card>
      ) : (
        <>
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden bg-slate-900 text-white rounded-2xl p-6 sm:p-8 shadow-xl border border-slate-800"
            data-testid="bouwdepot-cockpit-widget"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
              <h2 className="font-heading text-xl font-bold">{depot.name}</h2>
              <Badge className="bg-white/10 text-white border-white/20">
                {t("deposit_end")}: {depot.end_date || "—"}
              </Badge>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <Metric icon={Wallet} label={t("start_amount")} value={eur(depot.start_amount)} />
              <Metric icon={Banknote} label={t("paid_out")} value={eur(depot.paid_out)} />
              <Metric icon={Send} label={t("submitted_not_paid")} value={eur(depot.submitted_not_paid)} accent="text-amber-300" />
              <Metric icon={FileClock} label={t("still_to_submit")} value={eur(depot.still_to_submit)} accent="text-amber-300" />
              <Metric icon={PiggyBank} label={t("freely_available")} value={eur(depot.freely_available)} accent={depot.freely_available >= 0 ? "text-emerald-300" : "text-rose-300"} />
              <Metric icon={CalendarClock} label={t("days_remaining")} value={depot.days_remaining != null ? depot.days_remaining : "—"} />
            </div>
          </motion.div>

          <ControlCheckPanel checks={depot.checks} reconciled={depot.reconciled} />

          {depot.timeline && depot.timeline.length > 1 && (
            <Card className="p-6">
              <h2 className="font-heading text-lg font-semibold mb-4">{t("drawdown_title")}</h2>
              <div className="h-72" data-testid="bouwdepot-drawdown-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={depot.timeline} margin={{ left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 32% 91%)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(215 16% 47%)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(215 16% 47%)" tickFormatter={(v) => `€${Math.round(v / 1000)}k`} />
                    <Tooltip formatter={(v) => eur(v)} contentStyle={{ borderRadius: 12, border: "1px solid hsl(214 32% 91%)" }} />
                    <Legend />
                    <Line type="monotone" dataKey="actual" name={t("actual")} stroke="#0f172a" strokeWidth={2.5} connectNulls dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="forecast" name={t("forecast")} stroke="#059669" strokeWidth={2} strokeDasharray="5 4" connectNulls dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          <Card className="p-0 overflow-hidden">
            <div className="flex items-center justify-between p-5">
              <div>
                <h2 className="font-heading text-lg font-semibold">{t("bouwposten")}</h2>
                <p className="text-xs text-muted-foreground">
                  {t("total_budget")}: {eur(depot.total_budget)} · {t("total_commitment")}: {eur(depot.total_commitment)}
                </p>
              </div>
              <Button size="sm" className="gap-1 rounded-full" onClick={() => openDialog("bouwpost")} data-testid="add-bouwpost-btn">
                <Plus className="h-4 w-4" /> {t("add")}
              </Button>
            </div>
            <div className="w-full overflow-x-auto">
              <Table data-testid="bouwposten-table">
                <TableHeader><TableRow>
                  <TableHead>{t("bouwposten")}</TableHead>
                  <TableHead className="text-right">{t("budget")}</TableHead>
                  <TableHead className="text-right">{t("accepted_quotes")}</TableHead>
                  <TableHead className="text-right">{t("invoiced")}</TableHead>
                  <TableHead className="text-right">{t("paid")}</TableHead>
                  <TableHead className="text-right">{t("commitment")}</TableHead>
                  <TableHead className="text-right">{t("room")}</TableHead>
                  <TableHead className="w-40">%</TableHead>
                  <TableHead className="w-24">{t("actions")}</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {posts.map((p) => {
                    const raw = rawPosts.find((b) => b.bouwpost_id === p.bouwpost_id) || p;
                    const usage = p.budget > 0 ? Math.min((p.commitment / p.budget) * 100, 100) : 0;
                    return (
                      <TableRow key={p.bouwpost_id} data-testid={`bouwpost-row-${p.bouwpost_id}`}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right font-num">{eur(p.budget)}</TableCell>
                        <TableCell className="text-right font-num">{eur(p.accepted_quotes)}</TableCell>
                        <TableCell className="text-right font-num">{eur(p.invoiced)}</TableCell>
                        <TableCell className="text-right font-num">{eur(p.paid)}</TableCell>
                        <TableCell className="text-right font-num">{eur(p.commitment)}</TableCell>
                        <TableCell className={`text-right font-num font-semibold ${p.room >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{eur(p.room)}</TableCell>
                        <TableCell><Progress value={usage} className="h-2" /></TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openDialog("bouwpost", raw)}><Pencil className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => del("bouwpost", raw)}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!posts.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">{t("none_yet")}</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </Card>

          <Card className="p-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-heading text-lg font-semibold mr-1">{t("invoices")}</h2>
                {[["all", t("all")], ["ingepland", t("st_ingepland")], ["ingediend", t("st_ingediend")], ["betaald", t("st_betaald")], ["telaat", t("st_telaat")]].map(([k, lbl]) => (
                  <button key={k} type="button" onClick={() => setStatusFilter(k)} data-testid={`invoice-filter-${k}`}
                    className={`px-3 py-1 rounded-full text-xs border transition-colors ${statusFilter === k ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900" : "border-border text-muted-foreground hover:border-slate-400"}`}>
                    {lbl}
                  </button>
                ))}
              </div>
              <Button size="sm" className="gap-1 rounded-full" onClick={() => openDialog("invoice")} data-testid="add-invoice-btn">
                <Plus className="h-4 w-4" /> {t("add")}
              </Button>
            </div>
            <div className="w-full overflow-x-auto">
              <Table data-testid="invoices-table">
                <TableHeader><TableRow>
                  <TableHead>{t("supplier")}</TableHead>
                  <TableHead>{t("bouwposten")}</TableHead>
                  <TableHead>{t("type")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead className="text-right">{t("amount_incl_vat")}</TableHead>
                  <TableHead className="text-right">{t("expected_amount")}</TableHead>
                  <TableHead className="text-right">{t("paid_amount")}</TableHead>
                  <TableHead>{t("due_date")}</TableHead>
                  <TableHead>{t("submitted_to_bank")}</TableHead>
                  <TableHead>{t("paid_on")}</TableHead>
                  <TableHead className="w-24">{t("actions")}</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {shownInvoices.map((r) => (
                    <TableRow key={r.invoice_id} data-testid={`invoice-row-${r.invoice_id}`}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1">
                          {r.supplier}
                          {r.termijn && <Badge variant="outline" className="text-xs">{t("termijn")} {r.termijn}</Badge>}
                        </div>
                        {r.parent_quote_id && quoteById[r.parent_quote_id] && (
                          <div className="text-xs text-muted-foreground">{t("offerte")}: {quoteById[r.parent_quote_id]}</div>
                        )}
                      </TableCell>
                      <TableCell>{postName[r.bouwpost_id] || <span className="text-rose-600">?</span>}</TableCell>
                      <TableCell><Badge variant="secondary">{t(r.type === "factuur" ? "factuur" : "offerte")}</Badge></TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_CLS[r.derived_status] || STATUS_CLS.open}`} data-testid={`invoice-status-${r.invoice_id}`}>{STATUS_LABEL[r.derived_status] || t(r.derived_status || "open")}</span>
                      </TableCell>
                      <TableCell className="text-right font-num">{r.amount_incl_vat ? eur(r.amount_incl_vat) : "—"}</TableCell>
                      <TableCell className="text-right font-num">{r.invoice_amount ? eur(r.invoice_amount) : "—"}</TableCell>
                      <TableCell className="text-right font-num">{r.paid_amount ? eur(r.paid_amount) : (r.paid_on && r.invoice_amount ? eur(r.invoice_amount) : "—")}</TableCell>
                      <TableCell className="font-num text-xs">{r.due_date || "—"}</TableCell>
                      <TableCell>{r.submitted_to_bank ? <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">{r.submitted_on || "✓"}</Badge> : "—"}</TableCell>
                      <TableCell className="font-num text-xs">{r.paid_on || "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8 relative" title={t("attachments")} onClick={() => openDialog("invoice", r)} data-testid={`attachments-${r.invoice_id}`}>
                            <Paperclip className={`h-4 w-4 ${r.attachments?.length ? "text-emerald-600" : ""}`} />
                            {r.attachments?.length > 0 && <span className="absolute -top-1 -right-1 bg-emerald-600 text-white rounded-full text-[10px] h-4 w-4 grid place-items-center">{r.attachments.length}</span>}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openDialog("invoice", r)}><Pencil className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => del("invoice", r)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!shownInvoices.length && <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">{t("none_yet")}</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      {dialog && dialog.kind === "invoice" && (
        <InvoiceDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          initial={dialog.initial}
          offertes={offertes}
          postOpts={postOpts}
          statuses={statuses}
          onSubmit={(v) => save("invoice", v)}
          currentId={currentId}
          uploadAttachment={uploadAttachment}
          deleteAttachment={deleteAttachment}
          onChanged={load}
          testid="dialog-invoice"
        />
      )}
      {dialog && dialog.kind !== "invoice" && (
        <RecordDialog
          open={!!dialog}
          onOpenChange={(o) => !o && setDialog(null)}
          title={configs[dialog.kind].title}
          fields={configs[dialog.kind].fields}
          initial={dialog.initial}
          onSubmit={(v) => save(dialog.kind, v)}
          testid={`dialog-${dialog.kind}`}
        />
      )}
    </div>
  );
}
