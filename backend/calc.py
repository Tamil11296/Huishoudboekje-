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
    months = []
    cumulative = 0.0
    annual = {"income": 0, "fixed": 0, "variable": 0, "expenses": 0, "over": 0}
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
    for pid in per_person_year:
        for k in per_person_year[pid]:
            per_person_year[pid][k] = round(per_person_year[pid][k], 2)

    return {"year": year, "months": months, "annual": annual,
            "per_person_year": per_person_year, "persons": persons,
            "split_rule": rule}


def compute_bouwpost_rollup(bp, invoices):
    rows = [i for i in invoices if i.get("bouwpost_id") == bp["bouwpost_id"]]
    accepted_quotes = sum(float(i.get("amount_incl_vat") or 0) for i in rows
                          if i.get("type") == "offerte" and i.get("status") == "geaccepteerd")
    invoiced = sum(float(i.get("invoice_amount") or 0) for i in rows if i.get("invoice_amount"))
    paid = sum(float(i.get("invoice_amount") or 0) for i in rows if i.get("paid_on"))
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
    paid_out = sum(float(i.get("invoice_amount") or 0) for i in depot_invoices if i.get("paid_on"))
    submitted_not_paid = sum(float(i.get("invoice_amount") or 0) for i in depot_invoices
                             if i.get("submitted_to_bank") and not i.get("paid_on"))

    posts = [compute_bouwpost_rollup(bp, depot_invoices) for bp in bouwposten
             if bp.get("bouwdepot_id") == depot["bouwdepot_id"]]
    # still to submit = accepted work not yet invoiced/submitted
    still_to_submit = 0.0
    for i in depot_invoices:
        if i.get("type") == "offerte" and i.get("status") == "geaccepteerd" and not i.get("invoice_amount"):
            still_to_submit += float(i.get("amount_incl_vat") or 0)

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
        if p["commitment"] > p["budget"] + 0.005:
            checks.append({"level": "warning", "code": "budget_overrun",
                           "message": f"Bouwpost '{p['name']}' overschrijdt budget met €{round(p['commitment'] - p['budget'], 2)}."})
    if freely_available < -0.005:
        checks.append({"level": "error", "code": "depot_overdrawn",
                       "message": f"Verplichtingen overschrijden het bouwdepot met €{round(-freely_available, 2)}."})

    controle = round(start - paid_out - submitted_not_paid - still_to_submit - freely_available, 2)

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
    }
