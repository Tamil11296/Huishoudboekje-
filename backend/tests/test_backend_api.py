"""Backend API tests for Huishoudbudget & Bouwdepot."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://budget-reno-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "robeson.constantine@gmail.com"
OWNER_PASSWORD = "Bouwdepot2026!"


@pytest.fixture(scope="module")
def owner_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def owner_hid(owner_session):
    r = owner_session.get(f"{API}/households", timeout=30)
    assert r.status_code == 200
    hhs = r.json()
    assert len(hhs) >= 1
    # find demo
    demo = next((h for h in hhs if h.get("name") == "Huize Constantine"), hhs[0])
    return demo["household_id"]


# ---------- auth ----------
class TestAuth:
    def test_login_success(self, owner_session):
        r = owner_session.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == OWNER_EMAIL

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": "wrong"}, timeout=30)
        assert r.status_code == 401

    def test_register_new_user(self):
        email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        s = requests.Session()
        r = s.post(f"{API}/auth/register", json={"email": email, "password": "Passw0rd!", "name": "Test User"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["email"] == email
        # verify session
        me = s.get(f"{API}/auth/me", timeout=30)
        assert me.status_code == 200
        # no household => empty
        hhs = s.get(f"{API}/households", timeout=30).json()
        assert isinstance(hhs, list)
        assert len(hhs) == 0

    def test_register_duplicate(self):
        r = requests.post(f"{API}/auth/register", json={"email": OWNER_EMAIL, "password": "x", "name": "x"}, timeout=30)
        assert r.status_code == 400

    def test_unauthenticated_me(self):
        r = requests.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 401


# ---------- households ----------
class TestHouseholds:
    def test_list_households(self, owner_session):
        r = owner_session.get(f"{API}/households", timeout=30)
        assert r.status_code == 200
        assert any(h["name"] == "Huize Constantine" for h in r.json())

    def test_create_new_household(self):
        email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        s = requests.Session()
        s.post(f"{API}/auth/register", json={"email": email, "password": "Passw0rd!", "name": "New User"}, timeout=30)
        r = s.post(f"{API}/households", json={"name": "TEST_Household", "split_rule": "5050"}, timeout=30)
        assert r.status_code == 200, r.text
        hh = r.json()
        assert hh["name"] == "TEST_Household"
        assert hh["owner_id"]
        # cleanup
        s.delete(f"{API}/households/{hh['household_id']}", timeout=30)


# ---------- dashboard ----------
class TestDashboard:
    def test_dashboard_2026(self, owner_session, owner_hid):
        r = owner_session.get(f"{API}/households/{owner_hid}/dashboard", params={"year": 2026}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        # must include annual totals
        assert "annual" in data or "totals" in data or "months" in data
        # Check for non-empty structure
        assert isinstance(data, dict)

    def test_bouwdepot_summary(self, owner_session, owner_hid):
        r = owner_session.get(f"{API}/households/{owner_hid}/bouwdepot-summary", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "depots" in data
        assert len(data["depots"]) >= 1
        d = data["depots"][0]
        # 6 metrics expected
        for key in ["start_amount", "paid_out", "submitted_not_paid", "still_to_submit", "freely_available", "days_remaining"]:
            assert key in d, f"missing {key} in bouwdepot summary; keys: {list(d.keys())}"


# ---------- CRUD ----------
class TestCRUD:
    def test_income_crud(self, owner_session, owner_hid):
        # create
        payload = {"person_id": "prs_test", "source": "TEST_income", "amount": 1000,
                   "frequency": "monthly", "start_date": "2026-01-01", "end_date": None}
        r = owner_session.post(f"{API}/households/{owner_hid}/incomes", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        item = r.json()
        iid = item["income_id"]
        assert item["source"] == "TEST_income"
        # list
        lst = owner_session.get(f"{API}/households/{owner_hid}/incomes", timeout=30).json()
        assert any(x["income_id"] == iid for x in lst)
        # update
        u = owner_session.put(f"{API}/households/{owner_hid}/incomes/{iid}", json={"amount": 1500}, timeout=30)
        assert u.status_code == 200
        assert u.json()["amount"] == 1500
        # delete
        d = owner_session.delete(f"{API}/households/{owner_hid}/incomes/{iid}", timeout=30)
        assert d.status_code == 200

    def test_fixed_expense_crud(self, owner_session, owner_hid):
        payload = {"category": "Energie", "description": "TEST_fixed", "amount": 100,
                   "frequency": "monthly", "start_date": "2026-01-01", "end_date": None, "paid_by": "shared"}
        r = owner_session.post(f"{API}/households/{owner_hid}/fixed-expenses", json=payload, timeout=30)
        assert r.status_code == 200
        iid = r.json()["item_id"]
        owner_session.delete(f"{API}/households/{owner_hid}/fixed-expenses/{iid}", timeout=30)

    def test_variable_expense_crud(self, owner_session, owner_hid):
        payload = {"category": "Boodschappen", "description": "TEST_var", "amount": 50,
                   "month": "2026-06", "paid_by": "shared"}
        r = owner_session.post(f"{API}/households/{owner_hid}/variable-expenses", json=payload, timeout=30)
        assert r.status_code == 200
        iid = r.json()["item_id"]
        owner_session.delete(f"{API}/households/{owner_hid}/variable-expenses/{iid}", timeout=30)

    def test_bouwpost_and_invoice(self, owner_session, owner_hid):
        # get first depot
        summary = owner_session.get(f"{API}/households/{owner_hid}/bouwdepot-summary", timeout=30).json()
        depot_id = summary["depots"][0]["bouwdepot_id"]
        bp = owner_session.post(f"{API}/households/{owner_hid}/bouwposten",
                                json={"name": "TEST_bp", "category": "Keuken", "budget": 5000,
                                      "bouwdepot_id": depot_id}, timeout=30)
        assert bp.status_code == 200
        bp_id = bp.json()["bouwpost_id"]

        inv = owner_session.post(f"{API}/households/{owner_hid}/invoices",
                                 json={"supplier": "TEST_sup", "bouwpost_id": bp_id, "bouwdepot_id": depot_id,
                                       "type": "invoice", "amount_incl_vat": 100, "status": "paid",
                                       "invoice_amount": 100, "submitted_to_bank": True,
                                       "description": "TEST"}, timeout=30)
        assert inv.status_code == 200
        inv_id = inv.json()["invoice_id"]

        # cleanup
        owner_session.delete(f"{API}/households/{owner_hid}/invoices/{inv_id}", timeout=30)
        owner_session.delete(f"{API}/households/{owner_hid}/bouwposten/{bp_id}", timeout=30)


# ---------- settings ----------
class TestSettings:
    def test_add_remove_person(self, owner_session, owner_hid):
        r = owner_session.post(f"{API}/households/{owner_hid}/persons", json={"name": "TEST_person"}, timeout=30)
        assert r.status_code == 200
        persons = r.json()["persons"]
        p = next(x for x in persons if x["name"] == "TEST_person")
        d = owner_session.delete(f"{API}/households/{owner_hid}/persons/{p['person_id']}", timeout=30)
        assert d.status_code == 200

    def test_add_remove_category(self, owner_session, owner_hid):
        r = owner_session.post(f"{API}/households/{owner_hid}/categories",
                               json={"type": "income", "name": "TEST_cat"}, timeout=30)
        assert r.status_code == 200
        assert "TEST_cat" in r.json()["categories"]["income"]
        d = owner_session.delete(f"{API}/households/{owner_hid}/categories",
                                 params={"type": "income", "name": "TEST_cat"}, timeout=30)
        assert d.status_code == 200

    def test_update_split_rule(self, owner_session, owner_hid):
        r = owner_session.patch(f"{API}/households/{owner_hid}", json={"split_rule": "income"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["split_rule"] == "income"
        owner_session.patch(f"{API}/households/{owner_hid}", json={"split_rule": "5050"}, timeout=30)

    def test_changelog(self, owner_session, owner_hid):
        r = owner_session.get(f"{API}/households/{owner_hid}/changelog", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- invite ----------
class TestInvite:
    def test_invite_flow(self, owner_session, owner_hid):
        email = f"invite_{uuid.uuid4().hex[:6]}@example.com"
        r = owner_session.post(f"{API}/households/{owner_hid}/invite", json={"email": email}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert "token" in data
        assert "invite_link" in data
        assert "email_sent" in data
        token = data["token"]
        # get invite (public)
        g = requests.get(f"{API}/invites/{token}", timeout=30)
        assert g.status_code == 200
        gd = g.json()
        assert gd["household_name"] == "Huize Constantine"
        assert gd["invited_by"]


# ---------- logout ----------
class TestLogout:
    def test_logout(self):
        s = requests.Session()
        s.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=30)
        r = s.post(f"{API}/auth/logout", timeout=30)
        assert r.status_code == 200
        me = s.get(f"{API}/auth/me", timeout=30)
        assert me.status_code == 401
