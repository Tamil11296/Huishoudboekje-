import React, { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Sparkles } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/context/AppContext";

export default function RecordDialog({ open, onOpenChange, title, fields, initial, onSubmit, testid, suggest }) {
  const { t } = useApp();
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    if (open) {
      const base = {};
      fields.forEach((f) => (base[f.name] = initial?.[f.name] ?? f.default ?? ""));
      setValues(base);
    }
  }, [open, initial]); // eslint-disable-line

  const set = (k, v) => setValues((p) => ({ ...p, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit(values);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover max-h-[90vh] overflow-y-auto" data-testid={testid}>
        <DialogHeader>
          <DialogTitle className="font-heading">{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {fields.map((f) => (
            <div key={f.name} className="space-y-1.5">
              {f.type !== "switch" && <Label>{f.label}</Label>}
              {f.type === "select" ? (
                <Select value={values[f.name] ? String(values[f.name]) : ""} onValueChange={(v) => set(f.name, v)}>
                  <SelectTrigger data-testid={`field-${f.name}`}>
                    <SelectValue placeholder={f.label} />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options.map((o) => (
                      <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : f.type === "switch" ? (
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <Label>{f.label}</Label>
                  <Switch
                    checked={!!values[f.name]}
                    onCheckedChange={(v) => set(f.name, v)}
                    data-testid={`field-${f.name}`}
                  />
                </div>
              ) : (
                <Input
                  type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                  step={f.type === "number" ? "0.01" : undefined}
                  value={values[f.name] ?? ""}
                  onChange={(e) => set(f.name, f.type === "number" ? e.target.value : e.target.value)}
                  required={f.required}
                  data-testid={`field-${f.name}`}
                />
              )}
            </div>
          ))}
          <DialogFooter className="gap-2">
            {suggest && (
              <Button type="button" variant="outline" className="gap-1 mr-auto" disabled={suggesting}
                data-testid={`${testid}-suggest`}
                onClick={async () => {
                  setSuggesting(true);
                  try {
                    const upd = await suggest(values);
                    if (upd) setValues((p) => ({ ...p, ...upd }));
                  } finally { setSuggesting(false); }
                }}>
                <Sparkles className="h-4 w-4" /> {suggesting ? t("ai_thinking") : t("ai_suggest")}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy} data-testid={`${testid}-submit`}>
              {busy ? t("loading") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
