"""Iteration 6 tests: category_budget removed, pot-based budget & AI regression."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back to frontend .env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

EMAIL = "robeson.constantine@gmail.com"
PASSWORD = "Bouwdepot2026!"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def hid(session):
    r = session.get(f"{BASE_URL}/api/households")
    assert r.status_code == 200
    lst = r.json()
    demo = next((h for h in lst if h.get("name") == "Huize Constantine"), lst[0])
    return demo["household_id"]


# ---------- REMOVAL regression: backend PATCH ignores category_budgets ----------
def test_patch_ignores_category_budgets(session, hid):
    """PATCH with category_budgets should not mutate/persist it."""
    before = session.get(f"{BASE_URL}/api/households/{hid}").json()
    before_cb = before.get("category_budgets")  # may exist as stale legacy data
    r = session.patch(f"{BASE_URL}/api/households/{hid}",
                      json={"category_budgets": {"__TEST__": 999}})
    assert r.status_code == 200
    after = r.json()
    # PATCH must not have overwritten/created the field with our test value
    assert after.get("category_budgets") == before_cb, (
        f"PATCH must ignore category_budgets. before={before_cb} after={after.get('category_budgets')}"
    )
    if after.get("category_budgets"):
        assert "__TEST__" not in after["category_budgets"]


def test_patch_normal_settings_still_works(session, hid):
    hh = session.get(f"{BASE_URL}/api/households/{hid}").json()
    name = hh["name"]; split = hh["split_rule"]; yr = hh["dashboard_year"]
    r = session.patch(f"{BASE_URL}/api/households/{hid}",
                      json={"name": name, "split_rule": split, "dashboard_year": yr})
    assert r.status_code == 200
    hh2 = r.json()
    assert hh2["name"] == name
    assert hh2["split_rule"] == split
    assert hh2["dashboard_year"] == yr


# ---------- REMOVAL regression: dashboard shape ----------
def test_dashboard_no_category_budgets_key(session, hid):
    r = session.get(f"{BASE_URL}/api/households/{hid}/dashboard")
    assert r.status_code == 200
    d = r.json()
    assert "category_budgets" not in d
    for k in ("months", "annual", "per_person_year", "expense_by_category",
              "category_items", "current_month", "current_month_label"):
        assert k in d, f"missing key: {k}"
    assert isinstance(d["months"], list) and len(d["months"]) == 12
    assert isinstance(d["current_month"], int)


# ---------- POT BUDGET view + OVER-BUDGET flow ----------
def test_pots_summary_shape(session, hid):
    r = session.get(f"{BASE_URL}/api/households/{hid}/pots-summary")
    assert r.status_code == 200
    p = r.json()
    assert "pots" in p and len(p["pots"]) > 0
    for pot in p["pots"]:
        for k in ("pot_id", "name", "monthly_amount", "spent_month", "balance", "categories"):
            assert k in pot


def test_over_budget_flow(session, hid):
    dash = session.get(f"{BASE_URL}/api/households/{hid}/dashboard").json()
    year = dash["year"]
    cm = dash["current_month"]
    assert cm >= 1
    ym = f"{year}-{cm:02d}"

    pots = session.get(f"{BASE_URL}/api/households/{hid}/pots-summary").json()["pots"]
    # pick pot with monthly_amount>0 and at least one linked category
    pot = next(p for p in pots if p["monthly_amount"] > 0 and p["categories"])
    cat = pot["categories"][0]
    monthly = pot["monthly_amount"]
    overspend_amount = monthly + 500

    # create variable expense to push over
    payload = {"category": cat, "description": "TEST overspend",
               "amount": overspend_amount, "month": ym, "paid_by": "joint"}
    cr = session.post(f"{BASE_URL}/api/households/{hid}/variable-expenses", json=payload)
    assert cr.status_code == 200, cr.text
    item_id = cr.json()["item_id"]

    try:
        # reload pots summary
        pots2 = session.get(f"{BASE_URL}/api/households/{hid}/pots-summary").json()["pots"]
        pot2 = next(p for p in pots2 if p["pot_id"] == pot["pot_id"])
        assert pot2["spent_month"] > pot2["monthly_amount"], (
            f"expected over-budget: spent_month={pot2['spent_month']} monthly={pot2['monthly_amount']}"
        )
    finally:
        d = session.delete(f"{BASE_URL}/api/households/{hid}/variable-expenses/{item_id}")
        assert d.status_code == 200

    # cleanup verification
    pots3 = session.get(f"{BASE_URL}/api/households/{hid}/pots-summary").json()["pots"]
    pot3 = next(p for p in pots3 if p["pot_id"] == pot["pot_id"])
    # should be back to baseline (<= monthly, or at least less than overspend)
    assert pot3["spent_month"] < overspend_amount


# ---------- AI regression ----------
def test_ai_chat(session, hid):
    r = session.post(f"{BASE_URL}/api/households/{hid}/ai/chat",
                     json={"message": "Welke potjes gaan over hun maandbudget?"},
                     timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "reply" in data and isinstance(data["reply"], str) and len(data["reply"]) > 0


def test_ai_insights(session, hid):
    r = session.post(f"{BASE_URL}/api/households/{hid}/ai/insights", timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "tips" in data and isinstance(data["tips"], list)
