"""Backend tests for iteration 3 new features: AI (Claude), Pots (envelope), termijnfacturen."""
import os
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://budget-reno-1.preview.emergentagent.com").rstrip("/")
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


class TestPots:
    def test_pots_summary_shape(self, owner, hid):
        r = owner.get(f"{API}/households/{hid}/pots-summary", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("pots", "total_monthly", "free_surplus", "avg_monthly_over"):
            assert k in data, f"missing {k}"
        assert isinstance(data["pots"], list)
        assert len(data["pots"]) >= 4, f"expected demo pots >=4, got {len(data['pots'])}"
        for p in data["pots"]:
            for k in ("pot_id", "name", "monthly_amount", "allocated", "spent", "balance"):
                assert k in p, f"pot missing {k}: {p}"

    def test_pot_crud_and_summary_updates(self, owner, hid):
        payload = {"name": "TEST_pot", "monthly_amount": 50, "categories": ["Boodschappen"], "note": "t"}
        c = owner.post(f"{API}/households/{hid}/pots", json=payload, timeout=30)
        assert c.status_code == 200, c.text
        pot_id = c.json()["pot_id"]
        try:
            s = owner.get(f"{API}/households/{hid}/pots-summary", timeout=30).json()
            found = next((p for p in s["pots"] if p["pot_id"] == pot_id), None)
            assert found is not None
            assert found["monthly_amount"] == 50
            # update
            u = owner.put(f"{API}/households/{hid}/pots/{pot_id}",
                          json={"monthly_amount": 75}, timeout=30)
            assert u.status_code == 200
            s2 = owner.get(f"{API}/households/{hid}/pots-summary", timeout=30).json()
            found2 = next((p for p in s2["pots"] if p["pot_id"] == pot_id), None)
            assert found2["monthly_amount"] == 75
        finally:
            owner.delete(f"{API}/households/{hid}/pots/{pot_id}", timeout=30)


class TestAI:
    def test_ai_insights(self, owner, hid):
        r = owner.post(f"{API}/households/{hid}/ai/insights", json={}, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "tips" in data
        assert isinstance(data["tips"], list)
        assert len(data["tips"]) >= 1

    def test_ai_categorize(self, owner, hid):
        r = owner.post(f"{API}/households/{hid}/ai/categorize",
                       json={"description": "Etentje bij de Italiaan", "amount": 45}, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "category" in data
        assert data["category"], "empty category"

    def test_ai_chat(self, owner, hid):
        r = owner.post(f"{API}/households/{hid}/ai/chat",
                       json={"message": "Hoeveel houden we gemiddeld per maand over?"}, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "reply" in data and data["reply"]
        assert "session_id" in data


class TestTermijnFacturen:
    def test_termijn_invoice_lifecycle(self, owner, hid):
        # find depot & pick or create a bouwpost
        summary = owner.get(f"{API}/households/{hid}/bouwdepot-summary", timeout=30).json()
        depot_id = summary["depots"][0]["bouwdepot_id"]
        bouwposten = summary["bouwposten"]
        bp = bouwposten[0]
        bp_id = bp["bouwpost_id"]

        # create parent quote (type=quote/offerte)
        q = owner.post(f"{API}/households/{hid}/invoices",
                       json={"supplier": "TEST_quote_sup", "bouwpost_id": bp_id, "bouwdepot_id": depot_id,
                             "type": "quote", "amount_incl_vat": 10000, "status": "accepted",
                             "valid_until": "2026-12-31", "description": "TEST_offerte"}, timeout=30)
        assert q.status_code == 200, q.text
        quote_id = q.json()["invoice_id"]

        f1_id = f2_id = None
        try:
            # termijn 1: 4000 expected, 4000 paid
            f1 = owner.post(f"{API}/households/{hid}/invoices",
                            json={"supplier": "TEST_quote_sup", "bouwpost_id": bp_id, "bouwdepot_id": depot_id,
                                  "type": "invoice", "parent_quote_id": quote_id, "termijn": 1,
                                  "invoice_amount": 4000, "paid_amount": 4000,
                                  "due_date": "2026-06-01", "paid_on": "2026-06-05",
                                  "status": "paid", "submitted_to_bank": True,
                                  "description": "TEST_termijn_1"}, timeout=30)
            assert f1.status_code == 200, f1.text
            f1_id = f1.json()["invoice_id"]

            # termijn 2: 3000 expected, 0 paid
            f2 = owner.post(f"{API}/households/{hid}/invoices",
                            json={"supplier": "TEST_quote_sup", "bouwpost_id": bp_id, "bouwdepot_id": depot_id,
                                  "type": "invoice", "parent_quote_id": quote_id, "termijn": 2,
                                  "invoice_amount": 3000, "paid_amount": 0,
                                  "due_date": "2026-09-01",
                                  "status": "accepted", "submitted_to_bank": False,
                                  "description": "TEST_termijn_2"}, timeout=30)
            assert f2.status_code == 200, f2.text
            f2_id = f2.json()["invoice_id"]

            # verify listing contains both
            lst = owner.get(f"{API}/households/{hid}/invoices", timeout=30).json()
            ids = {i["invoice_id"] for i in lst}
            assert f1_id in ids and f2_id in ids
            for i in lst:
                if i["invoice_id"] == f1_id:
                    assert i.get("parent_quote_id") == quote_id
                    assert i.get("termijn") == 1
                    assert i.get("paid_amount") == 4000

            # bouwdepot summary reflects paid_amount (paid_out should include the 4000)
            s2 = owner.get(f"{API}/households/{hid}/bouwdepot-summary", timeout=30).json()
            depot = next(d for d in s2["depots"] if d["bouwdepot_id"] == depot_id)
            assert depot["paid_out"] >= 4000, f"paid_out={depot['paid_out']} expected >=4000"
        finally:
            for iid in (f1_id, f2_id, quote_id):
                if iid:
                    owner.delete(f"{API}/households/{hid}/invoices/{iid}", timeout=30)
