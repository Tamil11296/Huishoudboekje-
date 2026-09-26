import React, { useEffect, useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { eur, apiErr } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import RecordDialog from "@/components/RecordDialog";

const FREQ = ["maandelijks", "wekelijks", "per_kwartaal", "halfjaarlijks", "jaarlijks", "eenmalig"];

export default function IncomeExpenses() {
  const { t, currentId, currentHousehold } = useApp();
  const [incomes, setIncomes] = useState([]);
  const [fixed, setFixed] = useState([]);
  const [variable, setVariable] = useState([]);
  const [dialog, setDialog] = useState(null); // {kind, initial}

  const persons = currentHousehold?.persons || [];
  const cats = currentHousehold?.categories || { income: [], expense: [] };

  const personName = useMemo(() => {
    const m = { joint: t("joint") };
    persons.forEach((p) => (m[p.person_id] = p.name));
    return m;
  }, [persons, t]);

  const load = useCallback(async () => {
    if (!currentId) return;
    const [a, b, c] = await Promise.all([
      api.get(`/households/${currentId}/incomes`),
      api.get(`/households/${currentId}/fixed-expenses`),
      api.get(`/households/${currentId}/variable-expenses`),
    ]);
    setIncomes(a.data); setFixed(b.data); setVariable(c.data);
  }, [currentId]);

  useEffect(() => { load(); }, [load]);

  const freqOpts = FREQ.map((f) => ({ value: f, label: t(`freq_${f}`) }));
  const personOpts = persons.map((p) => ({ value: p.person_id, label: p.name }));
  const paidByOpts = [...personOpts, { value: "joint", label: t("joint") }];

  const configs = {
    income: {
      path: "incomes", id: "income_id", title: t("add_income"),
      fields: [
        { name: "person_id", label: t("person"), type: "select", options: personOpts, required: true },
        { name: "source", label: t("source"), type: "text", required: true },
        { name: "amount", label: t("amount"), type: "number", required: true },
        { name: "frequency", label: t("frequency"), type: "select", options: freqOpts, default: "maandelijks", required: true },
        { name: "start_date", label: t("start_date"), type: "date" },
        { name: "end_date", label: t("end_date"), type: "date" },
      ],
    },
    fixed: {
      path: "fixed-expenses", id: "item_id", title: t("add_fixed"),
      fields: [
        { name: "category", label: t("category"), type: "select", options: (cats.expense || []).map((c) => ({ value: c, label: c })), required: true },
        { name: "description", label: t("description"), type: "text", required: true },
        { name: "amount", label: t("amount"), type: "number", required: true },
        { name: "frequency", label: t("frequency"), type: "select", options: freqOpts, default: "maandelijks", required: true },
        { name: "paid_by", label: t("paid_by"), type: "select", options: paidByOpts, default: "joint", required: true },
        { name: "start_date", label: t("start_date"), type: "date" },
        { name: "end_date", label: t("end_date"), type: "date" },
      ],
    },
    variable: {
      path: "variable-expenses", id: "item_id", title: t("add_variable"),
      fields: [
        { name: "category", label: t("category"), type: "select", options: (cats.expense || []).map((c) => ({ value: c, label: c })), required: true },
        { name: "description", label: t("description"), type: "text", required: true },
        { name: "amount", label: t("amount"), type: "number", required: true },
        { name: "month", label: t("month") + " (YYYY-MM)", type: "month", required: true },
        { name: "paid_by", label: t("paid_by"), type: "select", options: paidByOpts, default: "joint", required: true },
      ],
    },
  };

  const save = async (kind, values) => {
    const cfg = configs[kind];
    try {
      if (dialog?.initial) {
        await api.put(`/households/${currentId}/${cfg.path}/${dialog.initial[cfg.id]}`, values);
      } else {
        await api.post(`/households/${currentId}/${cfg.path}`, values);
      }
      toast.success(t("save"));
      load();
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  const del = async (kind, item) => {
    const cfg = configs[kind];
    await api.delete(`/households/${currentId}/${cfg.path}/${item[cfg.id]}`);
    toast.success(t("delete"));
    load();
  };

  const openDialog = (kind, initial = null) => setDialog({ kind, initial });

  const suggestCategory = async (values) => {
    if (!values.description) return null;
    try {
      const { data } = await api.post(`/households/${currentId}/ai/categorize`,
        { description: values.description, amount: values.amount });
      const opts = (cats.expense || []);
      if (data.category && opts.includes(data.category)) return { category: data.category };
    } catch (e) { toast.error(apiErr(e)); }
    return null;
  };

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight">{t("nav_income")}</h1>

      <Tabs defaultValue="income">
        <TabsList data-testid="income-tabs">
          <TabsTrigger value="income" data-testid="tab-income">{t("income")}</TabsTrigger>
          <TabsTrigger value="fixed" data-testid="tab-fixed">{t("fixed_expenses")}</TabsTrigger>
          <TabsTrigger value="variable" data-testid="tab-variable">{t("variable_expenses")}</TabsTrigger>
        </TabsList>

        <TabsContent value="income" className="mt-4">
          <Section title={t("income")} onAdd={() => openDialog("income")} testid="add-income-btn">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t("person")}</TableHead><TableHead>{t("source")}</TableHead>
                <TableHead>{t("frequency")}</TableHead><TableHead className="text-right">{t("amount")}</TableHead>
                <TableHead className="w-24">{t("actions")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {incomes.map((r) => (
                  <TableRow key={r.income_id} data-testid={`income-row-${r.income_id}`}>
                    <TableCell><Badge variant="secondary">{personName[r.person_id] || "?"}</Badge></TableCell>
                    <TableCell className="font-medium">{r.source}</TableCell>
                    <TableCell>{t(`freq_${r.frequency}`)}</TableCell>
                    <TableCell className="text-right font-num">{eur(r.amount)}</TableCell>
                    <RowActions onEdit={() => openDialog("income", r)} onDelete={() => del("income", r)} />
                  </TableRow>
                ))}
                {!incomes.length && <Empty cols={5} text={t("none_yet")} />}
              </TableBody>
            </Table>
          </Section>
        </TabsContent>

        <TabsContent value="fixed" className="mt-4">
          <Section title={t("fixed_expenses")} onAdd={() => openDialog("fixed")} testid="add-fixed-btn">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t("category")}</TableHead><TableHead>{t("description")}</TableHead>
                <TableHead>{t("frequency")}</TableHead><TableHead>{t("paid_by")}</TableHead>
                <TableHead className="text-right">{t("amount")}</TableHead><TableHead className="w-24">{t("actions")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {fixed.map((r) => (
                  <TableRow key={r.item_id} data-testid={`fixed-row-${r.item_id}`}>
                    <TableCell><Badge variant="secondary">{r.category}</Badge></TableCell>
                    <TableCell className="font-medium">{r.description}</TableCell>
                    <TableCell>{t(`freq_${r.frequency}`)}</TableCell>
                    <TableCell>{personName[r.paid_by] || t("joint")}</TableCell>
                    <TableCell className="text-right font-num">{eur(r.amount)}</TableCell>
                    <RowActions onEdit={() => openDialog("fixed", r)} onDelete={() => del("fixed", r)} />
                  </TableRow>
                ))}
                {!fixed.length && <Empty cols={6} text={t("none_yet")} />}
              </TableBody>
            </Table>
          </Section>
        </TabsContent>

        <TabsContent value="variable" className="mt-4">
          <Section title={t("variable_expenses")} onAdd={() => openDialog("variable")} testid="add-variable-btn">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t("month")}</TableHead><TableHead>{t("category")}</TableHead>
                <TableHead>{t("description")}</TableHead><TableHead>{t("paid_by")}</TableHead>
                <TableHead className="text-right">{t("amount")}</TableHead><TableHead className="w-24">{t("actions")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {variable.map((r) => (
                  <TableRow key={r.item_id} data-testid={`variable-row-${r.item_id}`}>
                    <TableCell className="font-num">{r.month}</TableCell>
                    <TableCell><Badge variant="secondary">{r.category}</Badge></TableCell>
                    <TableCell className="font-medium">{r.description}</TableCell>
                    <TableCell>{personName[r.paid_by] || t("joint")}</TableCell>
                    <TableCell className="text-right font-num">{eur(r.amount)}</TableCell>
                    <RowActions onEdit={() => openDialog("variable", r)} onDelete={() => del("variable", r)} />
                  </TableRow>
                ))}
                {!variable.length && <Empty cols={6} text={t("none_yet")} />}
              </TableBody>
            </Table>
          </Section>
        </TabsContent>
      </Tabs>

      {dialog && (
        <RecordDialog
          open={!!dialog}
          onOpenChange={(o) => !o && setDialog(null)}
          title={configs[dialog.kind].title}
          fields={configs[dialog.kind].fields.map((f) => (f.type === "month" ? { ...f, type: "text" } : f))}
          initial={dialog.initial}
          onSubmit={(v) => save(dialog.kind, v)}
          testid={`dialog-${dialog.kind}`}
          suggest={dialog.kind === "variable" ? suggestCategory : undefined}
        />
      )}
    </div>
  );
}

function Section({ title, onAdd, testid, children }) {
  const { t } = useApp();
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center justify-between p-5">
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        <Button size="sm" className="gap-1 rounded-full" onClick={onAdd} data-testid={testid}>
          <Plus className="h-4 w-4" /> {t("add")}
        </Button>
      </div>
      <div className="w-full overflow-x-auto">{children}</div>
    </Card>
  );
}

function RowActions({ onEdit, onDelete }) {
  return (
    <TableCell>
      <div className="flex gap-1">
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onEdit} data-testid="edit-row-btn">
          <Pencil className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={onDelete} data-testid="delete-row-btn">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </TableCell>
  );
}

function Empty({ cols, text }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="text-center text-muted-foreground py-8">{text}</TableCell>
    </TableRow>
  );
}
