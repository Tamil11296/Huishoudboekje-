"""
Iteration 5 - Bouwdepot linked-invoice double-counting fix.

Tests that when a factuur (term-invoice) is linked to an accepted offerte
via parent_quote_id, the amount is not double-counted in freely_available.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
EMAIL = "robeson.constantine@gmail.com"
PASSWORD = "Bouwdepot2026!"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def household_id(client):
    r = client.get(f"{BASE_URL}/api/households")
    assert r.status_code == 200
    households = r.json()
    # find Huize Constantine
    for h in households:
        if "Constantine" in h.get("name", ""):
            return h.get("household_id") or h.get("id")
    return households[0].get("household_id") or households[0].get("id")


@pytest.fixture(scope="module")
def bouwdepot(client, household_id):
    r = client.get(f"{BASE_URL}/api/households/{household_id}/bouwdepot-summary")
    assert r.status_code == 200
    data = r.json()
    assert data.get("depots"), f"No depots found: {data}"
    return data["depots"][0]


def _get_summary(client, household_id, depot_id):
    r = client.get(f"{BASE_URL}/api/households/{household_id}/bouwdepot-summary")
    assert r.status_code == 200
    for d in r.json()["depots"]:
        if (d.get("bouwdepot_id") or d.get("id")) == depot_id:
            return d
    raise AssertionError("Depot not found")


def _find_accepted_offerte(client, household_id, depot_id, supplier_hint="Groenaanleg Peters"):
    """Find an accepted offerte with no invoice_amount on its own record."""
    r = client.get(f"{BASE_URL}/api/households/{household_id}/invoices")
    assert r.status_code == 200
    for inv in r.json():
        if (inv.get("type") == "offerte"
                and inv.get("status") == "geaccepteerd"
                and inv.get("bouwdepot_id") == depot_id
                and not inv.get("invoice_amount")):
            if supplier_hint and supplier_hint.lower() in (inv.get("supplier") or "").lower():
                return inv
    # fallback: any accepted offerte without invoice_amount
    for inv in r.json():
        if (inv.get("type") == "offerte"
                and inv.get("status") == "geaccepteerd"
                and inv.get("bouwdepot_id") == depot_id
                and not inv.get("invoice_amount")):
            return inv
    return None


def test_linked_term_invoice_does_not_double_count(client, household_id, bouwdepot):
    depot_id = bouwdepot.get("bouwdepot_id") or bouwdepot.get("id")
    offerte = _find_accepted_offerte(client, household_id, depot_id)
    assert offerte is not None, "Expected an accepted offerte (Groenaanleg Peters ~11400)"
    quote_amount = offerte.get("amount_incl_vat") or 0
    assert quote_amount > 0

    before = _get_summary(client, household_id, depot_id)
    b_stt = before["still_to_submit"]
    b_snp = before["submitted_not_paid"]
    b_free = before["freely_available"]
    b_paid = before["paid_out"]
    print(f"BEFORE: stt={b_stt} snp={b_snp} paid={b_paid} free={b_free} quote={quote_amount}")

    created_ids = []
    try:
        # ------ Case 1: submitted (not paid) term invoice of 5000 ------
        payload1 = {
            "type": "factuur",
            "supplier": offerte["supplier"],
            "bouwpost_id": offerte.get("bouwpost_id"),
            "bouwdepot_id": depot_id,
            "parent_quote_id": offerte.get("invoice_id") or offerte.get("id"),
            "termijn": "1",
            "invoice_amount": 5000,
            "submitted_to_bank": True,
        }
        r = client.post(f"{BASE_URL}/api/households/{household_id}/invoices", json=payload1)
        assert r.status_code in (200, 201), f"Create factuur failed: {r.status_code} {r.text}"
        inv1 = r.json()
        created_ids.append(inv1["invoice_id"])

        mid = _get_summary(client, household_id, depot_id)
        print(f"AFTER-1: stt={mid['still_to_submit']} snp={mid['submitted_not_paid']} "
              f"paid={mid['paid_out']} free={mid['freely_available']}")

        assert abs(mid["still_to_submit"] - (b_stt - 5000)) < 0.01, \
            f"still_to_submit expected {b_stt - 5000}, got {mid['still_to_submit']}"
        assert abs(mid["submitted_not_paid"] - (b_snp + 5000)) < 0.01, \
            f"submitted_not_paid expected {b_snp + 5000}, got {mid['submitted_not_paid']}"
        assert abs(mid["freely_available"] - b_free) < 0.01, \
            f"freely_available should stay {b_free}, got {mid['freely_available']} (double counting bug)"

        # ------ Case 2: second term invoice PAID (paid_on set), 3000 ------
        payload2 = {
            "type": "factuur",
            "supplier": offerte["supplier"],
            "bouwpost_id": offerte.get("bouwpost_id"),
            "bouwdepot_id": depot_id,
            "parent_quote_id": offerte.get("invoice_id") or offerte.get("id"),
            "termijn": "2",
            "invoice_amount": 3000,
            "submitted_to_bank": True,
            "paid_on": "2026-01-15",
            "paid_amount": 3000,
        }
        r = client.post(f"{BASE_URL}/api/households/{household_id}/invoices", json=payload2)
        assert r.status_code in (200, 201), f"Create paid factuur failed: {r.text}"
        inv2 = r.json()
        created_ids.append(inv2["invoice_id"])

        after2 = _get_summary(client, household_id, depot_id)
        print(f"AFTER-2: stt={after2['still_to_submit']} snp={after2['submitted_not_paid']} "
              f"paid={after2['paid_out']} free={after2['freely_available']}")

        assert abs(after2["still_to_submit"] - (b_stt - 5000 - 3000)) < 0.01
        # snp: back to +5000 only (paid moved out), paid: +3000
        assert abs(after2["submitted_not_paid"] - (b_snp + 5000)) < 0.01
        assert abs(after2["paid_out"] - (b_paid + 3000)) < 0.01
        assert abs(after2["freely_available"] - b_free) < 0.01, \
            f"freely_available should still stay {b_free}, got {after2['freely_available']}"

        # ------ Case 3: overage clamp - add invoice that overshoots quote total ------
        # quote_amount ~11400, we've used 8000, add invoice that pushes above (e.g. 5000 more -> total 13000, overage 1600)
        overage_extra = 5000
        total_after = 5000 + 3000 + overage_extra
        overage = max(total_after - quote_amount, 0)
        payload3 = {
            "type": "factuur",
            "supplier": offerte["supplier"],
            "bouwpost_id": offerte.get("bouwpost_id"),
            "bouwdepot_id": depot_id,
            "parent_quote_id": offerte.get("invoice_id") or offerte.get("id"),
            "termijn": "3",
            "invoice_amount": overage_extra,
            "submitted_to_bank": True,
        }
        r = client.post(f"{BASE_URL}/api/households/{household_id}/invoices", json=payload3)
        assert r.status_code in (200, 201)
        inv3 = r.json()
        created_ids.append(inv3["invoice_id"])

        after3 = _get_summary(client, household_id, depot_id)
        print(f"AFTER-3(overage): stt={after3['still_to_submit']} snp={after3['submitted_not_paid']} "
              f"paid={after3['paid_out']} free={after3['freely_available']} expected_overage={overage}")

        # still_to_submit: the offerte contribution clamps at 0. Original b_stt included the full quote (11400).
        # New expected: b_stt - quote_amount (this offerte fully consumed)
        assert abs(after3["still_to_submit"] - (b_stt - quote_amount)) < 0.01, \
            f"still_to_submit should clamp: expected {b_stt - quote_amount}, got {after3['still_to_submit']}"
        # freely_available drops only by the true overage
        assert abs(after3["freely_available"] - (b_free - overage)) < 0.01, \
            f"freely_available expected {b_free - overage}, got {after3['freely_available']}"

    finally:
        # Cleanup
        for iid in created_ids:
            client.delete(f"{BASE_URL}/api/households/{household_id}/invoices/{iid}")

        # Verify cleanup restored state
        restored = _get_summary(client, household_id, depot_id)
        print(f"RESTORED: stt={restored['still_to_submit']} snp={restored['submitted_not_paid']} "
              f"paid={restored['paid_out']} free={restored['freely_available']}")
        assert abs(restored["still_to_submit"] - b_stt) < 0.01
        assert abs(restored["freely_available"] - b_free) < 0.01


def test_regression_new_accepted_offerte_counts_in_still_to_submit(client, household_id, bouwdepot):
    """A fresh accepted offerte with no invoice_amount and no children must add its full amount to still_to_submit."""
    depot_id = bouwdepot.get("bouwdepot_id") or bouwdepot.get("id")
    before = _get_summary(client, household_id, depot_id)
    created_id = None
    try:
        payload = {
            "type": "offerte",
            "status": "geaccepteerd",
            "supplier": "TEST_Regression Supplier",
            "bouwdepot_id": depot_id,
            "amount_incl_vat": 2500,
        }
        r = client.post(f"{BASE_URL}/api/households/{household_id}/invoices", json=payload)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        created_id = r.json().get("invoice_id") or r.json().get("id")

        after = _get_summary(client, household_id, depot_id)
        assert abs(after["still_to_submit"] - (before["still_to_submit"] + 2500)) < 0.01, \
            f"Expected +2500 in still_to_submit, got {after['still_to_submit']} vs {before['still_to_submit']}"
    finally:
        if created_id:
            client.delete(f"{BASE_URL}/api/households/{household_id}/invoices/{created_id}")


def test_regression_old_style_offerte_with_invoice_amount_excluded(client, household_id, bouwdepot):
    """Offerte with invoice_amount set on its own record must NOT appear in still_to_submit."""
    depot_id = bouwdepot.get("bouwdepot_id") or bouwdepot.get("id")
    before = _get_summary(client, household_id, depot_id)
    created_id = None
    try:
        payload = {
            "type": "offerte",
            "status": "geaccepteerd",
            "supplier": "TEST_OldStyle",
            "bouwdepot_id": depot_id,
            "amount_incl_vat": 2000,
            "invoice_amount": 2000,
            "submitted_to_bank": True,
        }
        r = client.post(f"{BASE_URL}/api/households/{household_id}/invoices", json=payload)
        assert r.status_code in (200, 201)
        created_id = r.json().get("invoice_id") or r.json().get("id")
        after = _get_summary(client, household_id, depot_id)
        # still_to_submit should NOT increase because invoice_amount was set
        assert abs(after["still_to_submit"] - before["still_to_submit"]) < 0.01, \
            f"Old-style offerte should be excluded from still_to_submit"
    finally:
        if created_id:
            client.delete(f"{BASE_URL}/api/households/{household_id}/invoices/{created_id}")
