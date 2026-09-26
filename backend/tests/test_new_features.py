"""Backend tests for iteration 2 new features: projects, export, drawdown timeline, warnings."""
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://budget-reno-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "robeson.constantine@gmail.com"
OWNER_PASSWORD = "Bouwdepot2026!"


@pytest.fixture(scope="module")
def owner_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=30)
    assert r.status_code == 200
    return s


@pytest.fixture(scope="module")
def hid(owner_session):
    hhs = owner_session.get(f"{API}/households", timeout=30).json()
    demo = next((h for h in hhs if h.get("name") == "Huize Constantine"), hhs[0])
    return demo["household_id"]


# ---------- Dashboard: new fields ----------
class TestDashboardNew:
    def test_expense_by_category_and_avg_monthly_over(self, owner_session, hid):
        r = owner_session.get(f"{API}/households/{hid}/dashboard", params={"year": 2026}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "expense_by_category" in d, f"missing expense_by_category; keys={list(d.keys())}"
        assert isinstance(d["expense_by_category"], (list, dict))
        assert "annual" in d
        assert "avg_monthly_over" in d["annual"], f"missing annual.avg_monthly_over; annual keys={list(d['annual'].keys())}"


# ---------- Bouwdepot timeline ----------
class TestBouwdepotTimeline:
    def test_timeline_present(self, owner_session, hid):
        r = owner_session.get(f"{API}/households/{hid}/bouwdepot-summary", timeout=30)
        assert r.status_code == 200
        depots = r.json()["depots"]
        assert len(depots) >= 1
        d = depots[0]
        assert "timeline" in d, f"missing timeline; keys={list(d.keys())}"
        assert isinstance(d["timeline"], list)
        assert len(d["timeline"]) >= 1
        # each point should have date + balance/value
        pt = d["timeline"][0]
        assert isinstance(pt, dict)


# ---------- Export ----------
class TestExport:
    def test_export_excel(self, owner_session, hid):
        r = owner_session.get(f"{API}/households/{hid}/export/excel", timeout=60)
        assert r.status_code == 200, r.text[:400]
        ct = r.headers.get("content-type", "")
        assert "sheet" in ct or "excel" in ct or "octet-stream" in ct, f"unexpected ct: {ct}"
        assert len(r.content) > 1000

    def test_export_pdf(self, owner_session, hid):
        r = owner_session.get(f"{API}/households/{hid}/export/pdf", timeout=60)
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "pdf" in ct or "octet-stream" in ct, f"unexpected ct: {ct}"
        assert r.content[:4] == b"%PDF" or len(r.content) > 1000


# ---------- Projects ----------
class TestProjects:
    def test_projects_summary_and_demo_project(self, owner_session, hid):
        r = owner_session.get(f"{API}/households/{hid}/projects-summary", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "avg_monthly_over" in data
        assert "projects" in data
        # demo project 'Kindje op komst'
        baby = next((p for p in data["projects"] if "Kindje" in p.get("name", "")), None)
        assert baby is not None, f"demo project not found. projects={[p.get('name') for p in data['projects']]}"
        assert "required_monthly" in baby
        assert "feasible" in baby

    def test_project_crud(self, owner_session, hid):
        # create
        payload = {"name": "TEST_project", "target_date": "2027-12-31", "already_saved": 500}
        r = owner_session.post(f"{API}/households/{hid}/projects", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        proj = r.json()
        pid = proj["project_id"]
        # add item
        it = owner_session.post(f"{API}/households/{hid}/project-items",
                                json={"project_id": pid, "description": "TEST_item", "amount": 1000}, timeout=30)
        assert it.status_code == 200, it.text
        item_id = it.json()["item_id"]
        # verify in summary
        s = owner_session.get(f"{API}/households/{hid}/projects-summary", timeout=30).json()
        p = next((x for x in s["projects"] if x.get("project_id") == pid), None)
        assert p is not None
        assert p.get("required_monthly", 0) >= 0
        # cleanup
        owner_session.delete(f"{API}/households/{hid}/project-items/{item_id}", timeout=30)
        owner_session.delete(f"{API}/households/{hid}/projects/{pid}", timeout=30)


# ---------- Warnings: budget overrun ----------
class TestWarnings:
    def test_budget_overrun_warning(self, owner_session, hid):
        # find depot
        summary = owner_session.get(f"{API}/households/{hid}/bouwdepot-summary", timeout=30).json()
        depot_id = summary["depots"][0]["bouwdepot_id"]
        # create small-budget bouwpost
        bp = owner_session.post(f"{API}/households/{hid}/bouwposten",
                                json={"name": "TEST_overrun_bp", "category": "Keuken", "budget": 100,
                                      "bouwdepot_id": depot_id}, timeout=30).json()
        bp_id = bp["bouwpost_id"]
        # accepted invoice exceeding
        inv = owner_session.post(f"{API}/households/{hid}/invoices",
                                 json={"supplier": "TEST_sup", "bouwpost_id": bp_id, "bouwdepot_id": depot_id,
                                       "type": "invoice", "amount_incl_vat": 500, "status": "accepted",
                                       "invoice_amount": 500, "submitted_to_bank": False,
                                       "description": "TEST_over"}, timeout=30).json()
        inv_id = inv.get("invoice_id")
        try:
            s2 = owner_session.get(f"{API}/households/{hid}/bouwdepot-summary", timeout=30).json()
            checks = s2.get("checks") or s2.get("control_checks") or []
            # depots may have checks nested
            all_checks_str = str(s2)
            assert "budget_overrun" in all_checks_str or "budget_near" in all_checks_str, \
                f"expected budget_overrun/near warning; response keys={list(s2.keys())}"
        finally:
            if inv_id:
                owner_session.delete(f"{API}/households/{hid}/invoices/{inv_id}", timeout=30)
            owner_session.delete(f"{API}/households/{hid}/bouwposten/{bp_id}", timeout=30)
