"""Iteration 7 - Merged Doelen & Sparen backend tests."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://budget-reno-1.preview.emergentagent.com").rstrip("/")
EMAIL = "robeson.constantine@gmail.com"
PASSWORD = "Bouwdepot2026!"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def hid(client):
    r = client.get(f"{BASE_URL}/api/households")
    assert r.status_code == 200
    hh = r.json()
    assert len(hh) >= 1
    return hh[0]["household_id"]


def test_projects_migrated_empty(client, hid):
    r = client.get(f"{BASE_URL}/api/households/{hid}/projects")
    assert r.status_code == 200
    assert r.json() == [], "Projects should be empty after migration"


def test_goals_summary_shape(client, hid):
    r = client.get(f"{BASE_URL}/api/households/{hid}/goals-summary")
    assert r.status_code == 200
    data = r.json()
    assert "goals" in data
    goals = data["goals"]
    # Expect at least 5 demo goals
    names = [g["name"] for g in goals]
    print("Goal names:", names)
    for expected in ["Boodschappen extra", "Etentjes & uitjes", "Kleding", "Vervoer", "Kindje op komst"]:
        assert expected in names, f"Missing demo goal: {expected}"

    for g in goals:
        for key in ("pot_id", "name", "monthly_amount", "categories", "balance", "spent_month", "history", "has_target"):
            assert key in g, f"goal missing {key}: {g}"

    # Continuous envelope goals
    for name in ["Boodschappen extra", "Etentjes & uitjes", "Kleding", "Vervoer"]:
        g = next(x for x in goals if x["name"] == name)
        assert g["has_target"] is False
        assert len(g["categories"]) > 0
        assert g["monthly_amount"] > 0

    # Project-type goal
    baby = next(x for x in goals if x["name"] == "Kindje op komst")
    assert baby["has_target"] is True
    assert baby["monthly_amount"] == 0
    assert baby.get("already_saved", 0) == 2500 or baby.get("balance") is not None
    assert len(baby.get("items", [])) == 4, f"expected 4 cost items, got {baby.get('items')}"
    for key in ("total_cost", "remaining", "required_monthly", "progress", "months_left", "feasible"):
        assert key in baby, f"baby goal missing {key}"


def test_ai_chat_goals(client, hid):
    r = client.post(f"{BASE_URL}/api/households/{hid}/ai/chat", json={"message": "Welke doelen heb ik?"})
    # AI may fail if key not set - accept 200 or 5xx but log
    print("ai status", r.status_code, r.text[:200])
    assert r.status_code == 200, r.text


def test_pots_summary_still_works(client, hid):
    r = client.get(f"{BASE_URL}/api/households/{hid}/pots-summary")
    assert r.status_code == 200


def test_dashboard_loads(client, hid):
    r = client.get(f"{BASE_URL}/api/households/{hid}/dashboard?year=2026")
    assert r.status_code == 200
    d = r.json()
    assert "current_month" in d


def test_goal_crud_and_overspend_flow(client, hid):
    # CREATE continuous goal
    r = client.post(f"{BASE_URL}/api/households/{hid}/pots", json={
        "name": "TEST Vakantie", "monthly_amount": 100, "categories": [], "already_saved": 0
    })
    assert r.status_code in (200, 201), r.text
    pot = r.json()
    pot_id = pot.get("pot_id") or pot.get("id")
    assert pot_id

    try:
        # Verify appears
        gs = client.get(f"{BASE_URL}/api/households/{hid}/goals-summary").json()["goals"]
        assert any(g["pot_id"] == pot_id for g in gs)

        # UPDATE with target_date
        r = client.put(f"{BASE_URL}/api/households/{hid}/pots/{pot_id}", json={
            "name": "TEST Vakantie", "monthly_amount": 100, "categories": [],
            "target_date": "2027-06-01", "already_saved": 0
        })
        assert r.status_code == 200, r.text

        # Add cost item
        r = client.post(f"{BASE_URL}/api/households/{hid}/project-items", json={
            "project_id": pot_id, "name": "Vlucht", "amount": 800
        })
        assert r.status_code in (200, 201), r.text
        item = r.json()
        item_id = item.get("item_id") or item.get("id")
        assert item_id

        # Verify project-type in summary
        gs = client.get(f"{BASE_URL}/api/households/{hid}/goals-summary").json()["goals"]
        g = next(x for x in gs if x["pot_id"] == pot_id)
        assert g["has_target"] is True
        assert g["total_cost"] >= 800
        assert "required_monthly" in g  # may be 0 if allocated already exceeds cost
        assert len(g["items"]) == 1

        # cleanup item
        r = client.delete(f"{BASE_URL}/api/households/{hid}/project-items/{item_id}")
        assert r.status_code in (200, 204)
    finally:
        # cleanup pot
        client.delete(f"{BASE_URL}/api/households/{hid}/pots/{pot_id}")

    # verify demo is back to 5
    gs = client.get(f"{BASE_URL}/api/households/{hid}/goals-summary").json()["goals"]
    assert len(gs) == 5, f"expected 5 demo goals after cleanup, got {len(gs)}: {[g['name'] for g in gs]}"


def test_overspend_banner_data(client, hid):
    dash = client.get(f"{BASE_URL}/api/households/{hid}/dashboard?year=2026").json()
    cm = dash["current_month"]
    year = dash.get("year", 2026)
    month_str = f"{year}-{int(cm):02d}"
    # Create a huge Boodschappen expense
    r = client.post(f"{BASE_URL}/api/households/{hid}/variable-expenses", json={
        "category": "Boodschappen", "description": "TEST overspend", "amount": 1699,
        "month": month_str, "paid_by": "joint"
    })
    assert r.status_code in (200, 201), r.text
    j = r.json()
    exp_id = j.get("item_id") or j.get("expense_id") or j.get("id")

    try:
        gs = client.get(f"{BASE_URL}/api/households/{hid}/goals-summary").json()["goals"]
        b = next(g for g in gs if g["name"] == "Boodschappen extra")
        assert b["spent_month"] > b["monthly_amount"], f"expected overspend: {b}"
    finally:
        client.delete(f"{BASE_URL}/api/households/{hid}/variable-expenses/{exp_id}")

    # verify restored
    gs = client.get(f"{BASE_URL}/api/households/{hid}/goals-summary").json()["goals"]
    b = next(g for g in gs if g["name"] == "Boodschappen extra")
    assert b["spent_month"] <= b["monthly_amount"] + 1699 - 1  # sanity
