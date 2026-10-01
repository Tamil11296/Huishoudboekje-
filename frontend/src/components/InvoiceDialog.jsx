import React, { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import { openFile } from "@/lib/api";

function Field({ label, children }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
function Sel({ value, onChange, options, testid }) {
  return (
    <Select value={value ? String(value) : ""} onValueChange={onChange}>
      <SelectTrigger data-testid={testid}><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((o) => (<SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>))}
      </SelectContent>
    </Select>
  );
}

export default function InvoiceDialog({ open, onOpenChange, initial, offertes, postOpts, statuses, onSubmit, testid, currentId, uploadAttachment, deleteAttachment, onChanged, apiBase }) {
  const { t } = useApp();
  const [v, setV] = useState({});
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState([]);
  const [atts, setAtts] = useState([]);

  useEffect(() => {
    if (open) { setV({ type: "offerte", status: "ontvangen", submitted_to_bank: false, ...(initial || {}) }); setFiles([]); setAtts(initial?.attachments || []); }
  }, [open, initial]);

  const set = (k, val) => setV((p) => ({ ...p, [k]: val }));
  const isFactuur = v.type === "factuur";
  const NONE = "__none__";
  const onParent = (qid) => {
    if (qid === NONE) { setV((p) => ({ ...p, parent_quote_id: null })); return; }
    const q = offertes.find((o) => o.invoice_id === qid);
    setV((p) => ({ ...p, parent_quote_id: qid, bouwpost_id: q ? q.bouwpost_id : p.bouwpost_id, supplier: p.supplier || (q ? q.supplier : "") }));
  };
  const removeExisting = async (attId) => {
    if (initial?.invoice_id && deleteAttachment) await deleteAttachment(initial.invoice_id, attId);
    setAtts((a) => a.filter((x) => x.id !== attId));
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await onSubmit(v);
      const id = saved?.invoice_id || initial?.invoice_id;
      if (id && files.length && uploadAttachment) {
        for (const f of files) await uploadAttachment(id, f);
        onChanged && onChanged();
      }
      onOpenChange(false);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover max-h-[90vh] overflow-y-auto" data-testid={testid}>
        <DialogHeader><DialogTitle className="font-heading">{t("add_invoice")}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Field label={t("type")}>
            <Select value={v.type} onValueChange={(x) => set("type", x)}>
              <SelectTrigger data-testid="field-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="offerte">{t("offerte")}</SelectItem>
                <SelectItem value="factuur">{t("factuur")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("supplier")}>
            <Input value={v.supplier || ""} onChange={(e) => set("supplier", e.target.value)} required data-testid="field-supplier" />
          </Field>

          {!isFactuur && (
            <>
              <Field label={t("bouwposten")}><Sel value={v.bouwpost_id} onChange={(x) => set("bouwpost_id", x)} options={postOpts} testid="field-bouwpost_id" /></Field>
              <Field label={t("amount_incl_vat")}>
                <Input type="number" step="0.01" value={v.amount_incl_vat || ""} onChange={(e) => set("amount_incl_vat", e.target.value)} required data-testid="field-amount" />
              </Field>
              <Field label={t("status")}><Sel value={v.status} onChange={(x) => set("status", x)} options={statuses.map((s) => ({ value: s, label: t(s) }))} testid="field-status" /></Field>
              <Field label={t("valid_until")}><Input type="date" value={v.valid_until || ""} onChange={(e) => set("valid_until", e.target.value)} data-testid="field-valid_until" /></Field>
            </>
          )}

          {isFactuur && (
            <>
              <Field label={t("parent_quote")}>
                <Sel value={v.parent_quote_id || NONE} onChange={onParent}
                     options={[{ value: NONE, label: "Geen offerte (losse factuur/bon)" },
                               ...offertes.map((o) => ({ value: o.invoice_id, label: o.supplier }))]}
                     testid="field-parent_quote_id" />
              </Field>
              {!v.parent_quote_id && (
                <Field label={t("bouwposten")}><Sel value={v.bouwpost_id} onChange={(x) => set("bouwpost_id", x)} options={postOpts} testid="field-invoice-bouwpost_id" /></Field>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("termijn")}><Input value={v.termijn || ""} onChange={(e) => set("termijn", e.target.value)} placeholder="1" data-testid="field-termijn" /></Field>
                <Field label={t("due_date")}><Input type="date" value={v.due_date || ""} onChange={(e) => set("due_date", e.target.value)} data-testid="field-due_date" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("expected_amount")}><Input type="number" step="0.01" value={v.invoice_amount || ""} onChange={(e) => set("invoice_amount", e.target.value)} required data-testid="field-invoice_amount" /></Field>
                <Field label={t("paid_amount")}><Input type="number" step="0.01" value={v.paid_amount || ""} onChange={(e) => set("paid_amount", e.target.value)} data-testid="field-paid_amount" /></Field>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <Label>{t("submitted_to_bank")}</Label>
                <Switch checked={!!v.submitted_to_bank} onCheckedChange={(x) => set("submitted_to_bank", x)} data-testid="field-submitted_to_bank" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("submitted_to_bank")}><Input type="date" value={v.submitted_on || ""} onChange={(e) => set("submitted_on", e.target.value)} data-testid="field-submitted_on" /></Field>
                <Field label={t("paid_on")}><Input type="date" value={v.paid_on || ""} onChange={(e) => set("paid_on", e.target.value)} data-testid="field-paid_on" /></Field>
              </div>
            </>
          )}

          <Field label={t("description")}><Input value={v.description || ""} onChange={(e) => set("description", e.target.value)} data-testid="field-description" /></Field>

          <div className="space-y-2">
            <Label>{t("attachments")}</Label>
            {atts.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm rounded-lg border border-border px-3 py-1.5" data-testid={`existing-att-${a.id}`}>
                <button type="button" onClick={() => openFile(`/households/${currentId}/invoices/${initial?.invoice_id}/attachment/${a.id}`).catch(() => {})} className="truncate text-left text-emerald-700 dark:text-emerald-400 hover:underline">{a.filename}</button>
                <button type="button" className="text-rose-600 shrink-0 ml-2" onClick={() => removeExisting(a.id)} data-testid={`del-att-${a.id}`}>✕</button>
              </div>
            ))}
            {files.map((f, i) => (
              <div key={i} className="flex items-center justify-between text-sm rounded-lg border border-dashed border-border px-3 py-1.5">
                <span className="truncate text-muted-foreground">{f.name}</span>
                <button type="button" className="text-rose-600 shrink-0 ml-2" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <Input type="file" accept=".pdf,image/*" multiple
                   onChange={(e) => { setFiles((p) => [...p, ...Array.from(e.target.files || [])]); e.target.value = ""; }}
                   data-testid="field-attachments" />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
            <Button type="submit" disabled={busy} data-testid={`${testid}-submit`}>{busy ? t("loading") : t("save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
