// "API" in de browser. De schermen roepen nog steeds api.get("/households/...") aan, maar
// in plaats van een server beantwoordt deze module de aanroepen met Firebase (of in de demo
// met opslag in het geheugen) en de rekenregels uit calc.js.
//
// LET OP: de controles hieronder ("ben je lid?", "ben je eigenaar?") zijn voor nette
// foutmeldingen. De echte beveiliging zit in firestore.rules.
import {
  computeDashboard, computeBouwdepotSummary, computePotsSummary, computeGoalsSummary, deriveInvoiceStatus,
} from "./calc";
import { buildExcel, buildPdf } from "./exporters";
import { getStore, isDemo } from "./backend";

const INVITE_DAYS = 14;
const MAX_ATTACHMENT = 10 * 1024 * 1024;
const CHUNK = 700 * 1024; // base64-tekens per Firestore-document (< 1 MiB)
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

// pad in de URL -> [collectie, id-veld, prefix, velden]
const CRUD = {
  incomes: ["incomes", "income_id", "inc", ["person_id", "source", "amount", "frequency", "start_date", "end_date"]],
  "fixed-expenses": ["fixed_expenses", "item_id", "fex", ["category", "description", "amount", "frequency", "start_date", "end_date", "paid_by"]],
  "variable-expenses": ["variable_expenses", "item_id", "vex", ["category", "description", "amount", "month", "paid_by"]],
  bouwdepots: ["bouwdepots", "bouwdepot_id", "dep", ["name", "start_amount", "start_date", "end_date", "active"]],
  bouwposten: ["bouwposten", "bouwpost_id", "bp", ["name", "category", "budget", "bouwdepot_id"]],
  invoices: ["invoices", "invoice_id", "inv", ["supplier", "bouwpost_id", "bouwdepot_id", "type", "amount_incl_vat",
    "valid_until", "status", "invoice_amount", "submitted_to_bank", "submitted_on", "paid_on", "description",
    "parent_quote_id", "termijn", "due_date", "paid_amount"]],
  pots: ["pots", "pot_id", "pot", ["name", "monthly_amount", "categories", "note", "target_date", "already_saved",
    "priority", "funded_by", "manual_contribution"]],
  projects: ["projects", "project_id", "proj", ["name", "target_date", "already_saved", "note"]],
  "project-items": ["project_items", "item_id", "pit", ["project_id", "name", "amount", "note"]],
};
const ID_FIELD = Object.fromEntries(Object.values(CRUD).map(([c, idf]) => [c, idf]));
const NUMERIC = new Set(["amount", "amount_incl_vat", "invoice_amount", "paid_amount", "budget", "start_amount",
  "monthly_amount", "already_saved", "priority"]);
export const HOUSEHOLD_COLLECTIONS = ["incomes", "fixed_expenses", "variable_expenses", "bouwdepots", "bouwposten",
  "invoices", "pots", "projects", "project_items", "change_log", "attachments", "attachment_chunks"];
const BACKUP_COLLECTIONS = ["incomes", "fixed_expenses", "variable_expenses", "bouwdepots", "bouwposten",
  "invoices", "pots", "projects", "project_items"];

// ---------- hulpfuncties ----------
const rid = (prefix) => {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return `${prefix}_${[...a].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
};
const nowIso = () => new Date().toISOString();
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const curYm = () => todayIso().slice(0, 7);

class ApiError extends Error {
  constructor(status, detail) {
    super(detail);
    this.response = { status, data: { detail } };
  }
}
const fail = (status, detail) => { throw new ApiError(status, detail); };

function cleanFields(fields, body, partial) {
  const out = {};
  for (const f of fields) {
    if (partial && !(f in body)) continue;
    let v = body[f];
    if (v === undefined) v = null;
    if (NUMERIC.has(f)) {
      if (v === null || v === "") v = null;
      else {
        const n = parseFloat(String(v).replace(",", "."));
        if (!Number.isFinite(n)) fail(400, `'${f}' moet een getal zijn`);
        v = n;
      }
    }
    out[f] = v;
  }
  return out;
}

async function me() {
  const s = await getStore();
  const u = await s.ready();
  if (!u) fail(401, "Niet ingelogd");
  return u;
}

async function requireHousehold(hid, user) {
  const s = await getStore();
  const hh = await s.getHousehold(hid);
  if (!hh) fail(404, "Huishouden niet gevonden");
  if (!(hh.member_ids || []).includes(user.user_id)) fail(403, "Geen toegang tot dit huishouden");
  return hh;
}
const requireOwner = (hh, user) => { if (hh.owner_id !== user.user_id) fail(403, "Alleen de eigenaar mag dit doen"); };

async function logChange(hid, user, action, detail) {
  const s = await getStore();
  const id = rid("log");
  await s.set(hid, "change_log", id, { log_id: id, household_id: hid, user_id: user.user_id,
    user_name: user.name || user.email, action, detail, timestamp: nowIso() });
}

const openInvite = (hh, email) => {
  const inv = (hh.invites || {})[email];
  return !!inv && (hh.invited_list || []).includes(email) && new Date(inv.expires_at) > new Date();
};

async function joinHousehold(hh, user) {
  if ((hh.member_ids || []).includes(user.user_id)) return hh.household_id; // al lid
  const s = await getStore();
  const invites = { ...(hh.invites || {}) };
  delete invites[user.email];
  const patch = {
    invites,
    invited_list: (hh.invited_list || []).filter((e) => e !== user.email),
  };
  if (!(hh.member_ids || []).includes(user.user_id)) {
    patch.member_ids = [...(hh.member_ids || []), user.user_id];
    patch.members = [...(hh.members || []), { user_id: user.user_id, email: user.email, name: user.name || "", role: "member" }];
  }
  await s.updateHousehold(hh.household_id, patch);
  await logChange(hh.household_id, user, "lid", `${user.email} is lid geworden`);
  return hh.household_id;
}

async function loadAll(hid) {
  const s = await getStore();
  const [incomes, fixed, variable, depots, bouwposten, invoices, pots, pitems] = await Promise.all(
    ["incomes", "fixed_expenses", "variable_expenses", "bouwdepots", "bouwposten", "invoices", "pots", "project_items"]
      .map((c) => s.list(hid, c)));
  return { incomes, fixed, variable, depots, bouwposten, invoices, pots, pitems };
}

function yearCtx(hh) {
  const now = new Date();
  const year = hh.dashboard_year || now.getFullYear();
  const curMonth = year === now.getFullYear() ? now.getMonth() + 1 : year < now.getFullYear() ? 12 : 0;
  return { year, curMonth };
}

async function goalsCtx(hid, hh) {
  const { year, curMonth } = yearCtx(hh);
  const d = await loadAll(hid);
  const dash = computeDashboard(hh, d.incomes, d.fixed, d.variable, year);
  const avg = dash.annual.avg_monthly_over || 0;
  const goals = computeGoalsSummary(d.pots, d.pitems, d.variable, year, curMonth, curMonth, avg).goals;
  return { goals, avg, dash, d, year, curMonth };
}

// ---------- bijlagen ----------
const fileToBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1]);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

// Foto's van bonnen verkleinen tot max. 2000 px (scheelt veel opslag).
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 600 * 1024 || typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
  routes.push({ method, re, keys, handler });
};

route("GET", "/config", async () => ({ demo: isDemo(), google_client_id: "" }));

route("GET", "/auth/me", async () => me());
route("POST", "/auth/refresh", async () => me());
route("POST", "/auth/logout", async () => { await (await getStore()).signOut(); return { ok: true }; });

route("POST", "/auth/google", async ({ body }) => {
  const s = await getStore();
  let user;
  try {
    user = await s.signIn(body?.credential);
  } catch (e) {
    if (e?.code === "auth/popup-closed-by-user" || e?.code === "auth/cancelled-popup-request") fail(400, "Inloggen geannuleerd");
    if (e?.code === "auth/popup-blocked") fail(400, "Pop-up geblokkeerd: sta pop-ups toe voor deze site");
    throw e;
  }
  if (!user.email || user.email_verified === false) {
    await s.signOut();
    fail(401, "Google-account zonder geverifieerd e-mailadres");
  }
  // Toegang: lid van een huishouden, openstaande uitnodiging, of op de toegangslijst.
  const [mine, invited, allowed] = await Promise.all([
    s.listHouseholdsFor(user.user_id), s.listInvitedHouseholds(user.email), s.isAllowedCreator(user.email)]);
  const open = invited.filter((h) => openInvite(h, user.email));
  for (const h of open) await joinHousehold(h, user);
  if (!mine.length && !open.length && !allowed) {
    await s.signOut();
    fail(403, "Dit Google-account heeft geen toegang. Vraag om een uitnodiging.");
  }
  return user;
});

route("GET", "/households", async () => {
  const u = await me();
  return (await getStore()).listHouseholdsFor(u.user_id);
});

route("POST", "/households", async ({ body }) => {
  const u = await me();
  const s = await getStore();
  if (!(await s.isAllowedCreator(u.email))) fail(403, "Alleen de eigenaar mag een huishouden aanmaken");
  const hid = rid("hh");
  const hh = {
    household_id: hid, name: body?.name || "Mijn huishouden", owner_id: u.user_id,
    members: [{ user_id: u.user_id, email: u.email, name: u.name || "", role: "owner" }],
    member_ids: [u.user_id], invites: {}, invited_list: [],
    persons: [{ person_id: rid("prs"), name: u.name || "Persoon 1" }],
    categories: { income: ["Salaris", "Bonus", "Toeslagen"],
      expense: ["Hypotheek/Huur", "Energie", "Verzekeringen", "Boodschappen", "Abonnementen"],
      bouwpost: ["Keuken", "Badkamer", "Tuin", "Overig"] },
    quote_statuses: ["ontvangen", "geaccepteerd"], quick_presets: [], split_rule: body?.split_rule || "5050",
    currency: "EUR", dashboard_year: new Date().getFullYear(), demo: false, created_at: nowIso(),
  };
  await s.createHousehold(hh);
  await logChange(hid, u, "aangemaakt", `Huishouden '${hh.name}' aangemaakt`);
  return hh;
});

route("GET", "/households/:hid", async ({ hid }) => requireHousehold(hid, await me()));

route("PATCH", "/households/:hid", async ({ hid, body }) => {
  const u = await me();
  await requireHousehold(hid, u);
  const updates = {};
  for (const k of ["name", "split_rule", "dashboard_year", "quote_statuses", "quick_presets"]) if (k in body) updates[k] = body[k];
  if (Object.keys(updates).length) {
    await (await getStore()).updateHousehold(hid, updates);
    await logChange(hid, u, "instellingen", `Instellingen bijgewerkt: ${Object.keys(updates).join(", ")}`);
  }
  return requireHousehold(hid, u);
});

route("DELETE", "/households/:hid", async ({ hid }) => {
  const u = await me();
  const hh = await requireHousehold(hid, u);
  requireOwner(hh, u);
  await (await getStore()).deleteHousehold(hid, HOUSEHOLD_COLLECTIONS);
  return { ok: true };
});

route("POST", "/households/:hid/persons", async ({ hid, body }) => {
  const u = await me();
  const hh = await requireHousehold(hid, u);
  const person = { person_id: rid("prs"), name: body?.name || "Persoon" };
  await (await getStore()).updateHousehold(hid, { persons: [...(hh.persons || []), person] });
  await logChange(hid, u, "persoon", `Persoon '${person.name}' toegevoegd`);
  return requireHousehold(hid, u);
});

route("DELETE", "/households/:hid/persons/:pid", async ({ hid, pid }) => {
  const u = await me();
  const hh = await requireHousehold(hid, u);
  await (await getStore()).updateHousehold(hid, { persons: (hh.persons || []).filter((p) => p.person_id !== pid) });
  return requireHousehold(hid, u);
});

route("POST", "/households/:hid/categories", async ({ hid, body }) => {
  const u = await me();
  const hh = await requireHousehold(hid, u);
  const { type, name } = body || {};
  if (!["income", "expense", "bouwpost"].includes(type) || !name) fail(400, "Ongeldige categorie");
  const cats = { ...(hh.categories || {}) };
  cats[type] = [...new Set([...(cats[type] || []), name])];
  await (await getStore()).updateHousehold(hid, { categories: cats });
  return requireHousehold(hid, u);
});

route("DELETE", "/households/:hid/categories", async ({ hid, params }) => {
  const u = await me();
  const hh = await requireHousehold(hid, u);
  const cats = { ...(hh.categories || {}) };
  cats[params.type] = (cats[params.type] || []).filter((c) => c !== params.name);
  await (await getStore()).updateHousehold(hid, { categories: cats });
  return requireHousehold(hid, u);
});

// Uitnodigen: e-mailadres + vervaldatum in het huishouden. De partner logt in met dat
// Google-account en wordt automatisch lid (de regels controleren e-mail en vervaldatum).
route("POST", "/households/:hid/invite", async ({ hid, body }) => {
  const u = await me();
  const hh = await requireHousehold(hid, u);
  requireOwner(hh, u);
  const email = String(body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) fail(400, "Geldig e-mailadres vereist");
  if ((hh.members || []).some((m) => (m.email || "").toLowerCase() === email)) fail(400, "Deze persoon is al lid");
  const expires = new Date(Date.now() + INVITE_DAYS * 86400000).toISOString();
  await (await getStore()).updateHousehold(hid, {
    invites: { ...(hh.invites || {}), [email]: { expires_at: expires, invited_by: u.name || u.email } },
    invited_list: [...new Set([...(hh.invited_list || []), email])],
  });
  await logChange(hid, u, "uitnodiging", `Partner uitgenodigd: ${email}`);
  const link = isDemo() ? `${window.location.href.split("#")[0]}#/invite/${hid}` : `${window.location.origin}/invite/${hid}`;
  return { ok: true, invite_link: link, email_sent: false, expires_at: expires };
});

route("GET", "/invites/:token", async ({ token }) => {
  const s = await getStore();
  const u = s.currentUser();
  const hh = u ? await s.getHousehold(token) : null;
  if (!u) {
    // Niet ingelogd: we kunnen (bewust) niets lezen. Toon een algemene uitnodiging.
    return { household_name: "een huishouden", invited_by: "de eigenaar", email: "het uitgenodigde adres" };
  }
  if (hh && (hh.member_ids || []).includes(u.user_id))
    return { household_name: hh.name, invited_by: "", email: u.email, already_member: true };
  if (!hh || !openInvite(hh, u.email)) fail(404, "Uitnodiging niet gevonden of verlopen");
  return { household_name: hh.name, invited_by: hh.invites[u.email].invited_by, email: u.email };
});

route("POST", "/invites/:token/accept", async ({ token }) => {
  const u = await me();
  const s = await getStore();
  const hh = await s.getHousehold(token);
  if (hh && (hh.member_ids || []).includes(u.user_id)) return { ok: true, household_id: hh.household_id };
  if (!hh || !openInvite(hh, u.email)) fail(404, "Uitnodiging niet gevonden of verlopen, of bedoeld voor een ander Google-account");
  return { ok: true, household_id: await joinHousehold(hh, u) };
});

route("DELETE", "/households/:hid/members/:uid", async ({ hid, uid }) => {
  const u = await me();
  const hh = await requireHousehold(hid, u);
  requireOwner(hh, u);
  if (uid === hh.owner_id) fail(400, "De eigenaar kan niet worden verwijderd");
  await (await getStore()).updateHousehold(hid, {
    members: (hh.members || []).filter((m) => m.user_id !== uid),
    member_ids: (hh.member_ids || []).filter((x) => x !== uid),
  });
  return { ok: true };
});

route("GET", "/households/:hid/changelog", async ({ hid }) => {
  await requireHousehold(hid, await me());
  const rows = await (await getStore()).list(hid, "change_log");
  return rows.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || "")).slice(0, 200);
});

// --- regels (inkomsten, lasten, bouwdepot, potjes ...) ---
for (const [path, [coll, idf, prefix, fields]] of Object.entries(CRUD)) {
  route("GET", `/households/:hid/${path}`, async ({ hid }) => {
    await requireHousehold(hid, await me());
    return (await getStore()).list(hid, coll);
  });
  route("POST", `/households/:hid/${path}`, async ({ hid, body }) => {
    const u = await me();
    await requireHousehold(hid, u);
    const d = { [idf]: rid(prefix), household_id: hid, ...cleanFields(fields, body || {}, false) };
    await (await getStore()).set(hid, coll, d[idf], d);
    await logChange(hid, u, "toegevoegd", `${path}: ${d.description || d.name || d.source || d.supplier || ""}`);
    return d;
  });
  route("PUT", `/households/:hid/${path}/:id`, async ({ hid, id, body }) => {
    const u = await me();
    await requireHousehold(hid, u);
    const s = await getStore();
    if (!(await s.update(hid, coll, id, cleanFields(fields, body || {}, true)))) fail(404, "Niet gevonden");
    await logChange(hid, u, "gewijzigd", `${path} bijgewerkt`);
    return s.get(hid, coll, id);
  });
  route("DELETE", `/households/:hid/${path}/:id`, async ({ hid, id }) => {
    const u = await me();
    await requireHousehold(hid, u);
    const s = await getStore();
    await s.remove(hid, coll, id);
    if (coll === "invoices") {
      for (const a of (await s.list(hid, "attachments")).filter((x) => x.invoice_id === id)) await deleteAttachment(hid, a.att_id);
    }
    await logChange(hid, u, "verwijderd", `${path} verwijderd`);
    return { ok: true };
  });
}

route("GET", "/households/:hid/dashboard", async ({ hid, params }) => {
  const hh = await requireHousehold(hid, await me());
  const year = parseInt(params.year, 10) || hh.dashboard_year || new Date().getFullYear();
  const d = await loadAll(hid);
  return computeDashboard(hh, d.incomes, d.fixed, d.variable, year);
});

route("GET", "/households/:hid/bouwdepot-summary", async ({ hid }) => {
  await requireHousehold(hid, await me());
  const d = await loadAll(hid);
  const summaries = d.depots.map((dep) => computeBouwdepotSummary(dep, d.bouwposten, d.invoices));
  let overdue = 0;
  const out = d.invoices.map((i) => {
    const st = deriveInvoiceStatus(i);
    if (st === "telaat") overdue += 1;
    return { ...i, derived_status: st, attachments: i.attachments || [] };
  });
  return { depots: summaries, invoices: out, bouwposten: d.bouwposten, overdue_count: overdue };
});

async function deleteAttachment(hid, attId) {
  const s = await getStore();
  const meta = await s.get(hid, "attachments", attId);
  for (let i = 0; i < (meta?.chunks || 0); i++) await s.remove(hid, "attachment_chunks", `${attId}_${i}`);
  await s.remove(hid, "attachments", attId);
}

route("POST", "/households/:hid/invoices/:id/attachment", async ({ hid, id, body }) => {
  const u = await me();
  await requireHousehold(hid, u);
  const s = await getStore();
  const inv = await s.get(hid, "invoices", id);
  if (!inv) fail(404, "Factuur/offerte niet gevonden");
  let file = body instanceof FormData ? body.get("file") : body?.file;
  if (!file) fail(400, "Geen bestand");
  if (!ALLOWED_TYPES.includes((file.type || "").toLowerCase())) fail(400, "Alleen PDF of afbeelding (jpg, png, webp, heic)");
  file = await shrinkImage(file);
  if (file.size > MAX_ATTACHMENT) fail(413, "Bestand is groter dan 10 MB");
  const b64 = await fileToBase64(file);
  const attId = rid("att").slice(4);
  const n = Math.ceil(b64.length / CHUNK) || 1;
  for (let i = 0; i < n; i++) {
    await s.set(hid, "attachment_chunks", `${attId}_${i}`, { att_id: attId, i, data: b64.slice(i * CHUNK, (i + 1) * CHUNK) });
  }
  const att = { id: attId, filename: (file.name || "bijlage").slice(0, 200), content_type: file.type };
  await s.set(hid, "attachments", attId, { att_id: attId, invoice_id: id, ...att, size: file.size, chunks: n, created_at: nowIso() });
  await s.update(hid, "invoices", id, { attachments: [...(inv.attachments || []), att] });
  await logChange(hid, u, "bouwdepot", `Bijlage toegevoegd aan '${inv.supplier || "?"}'`);
  return att;
});

route("GET", "/households/:hid/invoices/:id/attachment/:att", async ({ hid, id, att }) => {
  await requireHousehold(hid, await me());
  const s = await getStore();
  const meta = await s.get(hid, "attachments", att);
  if (!meta || meta.invoice_id !== id) fail(404, "Geen bijlage");
  let b64 = "";
  for (let i = 0; i < meta.chunks; i++) b64 += (await s.get(hid, "attachment_chunks", `${att}_${i}`))?.data || "";
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: meta.content_type });
});

route("DELETE", "/households/:hid/invoices/:id/attachment/:att", async ({ hid, id, att }) => {
  await requireHousehold(hid, await me());
  const s = await getStore();
  const inv = await s.get(hid, "invoices", id);
  if (inv) await s.update(hid, "invoices", id, { attachments: (inv.attachments || []).filter((a) => a.id !== att) });
  await deleteAttachment(hid, att);
  return { ok: true };
});

route("GET", "/households/:hid/pots-summary", async ({ hid }) => {
  const hh = await requireHousehold(hid, await me());
  const { goals, avg, d, year, curMonth } = await goalsCtx(hid, hh);
  void goals;
  const res = computePotsSummary(d.pots, d.variable, year, curMonth, curMonth);
  return { ...res, avg_monthly_over: avg, free_surplus: Math.round((avg - res.total_monthly) * 100) / 100 };
});

route("GET", "/households/:hid/goals-summary", async ({ hid }) => {
  const hh = await requireHousehold(hid, await me());
  const s = await getStore();
  const { avg, d, year, curMonth } = await goalsCtx(hid, hh);
  const res = computeGoalsSummary(d.pots, d.pitems, d.variable, year, curMonth, curMonth, avg);
  const today = todayIso();
  for (const g of res.goals) {
    const pot = d.pots.find((p) => p.pot_id === g.pot_id) || {};
    const existing = pot.completed_at;
    if (g.completed && !existing) { await s.update(hid, "pots", g.pot_id, { completed_at: today }); g.completed_at = today; }
    else if (!g.completed && existing) { await s.update(hid, "pots", g.pot_id, { completed_at: null }); g.completed_at = null; }
    else g.completed_at = existing || null;
  }
  return {
    ...res, avg_monthly_over: avg,
    free_surplus: Math.round((avg - (res.savings_planned_monthly ?? res.total_monthly)) * 100) / 100,
    month: curMonth ? `${year}-${String(curMonth).padStart(2, "0")}` : null,
    unconfirmed_this_month: res.goals.filter((g) => g.needs_contribution && !g.confirmed_this_month)
      .map((g) => ({ pot_id: g.pot_id, name: g.name, monthly_amount: g.monthly_amount })),
  };
});

route("POST", "/households/:hid/goals/distribute", async ({ hid, params }) => {
  const u = await me();
  const hh = await requireHousehold(hid, u);
  const apply = params.apply === "true";
  const { goals, avg, dash } = await goalsCtx(hid, hh);
  const keyf = (g) => {
    const pr = typeof g.priority === "number" ? g.priority : 999;
    const td = g.target_date ? String(g.target_date).slice(0, 10) : "9999-12-31";
    return [pr, td];
  };
  const cmp = (a, b) => { const [p1, d1] = keyf(a), [p2, d2] = keyf(b); return p1 - p2 || d1.localeCompare(d2); };
  const r2 = (x) => Math.round(x * 100) / 100;
  const alloc = Object.fromEntries(goals.map((g) => [g.pot_id, 0]));
  const fund = (gs, budget) => {
    let left = Math.max(budget, 0);
    for (const g of gs.filter((x) => x.has_target && (x.remaining || 0) > 0).sort(cmp)) {
      const give = r2(Math.min(g.required_monthly, Math.max(left, 0)));
      alloc[g.pot_id] = give;
      left = r2(left - give);
    }
    const cont = gs.filter((g) => !g.has_target).sort(cmp);
    if (cont.length && left > 0) {
      const each = r2(left / cont.length);
      for (const g of cont) alloc[g.pot_id] = each;
      left = 0;
    }
    return Math.max(left, 0);
  };
  const perPerson = Object.fromEntries(Object.entries(dash.per_person_year || {}).map(([pid, v]) => [pid, Math.max(r2((v.net || 0) / 12), 0)]));
  let pool = 0;
  for (const [pid, avail] of Object.entries(perPerson)) pool += fund(goals.filter((g) => g.funded_by === pid), avail);
  const joint = goals.filter((g) => !(g.funded_by in perPerson));
  fund(joint, Object.keys(perPerson).length ? pool : Math.max(avg, 0));
  const plan = goals.map((g) => ({ pot_id: g.pot_id, name: g.name, current: g.monthly_amount, proposed: alloc[g.pot_id],
    has_target: g.has_target || false, priority: g.priority, funded_by: g.funded_by || "joint" }));
  if (apply) {
    const s = await getStore();
    for (const [pid, val] of Object.entries(alloc)) await s.update(hid, "pots", pid, { monthly_amount: val });
    await logChange(hid, u, "doelen", "Overschot automatisch verdeeld over doelen");
  }
  return { plan, avg_monthly_over: avg, applied: apply };
});

route("POST", "/households/:hid/pots/confirm-all", async ({ hid, body }) => {
  const u = await me();
  await requireHousehold(hid, u);
  const s = await getStore();
  const month = body?.month || curYm();
  const amounts = body?.amounts || {};
  let n = 0;
  for (const pot of await s.list(hid, "pots")) {
    const monthly = Number(pot.monthly_amount) || 0;
    let manual = pot.manual_contribution;
    if (manual === undefined || manual === null) manual = !(pot.categories || []).length;
    if (!manual || monthly <= 0) continue;
    if ((Number((pot.contributions || {})[month]) || 0) > 0.005) continue;
    const amt = Number(amounts[pot.pot_id] ?? pot.monthly_amount) || 0;
    if (amt <= 0) continue;
    const c = { ...(pot.contributions || {}) };
    c[month] = Math.round(((Number(c[month]) || 0) + amt) * 100) / 100;
    await s.update(hid, "pots", pot.pot_id, { contributions: c });
    n += 1;
  }
  if (n) await logChange(hid, u, "inleg", `${n} potje(s) inleg bevestigd voor ${month}`);
  return { ok: true, confirmed: n, month };
});

route("POST", "/households/:hid/pots/:pid/contribute", async ({ hid, pid, body }) => {
  const u = await me();
  await requireHousehold(hid, u);
  const s = await getStore();
  const amount = Math.round((parseFloat(String(body?.amount ?? 0).replace(",", ".")) || 0) * 100) / 100;
  const month = body?.month || curYm();
  const pot = await s.get(hid, "pots", pid);
  if (!pot) fail(404, "Potje niet gevonden");
  const c = { ...(pot.contributions || {}) };
  c[month] = Math.round(((Number(c[month]) || 0) + amount) * 100) / 100;
  await s.update(hid, "pots", pid, { contributions: c });
  await logChange(hid, u, "inleg", `${pot.name}: +€${amount} (${month})`);
  return { ok: true, month, contribution: c[month] };
});

async function gatherExport(hid, hh) {
  const { goals, dash, d } = await goalsCtx(hid, hh);
  return { household: hh, dashboard: dash, depots: d.depots.map((dep) => computeBouwdepotSummary(dep, d.bouwposten, d.invoices)),
    invoices: d.invoices, goals };
}

route("GET", "/households/:hid/export/:fmt", async ({ hid, fmt }) => {
  const hh = await requireHousehold(hid, await me());
  const p = await gatherExport(hid, hh);
  if (fmt === "excel") return buildExcel(p);
  if (fmt === "pdf") return buildPdf(p);
  fail(400, "Onbekend formaat");
});

route("GET", "/households/:hid/backup", async ({ hid }) => {
  const hh = await requireHousehold(hid, await me());
  const s = await getStore();
  const { invites, invited_list, ...household } = hh;
  void invites; void invited_list;
  const out = { version: 1, exported_at: nowIso(), household };
  for (const c of BACKUP_COLLECTIONS) out[c] = await s.list(hid, c);
  return new Blob([JSON.stringify(out, null, 1)], { type: "application/json" });
});

route("POST", "/households/:hid/restore", async ({ hid, body }) => {
  const u = await me();
  const hh = await requireHousehold(hid, u);
  requireOwner(hh, u);
  if (body?.version !== 1) fail(400, "Onbekend back-upformaat");
  const s = await getStore();
  const src = body.household || {};
  const keep = {};
  for (const k of ["name", "persons", "categories", "quote_statuses", "quick_presets", "split_rule", "dashboard_year"]) if (k in src) keep[k] = src[k];
  if (Object.keys(keep).length) await s.updateHousehold(hid, keep);
  const counts = {};
  for (const c of BACKUP_COLLECTIONS) {
    const idf = ID_FIELD[c];
    const rows = (body[c] || []).filter((r) => r && r[idf]).map((r) => {
      const { _id, attachment, attachments, ...rest } = r;
      void _id; void attachment; void attachments;
      return { ...rest, household_id: hid, ...(c === "invoices" ? { attachments: [] } : {}) };
    });
    await s.clear(hid, c);
    if (rows.length) await s.setMany(hid, c, idf, rows);
    counts[c] = rows.length;
  }
  await s.clear(hid, "attachments");
  await s.clear(hid, "attachment_chunks");
  await logChange(hid, u, "herstel", `Back-up teruggezet: ${JSON.stringify(counts)}`);
  return { ok: true, counts };
});

// ---------- axios-achtige interface ----------
async function dispatch(method, url, body, config = {}) {
  const [path, qs] = String(url).split("?");
  const params = { ...Object.fromEntries(new URLSearchParams(qs || "")), ...(config.params || {}) };
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    const args = { body, params };
    r.keys.forEach((k, i) => { args[k] = decodeURIComponent(m[i + 1]); });
    try {
      return { data: await r.handler(args), status: 200 };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (e?.code === "permission-denied") throw new ApiError(403, "Geen toegang (beveiligingsregels)");
      if (e?.code === "unavailable") throw new ApiError(503, "Geen verbinding met de database");
      console.error(e);
      throw new ApiError(500, e?.message || "Er ging iets mis");
    }
  }
  throw new ApiError(404, `Onbekende actie: ${method} ${path}`);
}

const api = {
  get: (url, config) => dispatch("GET", url, undefined, config),
  delete: (url, config) => dispatch("DELETE", url, undefined, config),
  post: (url, body, config) => dispatch("POST", url, body, config),
  put: (url, body, config) => dispatch("PUT", url, body, config),
  patch: (url, body, config) => dispatch("PATCH", url, body, config),
};
export default api;

export async function downloadFile(path, filename) {
  const { data } = await api.get(path);
  const blob = data instanceof Blob ? data : new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function openFile(path) {
  // Venster direct openen (anders blokkeert de browser de pop-up), daarna vullen.
  const w = window.open("", "_blank");
  try {
    const { data } = await api.get(path);
    const url = URL.createObjectURL(data);
    if (w) w.location.href = url; else window.location.href = url;
  } catch (e) {
    if (w) w.close();
    throw e;
  }
}
