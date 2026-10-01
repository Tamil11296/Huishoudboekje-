// Rekenregels getoetst aan vaste uitkomsten uit Budget_Bouwdepot_v5.xlsx (zelfde als backend/tests/test_calc.py).
import { computeDashboard, computeBouwdepotSummary, monthAmount, round } from "./calc";
import fx from "./fixture_v5.json";

const PERSONS = [{ person_id: "R", name: "Robeson" }, { person_id: "M", name: "Miraja" }];
const TODAY = "2026-10-01";

function dashboard() {
  const fixed = fx.FIXED.map(([category, description, amount, frequency, start_date, end_date, paid_by]) =>
    ({ category, description, amount, frequency, start_date, end_date, paid_by }));
  const incomes = fx.INCOMES.map(([person_id, amount, start_date]) => ({ person_id, amount, frequency: "maandelijks", start_date }));
  const variable = fx.VARIABLE.map(([category, amount, month, paid_by]) => ({ category, amount, month, paid_by }));
  return computeDashboard({ persons: PERSONS, split_rule: "income" }, incomes, fixed, variable, 2026, TODAY);
}

test("dashboard komt overeen met Excel v5", () => {
  const d = dashboard();
  const expected = { 9: [1985.89, 1398.10, 587.79], 10: [1196.53, 568.74, 627.79],
    11: [2164.00, 568.74, 1595.26], 12: [2164.00, 568.74, 1595.26] };
  for (const [m, [over, r, mi]] of Object.entries(expected)) {
    const mo = d.months[m - 1];
    expect(round(mo.over, 2)).toBe(over);
    expect(mo.per_person.R.net).toBe(r);
    expect(mo.per_person.M.net).toBe(mi);
  }
  expect(d.months[9].income).toBe(8075.74);
  expect(d.months[9].expenses).toBe(6879.21);
});

test("jaarlijkse post alleen in eigen maand", () => {
  const e = { amount: 218.52, frequency: "jaarlijks", start_date: "2026-01-26" };
  expect(monthAmount(e, 2026, 1)).toBe(218.52);
  expect(monthAmount(e, 2026, 2)).toBe(0);
  expect(monthAmount(e, 2027, 1)).toBe(218.52);
});

test("start op 29e-31e telt die maand mee", () => {
  for (const d of [29, 30, 31]) expect(monthAmount({ amount: 100, frequency: "maandelijks", start_date: `2026-10-${d}` }, 2026, 10)).toBe(100);
  expect(monthAmount({ amount: 100, frequency: "maandelijks", start_date: "2026-02-28" }, 2026, 2)).toBe(100);
});

test("einddatum sluit volgende maanden uit", () => {
  const e = { amount: 967.47, frequency: "maandelijks", start_date: "2026-01-01", end_date: "2026-10-31" };
  expect(monthAmount(e, 2026, 10)).toBe(967.47);
  expect(monthAmount(e, 2026, 11)).toBe(0);
});

const DEPOT = { bouwdepot_id: "D", start_amount: 100251.02, end_date: "2027-01-09" };
const POSTS = [{ bouwpost_id: "T", name: "Tuin", budget: 0, bouwdepot_id: "D" }];
const q = (invoice_id, amount_incl_vat, extra = {}) => ({ invoice_id, type: "offerte", status: "geaccepteerd",
  amount_incl_vat, bouwpost_id: "T", bouwdepot_id: "D", ...extra });
const BASE = [q("q2", 41232.0), q("q3", 10580.46)];
const sum = (inv) => computeBouwdepotSummary(DEPOT, POSTS, inv, TODAY);

test("termijn als aparte factuur", () => {
  const s = sum([q("q1", 39083.0), ...BASE, { invoice_id: "f1", type: "factuur", parent_quote_id: "q1",
    invoice_amount: 11724.9, submitted_to_bank: true, bouwpost_id: "T", bouwdepot_id: "D" }]);
  expect(s.freely_available).toBe(9355.56);
  expect(s.controle).toBe(0);
});

test("termijn op offerteregel laat rest van offerte niet verdwijnen", () => {
  const s = sum([q("q1", 39083.0, { invoice_amount: 11724.9, submitted_to_bank: true }), ...BASE]);
  expect(s.freely_available).toBe(9355.56);
  expect(s.controle).toBe(0);
});

test("losse niet-ingediende factuur telt mee", () => {
  const s = sum([q("q1", 39083.0, { invoice_amount: 11724.9, submitted_to_bank: true }), ...BASE,
    { invoice_id: "b1", type: "factuur", invoice_amount: 500, bouwpost_id: "T", bouwdepot_id: "D" }]);
  expect(s.freely_available).toBe(8855.56);
  expect(s.controle).toBe(0);
});

test("controle signaleert factuur zonder bouwpost", () => {
  const s = sum([q("q1", 39083.0), ...BASE, { invoice_id: "b1", type: "factuur", invoice_amount: 500, bouwdepot_id: "D" }]);
  expect(s.controle).toBe(-500);
  expect(s.reconciled).toBe(false);
});

test("kantoorofferte erbij: € 1.165,39 tekort", () => {
  const s = sum([q("q1", 39083.0), ...BASE, q("q4", 10520.95)]);
  expect(s.freely_available).toBe(-1165.39);
  expect(s.checks.some((c) => c.code === "depot_overdrawn")).toBe(true);
});
