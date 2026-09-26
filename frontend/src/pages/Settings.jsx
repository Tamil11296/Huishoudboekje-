import React, { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { UserPlus, Trash2, Plus, Copy, X, Crown, User } from "lucide-react";
import api from "@/lib/api";
import { apiErr } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function Settings() {
  const { t, currentId, currentHousehold, loadHouseholds, user, setCurrentId, households } = useApp();
  const [hh, setHh] = useState(currentHousehold);
  const [name, setName] = useState("");
  const [split, setSplit] = useState("5050");
  const [year, setYear] = useState(2026);
  const [newPerson, setNewPerson] = useState("");
  const [newCat, setNewCat] = useState({ income: "", expense: "", bouwpost: "" });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [changelog, setChangelog] = useState([]);

  const isOwner = hh?.owner_id === user?.user_id;

  const refresh = useCallback(async () => {
    if (!currentId) return;
    const { data } = await api.get(`/households/${currentId}`);
    setHh(data);
    setName(data.name);
    setSplit(data.split_rule);
    setYear(data.dashboard_year);
    const cl = await api.get(`/households/${currentId}/changelog`);
    setChangelog(cl.data);
  }, [currentId]);

  useEffect(() => { refresh(); }, [refresh]);

  const saveSettings = async () => {
    try {
      await api.patch(`/households/${currentId}`, { name, split_rule: split, dashboard_year: Number(year) });
      await loadHouseholds();
      await refresh();
      toast.success(t("save"));
    } catch (e) { toast.error(apiErr(e)); }
  };

  const addPerson = async () => {
    if (!newPerson.trim()) return;
    await api.post(`/households/${currentId}/persons`, { name: newPerson });
    setNewPerson(""); await loadHouseholds(); refresh();
  };
  const delPerson = async (pid) => {
    await api.delete(`/households/${currentId}/persons/${pid}`);
    await loadHouseholds(); refresh();
  };
  const addCat = async (type) => {
    if (!newCat[type].trim()) return;
    await api.post(`/households/${currentId}/categories`, { type, name: newCat[type] });
    setNewCat({ ...newCat, [type]: "" }); await loadHouseholds(); refresh();
  };
  const delCat = async (type, cat) => {
    await api.delete(`/households/${currentId}/categories`, { params: { type, name: cat } });
    await loadHouseholds(); refresh();
  };

  const sendInvite = async () => {
    try {
      const { data } = await api.post(`/households/${currentId}/invite`, { email: inviteEmail });
      setInviteLink(data.invite_link);
      toast.success(data.email_sent ? t("invite_sent") : t("invite_link"));
      refresh();
    } catch (e) { toast.error(apiErr(e)); }
  };

  const removeMember = async (uid) => {
    await api.delete(`/households/${currentId}/members/${uid}`);
    await loadHouseholds(); refresh();
  };

  const deleteHousehold = async () => {
    await api.delete(`/households/${currentId}`);
    const list = await loadHouseholds();
    setCurrentId(list[0]?.household_id || null);
    toast.success(t("delete"));
  };

  if (!hh) return <div className="text-muted-foreground">{t("loading")}</div>;

  const catBlock = (type, labelKey) => (
    <div>
      <Label className="text-xs uppercase tracking-widest font-semibold text-slate-500">{t(labelKey)}</Label>
      <div className="flex flex-wrap gap-2 mt-2">
        {(hh.categories[type] || []).map((c) => (
          <Badge key={c} variant="secondary" className="gap-1 pr-1" data-testid={`cat-${type}-${c}`}>
            {c}
            <button onClick={() => delCat(type, c)} className="hover:text-rose-600"><X className="h-3 w-3" /></button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <Input value={newCat[type]} onChange={(e) => setNewCat({ ...newCat, [type]: e.target.value })}
               placeholder={t("add")} data-testid={`cat-input-${type}`} />
        <Button size="icon" variant="outline" onClick={() => addCat(type)} data-testid={`cat-add-${type}`}><Plus className="h-4 w-4" /></Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight">{t("nav_settings")}</h1>

      <Card className="p-6 space-y-5">
        <h2 className="font-heading text-lg font-semibold">{t("household")}</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>{t("household_name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="settings-name-input" />
          </div>
          <div className="space-y-1.5">
            <Label>{t("year")}</Label>
            <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} data-testid="settings-year-input" />
          </div>
          <div className="space-y-1.5">
            <Label>{t("split_rule")}</Label>
            <Select value={split} onValueChange={setSplit}>
              <SelectTrigger data-testid="settings-split-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="5050">{t("split_5050")}</SelectItem>
                <SelectItem value="income">{t("split_income")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={saveSettings} className="rounded-full" data-testid="save-settings-btn">{t("save")}</Button>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-heading text-lg font-semibold">{t("persons")}</h2>
        <div className="flex flex-wrap gap-2">
          {hh.persons.map((p) => (
            <Badge key={p.person_id} variant="secondary" className="gap-1 pr-1 text-sm py-1">
              {p.name}
              <button onClick={() => delPerson(p.person_id)} className="hover:text-rose-600"><X className="h-3 w-3" /></button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-2 max-w-sm">
          <Input value={newPerson} onChange={(e) => setNewPerson(e.target.value)} placeholder={t("name")} data-testid="person-input" />
          <Button variant="outline" onClick={addPerson} data-testid="add-person-btn"><Plus className="h-4 w-4" /></Button>
        </div>
      </Card>

      <Card className="p-6 space-y-6">
        <h2 className="font-heading text-lg font-semibold">{t("categories")}</h2>
        {catBlock("income", "cat_income")}
        {catBlock("expense", "cat_expense")}
        {catBlock("bouwpost", "cat_bouwpost")}
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold">{t("members")}</h2>
          {isOwner && (
            <Button size="sm" className="gap-1 rounded-full" onClick={() => { setInviteOpen(true); setInviteLink(""); }} data-testid="invite-partner-btn">
              <UserPlus className="h-4 w-4" /> {t("invite_partner")}
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {hh.members.map((m) => (
            <div key={m.user_id} className="flex items-center justify-between rounded-lg border border-border p-3" data-testid={`member-${m.user_id}`}>
              <div className="flex items-center gap-3">
                <span className="h-9 w-9 grid place-items-center rounded-full bg-slate-900 text-white text-sm font-bold">
                  {(m.name || m.email)[0].toUpperCase()}
                </span>
                <div>
                  <div className="font-medium text-sm">{m.name || m.email}</div>
                  <div className="text-xs text-muted-foreground">{m.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={m.role === "owner" ? "default" : "secondary"} className="gap-1">
                  {m.role === "owner" ? <Crown className="h-3 w-3" /> : <User className="h-3 w-3" />}
                  {m.role === "owner" ? t("owner") : t("member")}
                </Badge>
                {isOwner && m.role !== "owner" && (
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => removeMember(m.user_id)} data-testid={`remove-member-${m.user_id}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6 space-y-3">
        <h2 className="font-heading text-lg font-semibold">{t("changelog")}</h2>
        <div className="space-y-1 max-h-72 overflow-y-auto" data-testid="changelog">
          {changelog.map((c) => (
            <div key={c.log_id} className="flex items-center justify-between text-sm py-1.5 border-b border-border/60 last:border-0">
              <span><span className="font-medium">{c.user_name}</span> · <span className="text-muted-foreground">{c.detail}</span></span>
              <span className="text-xs text-muted-foreground font-num">{new Date(c.timestamp).toLocaleString("nl-NL")}</span>
            </div>
          ))}
          {!changelog.length && <p className="text-muted-foreground text-sm">{t("none_yet")}</p>}
        </div>
      </Card>

      {isOwner && (
        <Card className="p-6 border-rose-200 dark:border-rose-900">
          <h2 className="font-heading text-lg font-semibold text-rose-600">{t("delete_household")}</h2>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="mt-3 rounded-full" data-testid="delete-household-btn">{t("delete_household")}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-popover">
              <AlertDialogHeader>
                <AlertDialogTitle>{t("delete_household")}?</AlertDialogTitle>
                <AlertDialogDescription>{hh.name} — {t("confirm")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={deleteHousehold} className="bg-rose-600 hover:bg-rose-700" data-testid="confirm-delete-household">{t("delete")}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Card>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="bg-popover" data-testid="invite-dialog">
          <DialogHeader><DialogTitle className="font-heading">{t("invite_partner")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("email")}</Label>
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} data-testid="invite-email-input" />
            </div>
            <Button onClick={sendInvite} className="w-full rounded-full" data-testid="send-invite-btn">{t("invite_partner")}</Button>
            {inviteLink && (
              <div className="rounded-lg border border-border p-3 space-y-2">
                <Label className="text-xs">{t("invite_link")}</Label>
                <div className="flex gap-2">
                  <Input readOnly value={inviteLink} className="text-xs" data-testid="invite-link-output" />
                  <Button size="icon" variant="outline" onClick={() => { navigator.clipboard.writeText(inviteLink); toast.success("Gekopieerd"); }}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
