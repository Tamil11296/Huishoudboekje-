"""Rekenregels getoetst aan vaste, met de hand/Excel gecontroleerde uitkomsten."""
import calc
from tests.fixture_v5 import FIXED, INCOMES, VARIABLE

PERSONS = [{"person_id": "R", "name": "Robeson"}, {"person_id": "M", "name": "Miraja"}]


def _dashboard():
    fixed = [{"category": c, "description": d, "amount": a, "frequency": f, "start_date": s,
              "end_date": e, "paid_by": p} for c, d, a, f, s, e, p in FIXED]
    incomes = [{"person_id": p, "amount": a, "frequency": "maandelijks", "start_date": s}
               for p, a, s in INCOMES]
    variable = [{"category": c, "amount": a, "month": m, "paid_by": p} for c, a, m, p in VARIABLE]
    return calc.compute_dashboard({"persons": PERSONS, "split_rule": "income"},
                                  incomes, fixed, variable, 2026)


def test_dashboard_matches_excel_v5():
    d = _dashboard()
    # maand: (samen over, Robeson over, Miraja over) — uit tabblad 'Per persoon' van v5
    expected = {9: (1985.89, 1398.10, 587.79), 10: (1196.53, 568.74, 627.79),
                11: (2164.00, 568.74, 1595.26), 12: (2164.00, 568.74, 1595.26)}
    for m, (over, r, mi) in expected.items():
        mo = d["months"][m - 1]
        assert round(mo["over"], 2) == over, m
        assert mo["per_person"]["R"]["net"] == r, m
        assert mo["per_person"]["M"]["net"] == mi, m
    assert d["months"][9]["income"] == 8075.74
    assert d["months"][9]["expenses"] == 6879.21


def test_yearly_item_only_in_its_month():
    e = {"amount": 218.52, "frequency": "jaarlijks", "start_date": "2026-01-26"}
    assert calc.month_amount(e, 2026, 1) == 218.52
    assert calc.month_amount(e, 2026, 2) == 0
    assert calc.month_amount(e, 2027, 1) == 218.52


def test_start_on_last_days_of_month_counts_that_month():
    for day in (29, 30, 31):
        e = {"amount": 100, "frequency": "maandelijks", "start_date": f"2026-10-{day}"}
        assert calc.month_amount(e, 2026, 10) == 100, day
    e = {"amount": 100, "frequency": "maandelijks", "start_date": "2026-02-28"}
    assert calc.month_amount(e, 2026, 2) == 100


def test_end_date_excludes_following_months():
    e = {"amount": 967.47, "frequency": "maandelijks", "start_date": "2026-01-01", "end_date": "2026-10-31"}
    assert calc.month_amount(e, 2026, 10) == 967.47
    assert calc.month_amount(e, 2026, 11) == 0


# ---------- bouwdepot ----------
DEPOT = {"bouwdepot_id": "D", "start_amount": 100251.02, "end_date": "2027-01-09"}
POSTS = [{"bouwpost_id": "T", "name": "Tuin", "budget": 0, "bouwdepot_id": "D"}]


def q(iid, amt, **k):
    return {"invoice_id": iid, "type": "offerte", "status": "geaccepteerd", "amount_incl_vat": amt,
            "bouwpost_id": "T", "bouwdepot_id": "D", **k}


BASE = [q("q2", 41232.0), q("q3", 10580.46)]


def _sum(inv):
    return calc.compute_bouwdepot_summary(DEPOT, POSTS, inv)


def test_termijn_as_separate_invoice():
    inv = [q("q1", 39083.0)] + BASE + [{"invoice_id": "f1", "type": "factuur", "parent_quote_id": "q1",
                                         "invoice_amount": 11724.90, "submitted_to_bank": True,
                                         "bouwpost_id": "T", "bouwdepot_id": "D"}]
    s = _sum(inv)
    assert s["freely_available"] == 9355.56
    assert s["controle"] == 0


def test_termijn_on_quote_row_does_not_drop_remaining_quote():
    """Bug in de Emergent-versie: dit gaf € 36.713,66 vrij."""
    inv = [q("q1", 39083.0, invoice_amount=11724.90, submitted_to_bank=True)] + BASE
    s = _sum(inv)
    assert s["freely_available"] == 9355.56
    assert s["controle"] == 0


def test_loose_invoice_not_yet_submitted_is_committed():
    inv = [q("q1", 39083.0, invoice_amount=11724.90, submitted_to_bank=True)] + BASE + [
        {"invoice_id": "b1", "type": "factuur", "invoice_amount": 500, "bouwpost_id": "T", "bouwdepot_id": "D"}]
    s = _sum(inv)
    assert s["freely_available"] == 8855.56
    assert s["controle"] == 0


def test_paid_termijn_moves_from_submitted_to_paid():
    inv = [q("q1", 39083.0)] + BASE + [{"invoice_id": "f1", "type": "factuur", "parent_quote_id": "q1",
                                         "invoice_amount": 11724.90, "submitted_to_bank": True,
                                         "paid_on": "2026-10-01", "bouwpost_id": "T", "bouwdepot_id": "D"}]
    s = _sum(inv)
    assert s["paid_out"] == 11724.90 and s["submitted_not_paid"] == 0
    assert s["freely_available"] == 9355.56


def test_controle_flags_invoice_without_bouwpost():
    inv = [q("q1", 39083.0)] + BASE + [{"invoice_id": "b1", "type": "factuur", "invoice_amount": 500,
                                         "bouwdepot_id": "D"}]
    s = _sum(inv)
    assert s["controle"] == -500.0
    assert not s["reconciled"]


def test_overdrawn_depot_is_flagged():
    inv = [q("q1", 39083.0)] + BASE + [q("q4", 10520.95)]
    s = _sum(inv)
    # Kantoorofferte erbij accepteren: € 1.165,39 tekort (zoals eerder uit Excel bleek)
    assert s["freely_available"] == -1165.39
    assert any(c["code"] == "depot_overdrawn" for c in s["checks"])
