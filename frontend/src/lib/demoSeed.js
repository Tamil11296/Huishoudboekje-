// Voorbeeldgegevens voor de demo: onze cijfers uit Budget_Bouwdepot_v5.xlsx.
import fx from "./fixture_v5.json";

export const DEMO_USERS = {
  "robeson@demo.nl": { user_id: "u_robeson", name: "Robeson", picture: "", email_verified: true },
  "miraja@demo.nl": { user_id: "u_miraja", name: "Miraja", picture: "", email_verified: true },
};

export async function seedDemo(s) {
  const hid = "hh_demo";
  const R = "prs_robeson", M = "prs_miraja";
  const cats = [...new Set([...fx.FIXED.map((f) => f[0]), "Boodschappen", "Vervoer"])].sort();
  await s.createHousehold({
    household_id: hid, name: "Huize Constantine (demo)", owner_id: "u_robeson",
    members: [{ user_id: "u_robeson", email: "robeson@demo.nl", name: "Robeson", role: "owner" },
      { user_id: "u_miraja", email: "miraja@demo.nl", name: "Miraja", role: "member" }],
    member_ids: ["u_robeson", "u_miraja"], invites: {}, invited_list: [],
    persons: [{ person_id: R, name: "Robeson" }, { person_id: M, name: "Miraja" }],
    categories: { income: ["Salaris", "Vakantiegeld", "Reiskosten", "Correctie reiskosten", "Overig"],
      expense: cats, bouwpost: ["Tuin", "Kozijnen", "Overig"] },
    quote_statuses: ["ontvangen", "geaccepteerd"], quick_presets: [], split_rule: "income",
    currency: "EUR", dashboard_year: new Date().getFullYear(), demo: true, created_at: new Date().toISOString(),
  });
  const pid = { R, M };
  let n = 0;
  for (const [p, amount, start_date] of fx.INCOMES) {
    const id = `inc_${n++}`;
    await s.set(hid, "incomes", id, { income_id: id, household_id: hid, person_id: pid[p], source: "Salaris",
      amount, frequency: "maandelijks", start_date, end_date: null });
  }
  for (const [category, description, amount, frequency, start_date, end_date, p] of fx.FIXED) {
    const id = `fex_${n++}`;
    await s.set(hid, "fixed_expenses", id, { item_id: id, household_id: hid, category, description, amount,
      frequency, start_date, end_date, paid_by: pid[p] });
  }
  for (const [category, amount, month, p] of fx.VARIABLE) {
    const id = `vex_${n++}`;
    await s.set(hid, "variable_expenses", id, { item_id: id, household_id: hid, category, description: "ROAD. BV",
      amount, month, paid_by: pid[p] });
  }
  const dep = "dep_demo";
  await s.set(hid, "bouwdepots", dep, { bouwdepot_id: dep, household_id: hid, name: "Bouwdepot", start_amount: 100251.02,
    start_date: "2026-08-01", end_date: "2027-01-09", active: true });
  const posts = {};
  for (const [name, budget] of [["Tuin", 81000], ["Kozijnen", 11000], ["Overig", 11000]]) {
    posts[name] = `bp_${name.toLowerCase()}`;
    await s.set(hid, "bouwposten", posts[name], { bouwpost_id: posts[name], household_id: hid, name, budget, bouwdepot_id: dep });
  }
  const quotes = [["Uw veranda specialist", "Tuinkamer", 39083.0, "Tuin", "geaccepteerd"],
    ["Frank Bakker tuinen", "Tuinwerkzaamheden", 41232.0, "Tuin", "geaccepteerd"],
    ["Deza Kozijnen", "Vervanging deuren", 10580.46, "Kozijnen", "geaccepteerd"],
    ["Master Carpenter", "Kantoor verbouwing", 10520.95, "Overig", "ontvangen"]];
  const qid = {};
  for (const [supplier, description, amt, post, status] of quotes) {
    const id = `inv_${n++}`;
    qid[supplier] = id;
    await s.set(hid, "invoices", id, { invoice_id: id, household_id: hid, bouwdepot_id: dep, bouwpost_id: posts[post],
      supplier, type: "offerte", amount_incl_vat: amt, status, valid_until: "2026-10-10", description, attachments: [] });
  }
  const id = `inv_${n++}`;
  await s.set(hid, "invoices", id, { invoice_id: id, household_id: hid, bouwdepot_id: dep, bouwpost_id: posts.Tuin,
    supplier: "Uw veranda specialist", type: "factuur", parent_quote_id: qid["Uw veranda specialist"], termijn: "1",
    invoice_amount: 11724.9, submitted_to_bank: true, submitted_on: "2026-09-26", description: "Termijn 30%", attachments: [] });
}
