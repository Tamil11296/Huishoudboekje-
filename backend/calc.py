"""Pure calculation helpers for budget projections, per-person split and bouwdepot rollups."""
from datetime import date, datetime, timezone

MONTHS_NL = ["", "Januari", "Februari", "Maart", "April", "Mei", "Juni",
             "Juli", "Augustus", "September", "Oktober", "November", "December"]


def _parse(d):
    if not d:
        return None
    if isinstance(d, (datetime, date)):
        return date(d.year, d.month, d.day)
    try:
        return date.fromisoformat(str(d)[:10])
    except Exception:
        return None


def month_amount(entry: dict, year: int, month: int) -> float:
    """Amount attributable to a given month for a fixed income/expense entry."""
    amount = float(entry.get("amount") or 0)
    freq = entry.get("frequency", "maandelijks")
    start = _parse(entry.get("start_date"))
    end = _parse(entry.get("end_date"))
    m_start = date(year, month, 1)
    m_end = date(year, month, 28)

    if start and start > m_end:
        return 0.0
    if end and end < m_start:
        return 0.0

    if freq == "maandelijks":
        return amount
    if freq == "wekelijks":
        return round(amount * 52 / 12, 2)
    if freq == "eenmalig":
        if start and start.year == year and start.month == month:
            return amount
        return 0.0

    ref_month = start.month if start else 1
    diff = (month - ref_month) % 12
    if freq == "jaarlijks":
        return amount if diff == 0 else 0.0
    if freq == "halfjaarlijks":
        return amount if diff % 6 == 0 else 0.0
    if freq == "per_kwartaal":
        return amount if diff % 3 == 0 else 0.0
    return amount


def month_status(year: int, month: int) -> str:
    now = datetime.now(timezone.utc)
    if year < now.year or (year == now.year and month < now.month):
        return "afgesloten"
    if year == now.year and month == now.month:
        return "lopend"
    return "prognose"


def split_ratios(persons, income_by_person, rule):
    """Return {person_id: ratio} for splitting joint costs."""
    ids = [p["person_id"] for p in persons]
    if not ids:
        return {}
    if rule == "income":
        total = sum(income_by_person.get(pid, 0) for pid in ids)
        if total > 0:
            return {pid: income_by_person.get(pid, 0) / total for pid in ids}
    # default 50/50 (equal)
    return {pid: 1 / len(ids) for pid in ids}


def compute_dashboard(household, incomes, fixed_expenses, variable_expenses, year):
    persons = household.get("persons", [])
    rule = household.get("split_rule", "5050")
    now = datetime.now(timezone.utc)
    cur_month = now.month if year == now.year else (12 if year < now.year else 0)
    months = []
    cumulative = 0.0
    annual = {"income": 0, "fixed": 0, "variable": 0, "expenses": 0, "over": 0}
    expense_by_category = {}
    cur_month_cat = {}
    cat_items = {}
    per_person_year = {p["person_id"]: {"income": 0, "own": 0, "joint_share": 0, "net": 0}
                       for p in persons}

    for m in range(1, 13):
        income_by_person = {p["person_id"]: 0.0 for p in persons}
        income_total = 0.0
        for inc in incomes:
            amt = month_amount(inc, year, m)
            if amt:
                pid = inc.get("person_id")
                if pid in income_by_person:
                    income_by_person[pid] += amt
                income_total += amt

        fixed_total = 0.0
        joint_expense = 0.0
        own_expense = {p["person_id"]: 0.0 for p in persons}
        for ex in fixed_expenses:
            amt = month_amount(ex, year, m)
            if not amt:
                continue
            fixed_total += amt
            _cat = ex.get("category") or "Overig"
            expense_by_category[_cat] = expense_by_category.get(_cat, 0) + amt
            if m == cur_month:
                cur_month_cat[_cat] = cur_month_cat.get(_cat, 0) + amt
            _desc = ex.get("description") or _cat
            cat_items.setdefault(_cat, {})
            cat_items[_cat][_desc] = cat_items[_cat].get(_desc, 0) + amt
            pb = ex.get("paid_by", "joint")
            if pb in own_expense:
                own_expense[pb] += amt
            else:
                joint_expense += amt

        variable_total = 0.0
        ym = f"{year}-{m:02d}"
        for ve in variable_expenses:
            if str(ve.get("month", ""))[:7] != ym:
                continue
            amt = float(ve.get("amount") or 0)
            variable_total += amt
            _cat = ve.get("category") or "Overig"
            expense_by_category[_cat] = expense_by_category.get(_cat, 0) + amt
            if m == cur_month:
                cur_month_cat[_cat] = cur_month_cat.get(_cat, 0) + amt
            _desc = ve.get("description") or _cat
            cat_items.setdefault(_cat, {})
            cat_items[_cat][_desc] = cat_items[_cat].get(_desc, 0) + amt
            pb = ve.get("paid_by", "joint")
            if pb in own_expense:
                own_expense[pb] += amt
            else:
                joint_expense += amt

        expenses_total = fixed_total + variable_total
        over = income_total - expenses_total
        cumulative += over
        savings_rate = round((over / income_total) * 100, 1) if income_total > 0 else 0.0

        ratios = split_ratios(persons, income_by_person, rule)
        pp = {}
        for p in persons:
            pid = p["person_id"]
            share = joint_expense * ratios.get(pid, 0)
            net = income_by_person[pid] - own_expense[pid] - share
            pp[pid] = {
                "income": round(income_by_person[pid], 2),
                "own": round(own_expense[pid], 2),
                "joint_share": round(share, 2),
                "net": round(net, 2),
            }
            per_person_year[pid]["income"] += income_by_person[pid]
            per_person_year[pid]["own"] += own_expense[pid]
            per_person_year[pid]["joint_share"] += share
            per_person_year[pid]["net"] += net

        months.append({
            "month": m,
            "label": MONTHS_NL[m],
            "status": month_status(year, m),
            "income": round(income_total, 2),
            "fixed": round(fixed_total, 2),
            "variable": round(variable_total, 2),
            "expenses": round(expenses_total, 2),
            "over": round(over, 2),
            "cumulative": round(cumulative, 2),
            "savings_rate": savings_rate,
            "joint_expense": round(joint_expense, 2),
            "per_person": pp,
        })
        annual["income"] += income_total
        annual["fixed"] += fixed_total
        annual["variable"] += variable_total
        annual["expenses"] += expenses_total
        annual["over"] += over

    for k in annual:
        annual[k] = round(annual[k], 2)
    annual["savings_rate"] = round((annual["over"] / annual["income"]) * 100, 1) if annual["income"] > 0 else 0.0
    annual["avg_monthly_over"] = round(annual["over"] / 12, 2)
    for pid in per_person_year:
        for k in per_person_year[pid]:
            per_person_year[pid][k] = round(per_person_year[pid][k], 2)

    return {"year": year, "months": months, "annual": annual,
            "per_person_year": per_person_year, "persons": persons,
            "split_rule": rule,
            "current_month": cur_month,
            "current_month_label": MONTHS_NL[cur_month] if cur_month else "",
            "category_budgets": _category_budget_status(
                household.get("category_budgets", {}), cur_month_cat, expense_by_category),
            "expense_by_category": {k: round(v, 2) for k, v in
                                    sorted(expense_by_category.items(), key=lambda x: -x[1])},
            "category_items": {c: sorted([{"description": d, "amount": round(v, 2)}
                                          for d, v in items.items()], key=lambda x: -x["amount"])
                               for c, items in cat_items.items()}}


def _category_budget_status(category_budgets, cur_month_cat, expense_by_category):
    out = []
    for cat, monthly in (category_budgets or {}).items():
        monthly = float(monthly or 0)
        if monthly <= 0:
            continue
        spent_month = round(cur_month_cat.get(cat, 0), 2)
        spent_year = round(expense_by_category.get(cat, 0), 2)
        annual_budget = round(monthly * 12, 2)
        out.append({
            "category": cat,
            "monthly_budget": round(monthly, 2),
            "annual_budget": annual_budget,
            "spent_month": spent_month,
            "spent_year": spent_year,
            "month_pct": round(spent_month / monthly * 100) if monthly else 0,
            "year_pct": round(spent_year / annual_budget * 100) if annual_budget else 0,
            "over_month": spent_month > monthly + 0.005,
            "over_year": spent_year > annual_budget + 0.005,
        })
    return sorted(out, key=lambda x: -x["month_pct"])


def compute_bouwpost_rollup(bp, invoices):
    rows = [i for i in invoices if i.get("bouwpost_id") == bp["bouwpost_id"]]
    accepted_quotes = sum(float(i.get("amount_incl_vat") or 0) for i in rows
                          if i.get("type") == "offerte" and i.get("status") == "geaccepteerd")
    invoiced = sum(float(i.get("invoice_amount") or 0) for i in rows if i.get("invoice_amount"))
    paid = sum(float(i.get("paid_amount") or i.get("invoice_amount") or 0) for i in rows if i.get("paid_on"))
    budget = float(bp.get("budget") or 0)
    still_to_invoice = max(accepted_quotes - invoiced, 0)
    commitment = invoiced + still_to_invoice
    if commitment < accepted_quotes:
        commitment = accepted_quotes
    return {
        **{k: bp[k] for k in ("bouwpost_id", "name", "category", "bouwdepot_id") if k in bp},
        "budget": round(budget, 2),
        "accepted_quotes": round(accepted_quotes, 2),
        "invoiced": round(invoiced, 2),
        "paid": round(paid, 2),
        "still_to_invoice": round(still_to_invoice, 2),
        "commitment": round(commitment, 2),
        "room": round(budget - commitment, 2),
    }


def compute_bouwdepot_summary(depot, bouwposten, invoices):
    depot_invoices = [i for i in invoices if i.get("bouwdepot_id") == depot["bouwdepot_id"]]
    start = float(depot.get("start_amount") or 0)
    paid_out = sum(float(i.get("paid_amount") or i.get("invoice_amount") or 0) for i in depot_invoices if i.get("paid_on"))
    submitted_not_paid = sum(float(i.get("invoice_amount") or 0) for i in depot_invoices
                             if i.get("submitted_to_bank") and not i.get("paid_on"))

    posts = [compute_bouwpost_rollup(bp, depot_invoices) for bp in bouwposten
             if bp.get("bouwdepot_id") == depot["bouwdepot_id"]]
    # still to submit = accepted work not yet invoiced/submitted.
    # Subtract child term-invoices already submitted/paid so their amount is not
    # double-counted (once here via the quote, once via submitted_not_paid/paid_out).
    child_committed = {}
    for i in depot_invoices:
        if i.get("type") == "factuur" and i.get("parent_quote_id"):
            if i.get("paid_on"):
                amt = float(i.get("paid_amount") or i.get("invoice_amount") or 0)
            elif i.get("submitted_to_bank"):
                amt = float(i.get("invoice_amount") or 0)
            else:
                amt = 0.0
            child_committed[i["parent_quote_id"]] = child_committed.get(i["parent_quote_id"], 0) + amt

    still_to_submit = 0.0
    for i in depot_invoices:
        if i.get("type") == "offerte" and i.get("status") == "geaccepteerd" and not i.get("invoice_amount"):
            remaining = float(i.get("amount_incl_vat") or 0) - child_committed.get(i["invoice_id"], 0)
            still_to_submit += max(remaining, 0)

    balance_after_pending = start - paid_out - submitted_not_paid
    freely_available = balance_after_pending - still_to_submit

    end = _parse(depot.get("end_date"))
    days_remaining = (end - date.today()).days if end else None

    # Control checks
    checks = []
    valid_post_ids = {bp["bouwpost_id"] for bp in bouwposten}
    for i in depot_invoices:
        if i.get("bouwpost_id") and i["bouwpost_id"] not in valid_post_ids:
            checks.append({"level": "error", "code": "invoice_no_bouwpost",
                           "message": f"Factuur '{i.get('supplier', '?')}' verwijst naar een onbekende bouwpost."})
        if not i.get("bouwpost_id"):
            checks.append({"level": "error", "code": "invoice_no_bouwpost",
                           "message": f"Factuur/offerte '{i.get('supplier', '?')}' heeft geen bouwpost."})
    for p in posts:
        if p["budget"] > 0 and p["commitment"] > p["budget"] + 0.005:
            checks.append({"level": "error", "code": "budget_overrun",
                           "message": f"Bouwpost '{p['name']}' overschrijdt budget met €{round(p['commitment'] - p['budget'], 2)}."})
        elif p["budget"] > 0 and p["commitment"] >= p["budget"] * 0.9:
            checks.append({"level": "warning", "code": "budget_near",
                           "message": f"Bouwpost '{p['name']}' nadert het budget ({round(p['commitment'] / p['budget'] * 100)}%)."})
    if freely_available < -0.005:
        checks.append({"level": "error", "code": "depot_overdrawn",
                       "message": f"Verplichtingen overschrijden het bouwdepot met €{round(-freely_available, 2)}."})
    elif start > 0 and freely_available < start * 0.1:
        checks.append({"level": "warning", "code": "depot_low",
                       "message": f"Bijna leeg: nog maar €{round(freely_available, 2)} vrij besteedbaar in het bouwdepot."})
    for i in depot_invoices:
        if i.get("type") == "factuur" and i.get("due_date") and not i.get("paid_on"):
            due = _parse(i.get("due_date"))
            if not due:
                continue
            days = (due - date.today()).days
            if days < 0:
                checks.append({"level": "error", "code": "termijn_overdue",
                               "message": f"Termijn van '{i.get('supplier', '?')}' is {-days} dagen over de vervaldatum en nog niet betaald."})
            elif days <= 14 and not i.get("submitted_to_bank"):
                checks.append({"level": "warning", "code": "termijn_due",
                               "message": f"Termijn van '{i.get('supplier', '?')}' vervalt over {days} dagen en is nog niet ingediend bij de bank."})
            elif days <= 7:
                checks.append({"level": "warning", "code": "termijn_due",
                               "message": f"Termijn van '{i.get('supplier', '?')}' vervalt over {days} dagen."})

    controle = round(start - paid_out - submitted_not_paid - still_to_submit - freely_available, 2)
    timeline = _build_timeline(depot, depot_invoices, start, paid_out,
                               submitted_not_paid, still_to_submit)

    return {
        "bouwdepot_id": depot["bouwdepot_id"],
        "name": depot.get("name"),
        "start_amount": round(start, 2),
        "paid_out": round(paid_out, 2),
        "submitted_not_paid": round(submitted_not_paid, 2),
        "still_to_submit": round(still_to_submit, 2),
        "balance_after_pending": round(balance_after_pending, 2),
        "freely_available": round(freely_available, 2),
        "end_date": depot.get("end_date"),
        "days_remaining": days_remaining,
        "total_budget": round(sum(p["budget"] for p in posts), 2),
        "total_commitment": round(sum(p["commitment"] for p in posts), 2),
        "posts": posts,
        "checks": checks,
        "reconciled": len([c for c in checks if c["level"] == "error"]) == 0,
        "controle": controle,
        "timeline": timeline,
    }


def _build_timeline(depot, invoices, start, paid_out, submitted_not_paid, still_to_submit):
    start_date = _parse(depot.get("start_date")) or date.today()
    end_date = _parse(depot.get("end_date"))
    today = date.today()
    paid = sorted([(_parse(i.get("paid_on")), float(i.get("paid_amount") or i.get("invoice_amount") or 0))
                   for i in invoices if i.get("paid_on") and _parse(i.get("paid_on"))],
                  key=lambda x: x[0])
    pts = {}
    bal = start
    pts[start_date.isoformat()] = {"date": start_date.isoformat(), "actual": round(bal, 2), "forecast": None}
    for d, amt in paid:
        bal -= amt
        pts[d.isoformat()] = {"date": d.isoformat(), "actual": round(bal, 2), "forecast": None}
    actual_today = round(start - paid_out, 2)
    tk = today.isoformat()
    if tk not in pts:
        pts[tk] = {"date": tk, "actual": actual_today, "forecast": actual_today}
    else:
        pts[tk]["forecast"] = actual_today
    if end_date and end_date > today:
        final = round(actual_today - submitted_not_paid - still_to_submit, 2)
        pts[end_date.isoformat()] = {"date": end_date.isoformat(), "actual": None, "forecast": final}
    return [pts[k] for k in sorted(pts.keys())]


def compute_projects_summary(projects, items, avg_monthly_over):
    today = date.today()
    out = []
    for pr in projects:
        pitems = [i for i in items if i.get("project_id") == pr["project_id"]]
        total = sum(float(i.get("amount") or 0) for i in pitems)
        saved = float(pr.get("already_saved") or 0)
        remaining = max(total - saved, 0)
        td = _parse(pr.get("target_date"))
        months_left = max((td.year - today.year) * 12 + (td.month - today.month), 1) if td else 12
        required = round(remaining / months_left, 2)
        out.append({
            "project_id": pr["project_id"], "name": pr.get("name"),
            "target_date": pr.get("target_date"),
            "total_cost": round(total, 2), "already_saved": round(saved, 2),
            "remaining": round(remaining, 2), "months_left": months_left,
            "required_monthly": required, "item_count": len(pitems), "items": pitems,
            "feasible": required <= avg_monthly_over,
            "avg_monthly_over": round(avg_monthly_over, 2),
        })
    return out


def compute_pots_summary(pots, variable_expenses, year, months_elapsed, current_month):
    """Envelope-style pots with carryover: allocated (monthly x months elapsed) minus spending
    in linked categories = rolling balance."""
    out = []
    total_monthly = 0.0
    for pot in pots:
        cats = pot.get("categories") or []
        monthly = float(pot.get("monthly_amount") or 0)
        total_monthly += monthly
        spent_ytd = 0.0
        spent_month = 0.0
        spent_by_month = {}
        for ve in variable_expenses:
            if ve.get("category") in cats and str(ve.get("month", ""))[:4] == str(year):
                mm = int(str(ve["month"])[5:7])
                amt = float(ve.get("amount") or 0)
                spent_by_month[mm] = spent_by_month.get(mm, 0) + amt
                if mm <= months_elapsed:
                    spent_ytd += amt
                if mm == current_month:
                    spent_month += amt
        allocated = round(monthly * months_elapsed, 2)
        history = []
        cum_spent = 0.0
        for m in range(1, max(months_elapsed, 1) + 1):
            cum_spent += spent_by_month.get(m, 0)
            history.append({"m": m, "balance": round(monthly * m - cum_spent, 2)})
        out.append({
            "pot_id": pot["pot_id"], "name": pot.get("name"), "categories": cats,
            "monthly_amount": round(monthly, 2), "allocated": allocated,
            "spent": round(spent_ytd, 2), "balance": round(allocated - spent_ytd, 2),
            "spent_month": round(spent_month, 2), "history": history,
        })
    return {"pots": out, "total_monthly": round(total_monthly, 2)}
