// Rekenregels — 1-op-1 overgezet van backend/calc.py (zie tests in calc.test.js).
// Alle functies zijn "puur": geen database, geen schermen. `today` kan worden meegegeven
// zodat tests altijd dezelfde uitkomst geven.

export const MONTHS_NL = ["", "Januari", "Februari", "Maart", "April", "Mei", "Juni",
  "Juli", "Augustus", "September", "Oktober", "November", "December"];

// Afronden zoals Python's round(x, n): op basis van de exacte binaire waarde (toFixed),
// en bij een exacte .5 naar het even getal ("bankers rounding").
export function round(x, n = 2) {
  const v = Number(x);
  if (!Number.isFinite(v)) return 0;
  // Een exacte tie (bijv. 0,125) kan alleen bij veelvouden van 2^-(n+1) bestaan.
  const isTie = Number.isInteger(v * 2 ** (n + 1)) && v.toFixed(n + 1).endsWith("5");
  let r;
  if (isTie) {
    const y = v * 10 ** n; // exact representeerbaar in dit geval
    const fl = Math.floor(y);
    r = (fl % 2 === 0 ? fl : fl + 1) / 10 ** n;
  } else {
    r = Number(v.toFixed(n)); // toFixed rondt af op de exacte binaire waarde, net als Python
  }
  return r === 0 ? 0 : r; // geen -0
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Datums als {y, m, d}; vergelijking via een getal yyyymmdd.
export function parseDate(d) {
  if (!d) return null;
  if (d instanceof Date) return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  if (!m) return null;
  const y = +m[1], mo = +m[2], da = +m[3];
  if (mo < 1 || mo > 12 || da < 1 || da > daysInMonth(y, mo)) return null;
  return { y, m: mo, d: da };
}
const key = (p) => p.y * 10000 + p.m * 100 + p.d;
const iso = (p) => `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dayNumber = (p) => Date.UTC(p.y, p.m - 1, p.d) / 86400000;
export const todayParts = (today) => parseDate(today || new Date());

export function monthAmount(entry, year, month) {
  const amount = num(entry.amount);
  const freq = entry.frequency || "maandelijks";
  const start = parseDate(entry.start_date);
  const end = parseDate(entry.end_date);
  const mStart = { y: year, m: month, d: 1 };
  const mEnd = { y: year, m: month, d: daysInMonth(year, month) };
  if (start && key(start) > key(mEnd)) return 0;
  if (end && key(end) < key(mStart)) return 0;

  if (freq === "maandelijks") return amount;
  if (freq === "wekelijks") return round((amount * 52) / 12, 2);
  if (freq === "eenmalig") return start && start.y === year && start.m === month ? amount : 0;

  const refMonth = start ? start.m : 1;
  const diff = (((month - refMonth) % 12) + 12) % 12;
  if (freq === "jaarlijks") return diff === 0 ? amount : 0;
  if (freq === "halfjaarlijks") return diff % 6 === 0 ? amount : 0;
  if (freq === "per_kwartaal") return diff % 3 === 0 ? amount : 0;
  return amount;
}

export function monthStatus(year, month, today) {
  const t = todayParts(today);
  if (year < t.y || (year === t.y && month < t.m)) return "afgesloten";
  if (year === t.y && month === t.m) return "lopend";
  return "prognose";
}

export function splitRatios(persons, incomeByPerson, rule) {
  const ids = persons.map((p) => p.person_id);
  if (!ids.length) return {};
  if (rule === "income") {
    const total = ids.reduce((s, id) => s + (incomeByPerson[id] || 0), 0);
    if (total > 0) return Object.fromEntries(ids.map((id) => [id, (incomeByPerson[id] || 0) / total]));
  }
  return Object.fromEntries(ids.map((id) => [id, 1 / ids.length]));
}

export function computeDashboard(household, incomes, fixedExpenses, variableExpenses, year, today) {
  const persons = household.persons || [];
  const rule = household.split_rule || "5050";
  const t = todayParts(today);
  const curMonth = year === t.y ? t.m : year < t.y ? 12 : 0;
  const months = [];
  let cumulative = 0;
  const annual = { income: 0, fixed: 0, variable: 0, expenses: 0, over: 0 };
  const expenseByCategory = {};
  const catItems = {};
  const perPersonYear = Object.fromEntries(persons.map((p) => [p.person_id, { income: 0, own: 0, joint_share: 0, net: 0 }]));

  const addItem = (cat, desc, amt) => {
    expenseByCategory[cat] = (expenseByCategory[cat] || 0) + amt;
    catItems[cat] = catItems[cat] || {};
    catItems[cat][desc] = (catItems[cat][desc] || 0) + amt;
  };

  for (let m = 1; m <= 12; m++) {
    const incomeByPerson = Object.fromEntries(persons.map((p) => [p.person_id, 0]));
    let incomeTotal = 0;
    for (const inc of incomes) {
      const amt = monthAmount(inc, year, m);
      if (amt) {
        if (inc.person_id in incomeByPerson) incomeByPerson[inc.person_id] += amt;
        incomeTotal += amt;
      }
    }
    let fixedTotal = 0, jointExpense = 0;
    const ownExpense = Object.fromEntries(persons.map((p) => [p.person_id, 0]));
    for (const ex of fixedExpenses) {
      const amt = monthAmount(ex, year, m);
      if (!amt) continue;
      fixedTotal += amt;
      const cat = ex.category || "Overig";
      addItem(cat, ex.description || cat, amt);
      const pb = ex.paid_by ?? "joint";
      if (pb in ownExpense) ownExpense[pb] += amt; else jointExpense += amt;
    }
    let variableTotal = 0;
    const ym = `${year}-${String(m).padStart(2, "0")}`;
    for (const ve of variableExpenses) {
      if (String(ve.month || "").slice(0, 7) !== ym) continue;
      const amt = num(ve.amount);
      variableTotal += amt;
      const cat = ve.category || "Overig";
      addItem(cat, ve.description || cat, amt);
      const pb = ve.paid_by ?? "joint";
      if (pb in ownExpense) ownExpense[pb] += amt; else jointExpense += amt;
    }
    const expensesTotal = fixedTotal + variableTotal;
    const over = incomeTotal - expensesTotal;
    cumulative += over;
    const savingsRate = incomeTotal > 0 ? round((over / incomeTotal) * 100, 1) : 0;
    const ratios = splitRatios(persons, incomeByPerson, rule);
    const pp = {};
    for (const p of persons) {
      const pid = p.person_id;
      const share = jointExpense * (ratios[pid] || 0);
      const net = incomeByPerson[pid] - ownExpense[pid] - share;
      pp[pid] = { income: round(incomeByPerson[pid], 2), own: round(ownExpense[pid], 2),
        joint_share: round(share, 2), net: round(net, 2) };
      perPersonYear[pid].income += incomeByPerson[pid];
      perPersonYear[pid].own += ownExpense[pid];
      perPersonYear[pid].joint_share += share;
      perPersonYear[pid].net += net;
    }
    months.push({
      month: m, label: MONTHS_NL[m], status: monthStatus(year, m, today),
      income: round(incomeTotal, 2), fixed: round(fixedTotal, 2), variable: round(variableTotal, 2),
      expenses: round(expensesTotal, 2), over: round(over, 2), cumulative: round(cumulative, 2),
      savings_rate: savingsRate, joint_expense: round(jointExpense, 2), per_person: pp,
    });
    annual.income += incomeTotal; annual.fixed += fixedTotal; annual.variable += variableTotal;
    annual.expenses += expensesTotal; annual.over += over;
  }
  for (const k of Object.keys(annual)) annual[k] = round(annual[k], 2);
  annual.savings_rate = annual.income > 0 ? round((annual.over / annual.income) * 100, 1) : 0;
  annual.avg_monthly_over = round(annual.over / 12, 2);
  for (const pid of Object.keys(perPersonYear))
    for (const k of Object.keys(perPersonYear[pid])) perPersonYear[pid][k] = round(perPersonYear[pid][k], 2);

  const sortedCats = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1]);
  return {
    year, months, annual, per_person_year: perPersonYear, persons, split_rule: rule,
    current_month: curMonth, current_month_label: curMonth ? MONTHS_NL[curMonth] : "",
    expense_by_category: Object.fromEntries(sortedCats.map(([k, v]) => [k, round(v, 2)])),
    category_items: Object.fromEntries(Object.entries(catItems).map(([c, items]) => [c,
      Object.entries(items).map(([d, v]) => ({ description: d, amount: round(v, 2) }))
        .sort((a, b) => b.amount - a.amount)])),
  };
}

export function computeBouwpostRollup(bp, invoices) {
  const rows = invoices.filter((i) => i.bouwpost_id === bp.bouwpost_id);
  const accepted = rows.filter((i) => i.type === "offerte" && i.status === "geaccepteerd");
  const acceptedQuotes = accepted.reduce((s, i) => s + num(i.amount_incl_vat), 0);
  const invoiced = rows.filter((i) => i.invoice_amount).reduce((s, i) => s + num(i.invoice_amount), 0);
  const paid = rows.filter((i) => i.paid_on).reduce((s, i) => s + num(i.paid_amount || i.invoice_amount), 0);
  const budget = num(bp.budget);
  const byQuote = {};
  for (const i of invoices)
    if (i.type === "factuur" && i.parent_quote_id)
      byQuote[i.parent_quote_id] = (byQuote[i.parent_quote_id] || 0) + num(i.invoice_amount);
  const stillToInvoice = accepted.reduce((s, q) =>
    s + Math.max(num(q.amount_incl_vat) - num(q.invoice_amount) - (byQuote[q.invoice_id] || 0), 0), 0);
  const commitment = invoiced + stillToInvoice;
  const out = {};
  for (const k of ["bouwpost_id", "name", "category", "bouwdepot_id"]) if (k in bp) out[k] = bp[k];
  return {
    ...out, budget: round(budget, 2), accepted_quotes: round(acceptedQuotes, 2),
    invoiced: round(invoiced, 2), paid: round(paid, 2), still_to_invoice: round(stillToInvoice, 2),
    commitment: round(commitment, 2), room: round(budget - commitment, 2),
  };
}

export function deriveInvoiceStatus(i, today) {
  if (i.type === "offerte") return i.status || "ontvangen";
  if (i.paid_on) return "betaald";
  if (i.submitted_to_bank) return "ingediend";
  const due = parseDate(i.due_date);
  if (due) return dayNumber(due) - dayNumber(todayParts(today)) < 0 ? "telaat" : "ingepland";
  return "open";
}

function buildTimeline(depot, invoices, start, paidOut, submittedNotPaid, stillToSubmit, today) {
  const t = todayParts(today);
  const startDate = parseDate(depot.start_date) || t;
  const endDate = parseDate(depot.end_date);
  const paid = invoices.filter((i) => i.paid_on && parseDate(i.paid_on))
    .map((i) => [parseDate(i.paid_on), num(i.paid_amount || i.invoice_amount)])
    .sort((a, b) => key(a[0]) - key(b[0]));
  const pts = {};
  let bal = start;
  pts[iso(startDate)] = { date: iso(startDate), actual: round(bal, 2), forecast: null };
  for (const [d, amt] of paid) {
    bal -= amt;
    pts[iso(d)] = { date: iso(d), actual: round(bal, 2), forecast: null };
  }
  const actualToday = round(start - paidOut, 2);
  const tk = iso(t);
  if (!(tk in pts)) pts[tk] = { date: tk, actual: actualToday, forecast: actualToday };
  else pts[tk].forecast = actualToday;
  if (endDate && key(endDate) > key(t)) {
    const final = round(actualToday - submittedNotPaid - stillToSubmit, 2);
    pts[iso(endDate)] = { date: iso(endDate), actual: null, forecast: final };
  }
  return Object.keys(pts).sort().map((k) => pts[k]);
}

const fmt2 = (v) => {
  // zoals Python's str(round(x, 2)): 1500.0 → "1500.0", 9355.56 → "9355.56"
  const r = round(v, 2);
  return Number.isInteger(r) ? `${r}.0` : String(r);
};

export function computeBouwdepotSummary(depot, bouwposten, invoices, today) {
  const t = todayParts(today);
  const di = invoices.filter((i) => i.bouwdepot_id === depot.bouwdepot_id);
  const start = num(depot.start_amount);
  const paidOut = di.filter((i) => i.paid_on).reduce((s, i) => s + num(i.paid_amount || i.invoice_amount), 0);
  const submittedNotPaid = di.filter((i) => i.submitted_to_bank && !i.paid_on).reduce((s, i) => s + num(i.invoice_amount), 0);
  const posts = bouwposten.filter((bp) => bp.bouwdepot_id === depot.bouwdepot_id).map((bp) => computeBouwpostRollup(bp, di));

  const committed = (i) => (i.paid_on ? num(i.paid_amount || i.invoice_amount) : i.submitted_to_bank ? num(i.invoice_amount) : 0);
  const childCommitted = {};
  for (const i of di)
    if (i.type === "factuur" && i.parent_quote_id)
      childCommitted[i.parent_quote_id] = (childCommitted[i.parent_quote_id] || 0) + committed(i);
  let stillToSubmit = 0;
  for (const i of di)
    if (i.type === "offerte" && i.status === "geaccepteerd")
      stillToSubmit += Math.max(num(i.amount_incl_vat) - (childCommitted[i.invoice_id] || 0) - committed(i), 0);
  const quoteIds = new Set(di.filter((i) => i.type === "offerte").map((i) => i.invoice_id));
  const looseToSubmit = di.filter((i) => i.type === "factuur" && !quoteIds.has(i.parent_quote_id) && !i.paid_on && !i.submitted_to_bank)
    .reduce((s, i) => s + num(i.invoice_amount), 0);
  stillToSubmit += looseToSubmit;

  const balanceAfterPending = start - paidOut - submittedNotPaid;
  const freelyAvailable = balanceAfterPending - stillToSubmit;
  const end = parseDate(depot.end_date);
  const daysRemaining = end ? dayNumber(end) - dayNumber(t) : null;

  const checks = [];
  const validPostIds = new Set(bouwposten.map((bp) => bp.bouwpost_id));
  for (const i of di) {
    if (i.bouwpost_id && !validPostIds.has(i.bouwpost_id))
      checks.push({ level: "error", code: "invoice_no_bouwpost", message: `Factuur '${i.supplier ?? "?"}' verwijst naar een onbekende bouwpost.` });
    if (!i.bouwpost_id)
      checks.push({ level: "error", code: "invoice_no_bouwpost", message: `Factuur/offerte '${i.supplier ?? "?"}' heeft geen bouwpost.` });
  }
  for (const p of posts) {
    if (p.budget > 0 && p.commitment > p.budget + 0.005)
      checks.push({ level: "error", code: "budget_overrun", message: `Bouwpost '${p.name}' overschrijdt budget met €${fmt2(p.commitment - p.budget)}.` });
    else if (p.budget > 0 && p.commitment >= p.budget * 0.9)
      checks.push({ level: "warning", code: "budget_near", message: `Bouwpost '${p.name}' nadert het budget (${round((p.commitment / p.budget) * 100, 0)}%).` });
  }
  if (freelyAvailable < -0.005)
    checks.push({ level: "error", code: "depot_overdrawn", message: `Verplichtingen overschrijden het bouwdepot met €${fmt2(-freelyAvailable)}.` });
  else if (start > 0 && freelyAvailable < start * 0.1)
    checks.push({ level: "warning", code: "depot_low", message: `Bijna leeg: nog maar €${fmt2(freelyAvailable)} vrij besteedbaar in het bouwdepot.` });
  for (const i of di) {
    if (i.type === "factuur" && i.due_date && !i.paid_on) {
      const due = parseDate(i.due_date);
      if (!due) continue;
      const days = dayNumber(due) - dayNumber(t);
      if (days < 0)
        checks.push({ level: "error", code: "termijn_overdue", message: `Termijn van '${i.supplier ?? "?"}' is ${-days} dagen over de vervaldatum en nog niet betaald.` });
      else if (days <= 14 && !i.submitted_to_bank)
        checks.push({ level: "warning", code: "termijn_due", message: `Termijn van '${i.supplier ?? "?"}' vervalt over ${days} dagen en is nog niet ingediend bij de bank.` });
      else if (days <= 7)
        checks.push({ level: "warning", code: "termijn_due", message: `Termijn van '${i.supplier ?? "?"}' vervalt over ${days} dagen.` });
    }
  }
  // Controle: twee onafhankelijke optellingen moeten gelijk zijn.
  const depotTotal = paidOut + submittedNotPaid + stillToSubmit;
  const controle = round(posts.reduce((s, p) => s + p.commitment, 0) - depotTotal, 2);
  if (Math.abs(controle) >= 0.01)
    checks.push({ level: "error", code: "controle_mismatch", message: `Controle wijkt €${fmt2(controle)} af: bouwposten en depot sluiten niet op elkaar aan.` });

  return {
    bouwdepot_id: depot.bouwdepot_id, name: depot.name ?? null, start_amount: round(start, 2),
    paid_out: round(paidOut, 2), submitted_not_paid: round(submittedNotPaid, 2),
    still_to_submit: round(stillToSubmit, 2), balance_after_pending: round(balanceAfterPending, 2),
    freely_available: round(freelyAvailable, 2), end_date: depot.end_date ?? null,
    days_remaining: daysRemaining,
    total_budget: round(posts.reduce((s, p) => s + p.budget, 0), 2),
    total_commitment: round(posts.reduce((s, p) => s + p.commitment, 0), 2),
    posts, checks, reconciled: checks.filter((c) => c.level === "error").length === 0,
    controle, timeline: buildTimeline(depot, di, start, paidOut, submittedNotPaid, stillToSubmit, today),
  };
}

function spendingFor(cats, variableExpenses, year, monthsElapsed, currentMonth) {
  let spentYtd = 0, spentMonth = 0;
  const byMonth = {};
  for (const ve of variableExpenses) {
    if (cats.includes(ve.category) && String(ve.month || "").slice(0, 4) === String(year)) {
      const mm = parseInt(String(ve.month).slice(5, 7), 10);
      const amt = num(ve.amount);
      byMonth[mm] = (byMonth[mm] || 0) + amt;
      if (mm <= monthsElapsed) spentYtd += amt;
      if (mm === currentMonth) spentMonth += amt;
    }
  }
  return { spentYtd, spentMonth, byMonth };
}

export function computePotsSummary(pots, variableExpenses, year, monthsElapsed, currentMonth) {
  const out = [];
  let totalMonthly = 0;
  for (const pot of pots) {
    const cats = pot.categories || [];
    const monthly = num(pot.monthly_amount);
    totalMonthly += monthly;
    const { spentYtd, spentMonth, byMonth } = spendingFor(cats, variableExpenses, year, monthsElapsed, currentMonth);
    const allocated = round(monthly * monthsElapsed, 2);
    const history = [];
    let cum = 0;
    for (let m = 1; m <= Math.max(monthsElapsed, 1); m++) {
      cum += byMonth[m] || 0;
      history.push({ m, balance: round(monthly * m - cum, 2) });
    }
    out.push({ pot_id: pot.pot_id, name: pot.name ?? null, categories: cats, monthly_amount: round(monthly, 2),
      allocated, spent: round(spentYtd, 2), balance: round(allocated - spentYtd, 2),
      spent_month: round(spentMonth, 2), history });
  }
  return { pots: out, total_monthly: round(totalMonthly, 2) };
}

export function computeGoalsSummary(pots, projectItems, variableExpenses, year, monthsElapsed, currentMonth, avgMonthlyOver, today) {
  const t = todayParts(today);
  const out = [];
  let totalMonthly = 0, savingsPlannedMonthly = 0;
  const contribByMonth = {};
  for (const pot of pots) {
    const cats = pot.categories || [];
    const monthly = num(pot.monthly_amount);
    const already = num(pot.already_saved);
    const contributions = pot.contributions || {};
    totalMonthly += monthly;
    let manual = pot.manual_contribution;
    if (manual === undefined || manual === null) manual = !cats.length;
    const { spentYtd, spentMonth, byMonth } = spendingFor(cats, variableExpenses, year, monthsElapsed, currentMonth);
    const contribByM = {};
    for (const [mk, mv] of Object.entries(contributions)) {
      if (String(mk).slice(0, 4) === String(year)) {
        const mm = parseInt(String(mk).slice(5, 7), 10);
        const val = num(mv);
        contribByM[mm] = (contribByM[mm] || 0) + val;
        if (manual) contribByMonth[mk] = round((contribByMonth[mk] || 0) + val, 2);
      }
    }
    const contribYtd = round(Object.entries(contribByM).filter(([m]) => +m <= monthsElapsed).reduce((s, [, v]) => s + v, 0), 2);
    const contributedThisMonth = round(contribByM[currentMonth] || 0, 2);
    let allocated;
    if (manual) { allocated = contribYtd; savingsPlannedMonthly += monthly; }
    else allocated = round(monthly * monthsElapsed, 2);
    const balance = round(already + allocated - spentYtd, 2);
    const history = [];
    let cumC = 0, cumS = 0;
    for (let m = 1; m <= Math.max(monthsElapsed, 1); m++) {
      cumS += byMonth[m] || 0;
      cumC = manual ? cumC + (contribByM[m] || 0) : monthly * m;
      history.push({ m, balance: round(already + cumC - cumS, 2) });
    }
    const items = projectItems.filter((i) => i.project_id === pot.pot_id);
    const totalCost = round(items.reduce((s, i) => s + num(i.amount), 0), 2);
    const targetDate = pot.target_date ?? null;
    const hasTarget = items.length > 0 || !!targetDate;
    const goal = {
      pot_id: pot.pot_id, name: pot.name ?? null, categories: cats, monthly_amount: round(monthly, 2),
      already_saved: round(already, 2), allocated: round(allocated, 2), spent: round(spentYtd, 2),
      spent_month: round(spentMonth, 2), balance, history, note: pot.note ?? "", has_target: hasTarget,
      target_date: targetDate, items, total_cost: totalCost, completed: false, date_passed: false,
      priority: pot.priority ?? null, completed_at: pot.completed_at ?? null, funded_by: pot.funded_by || "joint",
      is_saving: !cats.length, manual_contribution: !!manual, contributed_this_month: contributedThisMonth,
      confirmed_this_month: contributedThisMonth > 0.005, needs_contribution: !!manual && monthly > 0,
    };
    if (hasTarget) {
      const td = parseDate(targetDate);
      const monthsLeft = td ? Math.max((td.y - t.y) * 12 + (td.m - t.m), 1) : 12;
      const remaining = Math.max(totalCost - balance, 0);
      const required = round(remaining / monthsLeft, 2);
      Object.assign(goal, {
        months_left: monthsLeft, remaining: round(remaining, 2), required_monthly: required,
        feasible: required <= avgMonthlyOver,
        progress: totalCost > 0 ? round((balance / totalCost) * 100, 1) : 0,
        completed: totalCost > 0 && balance >= totalCost - 0.005,
        date_passed: !!(td && key(td) < key(t)),
      });
    }
    if (goal.completed) goal.needs_contribution = false;
    out.push(goal);
  }
  return {
    goals: out, total_monthly: round(totalMonthly, 2), savings_planned_monthly: round(savingsPlannedMonthly, 2),
    contrib_by_month: Object.fromEntries(Object.entries(contribByMonth).map(([k, v]) => [k, round(v, 2)])),
  };
}
