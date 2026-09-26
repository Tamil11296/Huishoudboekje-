"""Backend tests for iteration 4 refinements:
- Pot history sparkline series in pots-summary
- Dashboard category_items map + per_person net in months
- Bouwdepot termijn_due / termijn_overdue reminders
"""
import os
import datetime as dt
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
OWNER_EMAIL = "robeson.constantine@gmail.com"
OWNER_PASSWORD = "Bouwdepot2026!"


@pytest.fixture(scope="module")
def owner():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def hid(owner):
    hhs = owner.get(f"{API}/households", timeout=30).json()
    demo = next((h for h in hhs if h.get("name") == "Huize Constantine"), hhs[0])
    return demo["household_id"]


# ---- Pot history sparkline ----
class TestPotHistory:
    def test_pots_summary_has_history_per_pot(self, owner, hid):
        r = owner.get(f"{API}/households/{hid}/pots-summary", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["pots"], "no pots in summary"
        for p in data["pots"]:
            assert "history" in p, f"pot {p.get('name')} missing history"
            hist = p["history"]
            assert isinstance(hist, list) and len(hist) >= 1, f"empty history for {p.get('name')}"
            for pt in hist:
                assert "m" in pt and "balance" in pt, f"bad hist point: {pt}"
                assert isinstance(pt["balance"], (int, float))


# ---- Dashboard category_items + per_person net ----
class TestDashboardRefinements:
    def test_dashboard_has_category_items_and_per_person(self, owner, hid):
        r = owner.get(f"{API}/households/{hid}/dashboard", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "category_items" in data, "missing category_items"
        cat_items = data["category_items"]
        assert isinstance(cat_items, dict) and len(cat_items) > 0
        # every category value must be a list of {description, amount}
        for cat, items in cat_items.items():
            assert isinstance(items, list)
            for it in items:
                assert "description" in it and "amount" in it, it
        # months per_person
        assert "months" in data and isinstance(data["months"], list) and len(data["months"]) >= 1
        m0 = data["months"][0]
        assert "per_person" in m0, f"month missing per_person: {m0}"
        pp = m0["per_person"]
        assert isinstance(pp, dict) and len(pp) >= 1
        for pid, vals in pp.items():
            assert "net" in vals, f"per_person entry missing net: {vals}"
            assert isinstance(vals["net"], (int, float))


# ---- Termijn reminders (due / overdue) ----
class TestTermijnReminders:
    def _get_ctx(self, owner, hid):
        s = owner.get(f"{API}/households/{hid}/bouwdepot-summary", timeout=30).json()
        depot_id = s["depots"][0]["bouwdepot_id"]
        bp_id = s["bouwposten"][0]["bouwpost_id"]
        # server "today" is ~2026-09 per problem statement; use a real anchor
        today = dt.date(2026, 9, 15)
        return depot_id, bp_id, today

    def test_termijn_due_warning(self, owner, hid):
        depot_id, bp_id, today = self._get_ctx(owner, hid)
        # use real server today for due-date math
        today = dt.date.today()
        due = (today + dt.timedelta(days=5)).isoformat()
        q = owner.post(f"{API}/households/{hid}/invoices",
                       json={"supplier": "TEST_quote_due", "bouwpost_id": bp_id, "bouwdepot_id": depot_id,
                             "type": "offerte", "amount_incl_vat": 5000, "status": "geaccepteerd",
                             "description": "TEST_offerte_due_marker"}, timeout=30)
        assert q.status_code == 200, q.text
        qid = q.json()["invoice_id"]
        fid = None
        try:
            f = owner.post(f"{API}/households/{hid}/invoices",
                           json={"supplier": "TEST_quote_due", "bouwpost_id": bp_id, "bouwdepot_id": depot_id,
                                 "type": "factuur", "parent_quote_id": qid, "termijn": 1,
                                 "invoice_amount": 2000, "paid_amount": 0,
                                 "due_date": due, "status": "accepted", "submitted_to_bank": False,
                                 "description": "TEST_termijn_due_marker"}, timeout=30)
            assert f.status_code == 200, f.text
            fid = f.json()["invoice_id"]

            s2 = owner.get(f"{API}/households/{hid}/bouwdepot-summary", timeout=30).json()
            codes = []
            for d in s2.get("depots", []):
                for c in d.get("checks", []):
                    codes.append(c.get("code"))
            assert "termijn_due" in codes, f"termijn_due not in checks codes={codes}"
        finally:
            if fid: owner.delete(f"{API}/households/{hid}/invoices/{fid}", timeout=30)
            owner.delete(f"{API}/households/{hid}/invoices/{qid}", timeout=30)

    def test_termijn_overdue_error(self, owner, hid):
        depot_id, bp_id, today = self._get_ctx(owner, hid)
        today = dt.date.today()
        past = (today - dt.timedelta(days=10)).isoformat()
        q = owner.post(f"{API}/households/{hid}/invoices",
                       json={"supplier": "TEST_quote_over", "bouwpost_id": bp_id, "bouwdepot_id": depot_id,
                             "type": "offerte", "amount_incl_vat": 5000, "status": "geaccepteerd",
                             "description": "TEST_offerte_over_marker"}, timeout=30)
        qid = q.json()["invoice_id"]
        fid = None
        try:
            f = owner.post(f"{API}/households/{hid}/invoices",
                           json={"supplier": "TEST_quote_over", "bouwpost_id": bp_id, "bouwdepot_id": depot_id,
                                 "type": "factuur", "parent_quote_id": qid, "termijn": 2,
                                 "invoice_amount": 2000, "paid_amount": 0,
                                 "due_date": past, "status": "accepted", "submitted_to_bank": False,
                                 "description": "TEST_termijn_overdue_marker"}, timeout=30)
            assert f.status_code == 200, f.text
            fid = f.json()["invoice_id"]
            s2 = owner.get(f"{API}/households/{hid}/bouwdepot-summary", timeout=30).json()
            codes = []
            for d in s2.get("depots", []):
                for c in d.get("checks", []):
                    codes.append(c.get("code"))
            assert "termijn_overdue" in codes, f"termijn_overdue not in checks codes={codes}"
        finally:
            if fid: owner.delete(f"{API}/households/{hid}/invoices/{fid}", timeout=30)
            owner.delete(f"{API}/households/{hid}/invoices/{qid}", timeout=30)
