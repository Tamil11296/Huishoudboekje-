"""Toegang, uitnodigingen, afscherming per huishouden, bijlagen en back-up."""
from datetime import datetime, timedelta, timezone

import pytest

from tests.conftest import login, TestClient
import server


def test_unknown_google_account_is_refused():
    c = TestClient(server.app)
    r = c.post("/api/auth/google", json={"credential": "vreemde@example.com"})
    assert r.status_code == 403


def test_no_password_login_or_register_anymore():
    c = TestClient(server.app)
    assert c.post("/api/auth/login", json={"email": "a@b.nl", "password": "x"}).status_code in (404, 405)
    assert c.post("/api/auth/register", json={"email": "a@b.nl", "password": "x"}).status_code in (404, 405)


def test_api_requires_login():
    c = TestClient(server.app)
    assert c.get("/api/households").status_code == 401
    assert c.get("/api/auth/me").status_code == 401


def test_refresh_gives_new_access_cookie(owner):
    owner.cookies.delete("access_token")
    assert owner.get("/api/auth/me").status_code == 401
    assert owner.post("/api/auth/refresh").status_code == 200
    assert owner.get("/api/auth/me").json()["email"] == "owner@example.com"


def test_invite_flow_partner_logs_in_and_joins(owner):
    r = owner.post(f"/api/households/{owner.hid}/invite", json={"email": "Partner@Example.com"})
    assert r.status_code == 200
    token = r.json()["invite_link"].rsplit("/", 1)[-1]
    # Partner staat niet op de toegangslijst, maar mag door de uitnodiging inloggen
    p = login("partner@example.com")
    hh = p.get("/api/households").json()
    assert [h["household_id"] for h in hh] == [owner.hid]
    # Uitnodiging is daarna verbruikt
    assert p.get(f"/api/invites/{token}").status_code == 404
    # Partner blijft toegang houden bij volgende login (lid van huishouden)
    assert login("partner@example.com").get("/api/households").status_code == 200


def test_invite_link_cannot_be_used_by_other_account(owner):
    token = owner.post(f"/api/households/{owner.hid}/invite",
                       json={"email": "partner@example.com"}).json()["invite_link"].rsplit("/", 1)[-1]
    # een ander account op de toegangslijst probeert de link
    import deps, auth
    deps.ALLOWED_EMAILS.append("ander@example.com")
    auth.ALLOWED_EMAILS = deps.ALLOWED_EMAILS
    try:
        other = login("ander@example.com")
        assert other.post(f"/api/invites/{token}/accept").status_code == 403
        assert other.get("/api/households").json() == []
    finally:
        deps.ALLOWED_EMAILS.remove("ander@example.com")


@pytest.mark.asyncio
async def test_expired_invite_gives_no_access(owner):
    owner.post(f"/api/households/{owner.hid}/invite", json={"email": "laat@example.com"})
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    await server.db.invites.update_many({"email": "laat@example.com"}, {"$set": {"expires_at": past}})
    c = TestClient(server.app)
    assert c.post("/api/auth/google", json={"credential": "laat@example.com"}).status_code == 403


def test_only_owner_can_invite(owner):
    owner.post(f"/api/households/{owner.hid}/invite", json={"email": "partner@example.com"})
    p = login("partner@example.com")
    assert p.post(f"/api/households/{owner.hid}/invite", json={"email": "x@example.com"}).status_code == 403


def test_households_are_isolated(owner):
    owner.post(f"/api/households/{owner.hid}/fixed-expenses",
               json={"category": "Energie", "description": "Eneco", "amount": 144, "frequency": "maandelijks",
                     "start_date": "2026-01-01", "paid_by": "joint"})
    import deps
    deps.ALLOWED_EMAILS.append("buur@example.com")
    try:
        buur = login("buur@example.com")
        own = buur.post("/api/households", json={"name": "Buren"}).json()["household_id"]
        assert buur.get(f"/api/households/{owner.hid}").status_code == 403
        assert buur.get(f"/api/households/{owner.hid}/fixed-expenses").status_code == 403
        assert buur.get(f"/api/households/{owner.hid}/dashboard").status_code == 403
        assert buur.get(f"/api/households/{owner.hid}/backup").status_code == 403
        # item-id uit het andere huishouden via het eigen huishouden aanspreken helpt niet
        item = owner.get(f"/api/households/{owner.hid}/fixed-expenses").json()[0]["item_id"]
        r = buur.put(f"/api/households/{own}/fixed-expenses/{item}", json={"amount": 1})
        assert r.status_code == 404
        assert owner.get(f"/api/households/{owner.hid}/fixed-expenses").json()[0]["amount"] == 144
    finally:
        deps.ALLOWED_EMAILS.remove("buur@example.com")


def test_numeric_fields_are_validated(owner):
    base = f"/api/households/{owner.hid}/variable-expenses"
    assert owner.post(base, json={"category": "Boodschappen", "amount": "abc", "month": "2026-10"}).status_code == 400
    r = owner.post(base, json={"category": "Boodschappen", "amount": "64,20", "month": "2026-10"})
    assert r.status_code == 200 and r.json()["amount"] == 64.2


def test_attachments_upload_download_and_limits(owner):
    inv = owner.post(f"/api/households/{owner.hid}/invoices",
                     json={"type": "offerte", "supplier": "Keukens BV", "amount_incl_vat": 1000}).json()
    base = f"/api/households/{owner.hid}/invoices/{inv['invoice_id']}/attachment"
    pdf = b"%PDF-1.4 test"
    r = owner.post(base, files={"file": ("offerte.pdf", pdf, "application/pdf")})
    assert r.status_code == 200, r.text
    att = r.json()["id"]
    got = owner.get(f"{base}/{att}")
    assert got.status_code == 200 and got.content == pdf
    assert owner.post(base, files={"file": ("x.html", b"<script>", "text/html")}).status_code == 400
    big = b"0" * (10 * 1024 * 1024 + 1)
    assert owner.post(base, files={"file": ("groot.pdf", big, "application/pdf")}).status_code == 413
    assert owner.delete(f"{base}/{att}").status_code == 200
    assert owner.get(f"{base}/{att}").status_code == 404


def test_backup_and_restore_roundtrip(owner):
    base = f"/api/households/{owner.hid}"
    owner.post(f"{base}/fixed-expenses", json={"category": "Water", "amount": 35, "frequency": "maandelijks",
                                               "start_date": "2026-01-01"})
    backup = owner.get(f"{base}/backup").json()
    assert len(backup["fixed_expenses"]) == 1
    owner.post(f"{base}/fixed-expenses", json={"category": "Extra", "amount": 1})
    r = owner.post(f"{base}/restore", json=backup)
    assert r.status_code == 200
    rows = owner.get(f"{base}/fixed-expenses").json()
    assert [x["category"] for x in rows] == ["Water"]


def test_dashboard_and_bouwdepot_endpoints(owner):
    base = f"/api/households/{owner.hid}"
    assert owner.get(f"{base}/dashboard?year=2026").status_code == 200
    dep = owner.post(f"{base}/bouwdepots", json={"name": "Depot", "start_amount": 1000}).json()
    bp = owner.post(f"{base}/bouwposten", json={"name": "Tuin", "budget": 800,
                                                 "bouwdepot_id": dep["bouwdepot_id"]}).json()
    owner.post(f"{base}/invoices", json={"type": "factuur", "supplier": "Gamma", "invoice_amount": 100,
                                         "bouwpost_id": bp["bouwpost_id"], "bouwdepot_id": dep["bouwdepot_id"]})
    s = owner.get(f"{base}/bouwdepot-summary").json()["depots"][0]
    assert s["freely_available"] == 900 and s["controle"] == 0


def test_no_ai_endpoints_left(owner):
    assert owner.post(f"/api/households/{owner.hid}/ai/chat", json={"message": "hoi"}).status_code in (404, 405)


def test_delete_household_removes_everything(owner):
    base = f"/api/households/{owner.hid}"
    owner.post(f"{base}/pots", json={"name": "Vakantie", "monthly_amount": 100})
    assert owner.delete(base).status_code == 200
    assert owner.get("/api/households").json() == []
