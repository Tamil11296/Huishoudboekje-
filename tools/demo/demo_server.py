"""Demo van Huishoudboekje zonder Google, zonder database en zonder installatie van accounts.

    python tools/demo/demo_server.py          (na: cd frontend && yarn build)

- Database in het geheugen (verdwijnt bij herstarten), gevuld met onze cijfers uit Excel v5.
- Inloggen met knoppen voor Robeson en Miraja; er wordt geen Google-token gecontroleerd.
- ALLEEN VOOR LOKAAL/CODESPACES. Dit bestand zit niet in de productie-container
  (de Dockerfile kopieert alleen backend/ en de gebouwde frontend).
"""
import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.environ.update(
    USE_MONGOMOCK="1",
    DEMO_MODE="1",
    JWT_SECRET="demo-only-" + "d" * 40,
    GOOGLE_CLIENT_ID="",
    ALLOWED_EMAILS="robeson@demo.nl",
    COOKIE_SECURE="false",
    STATIC_DIR=str(ROOT / "frontend" / "build"),
)
sys.path.insert(0, str(ROOT / "backend"))

import uvicorn  # noqa: E402

import auth  # noqa: E402
import server  # noqa: E402
from deps import db, new_id  # noqa: E402
from tests.fixture_v5 import FIXED, INCOMES, VARIABLE  # noqa: E402

DEMO_USERS = {"robeson@demo.nl": "Robeson", "miraja@demo.nl": "Miraja"}


def demo_verify(credential: str) -> dict:
    if credential not in DEMO_USERS:
        raise auth.HTTPException(status_code=401, detail="Onbekende demogebruiker")
    return {"email": credential, "email_verified": True, "name": DEMO_USERS[credential], "sub": credential}


auth.verify_google_credential = demo_verify


async def seed():
    users = {}
    for email, name in DEMO_USERS.items():
        u = {"user_id": new_id("user"), "email": email, "name": name, "picture": ""}
        await db.users.insert_one(dict(u))
        users[name] = u
    R, M = new_id("prs"), new_id("prs")
    hid = new_id("hh")
    await db.households.insert_one({
        "household_id": hid, "name": "Huize Constantine (demo)", "owner_id": users["Robeson"]["user_id"],
        "members": [{"user_id": users["Robeson"]["user_id"], "email": "robeson@demo.nl", "name": "Robeson", "role": "owner"},
                    {"user_id": users["Miraja"]["user_id"], "email": "miraja@demo.nl", "name": "Miraja", "role": "member"}],
        "member_ids": [users["Robeson"]["user_id"], users["Miraja"]["user_id"]],
        "persons": [{"person_id": R, "name": "Robeson"}, {"person_id": M, "name": "Miraja"}],
        "categories": {
            "income": ["Salaris", "Vakantiegeld", "Reiskosten", "Correctie reiskosten", "Overig"],
            "expense": sorted({c for c, *_ in FIXED} | {"Boodschappen", "Vervoer"}),
            "bouwpost": ["Tuin", "Kozijnen", "Overig"],
        },
        "quote_statuses": ["ontvangen", "geaccepteerd"], "quick_presets": [],
        "split_rule": "income", "currency": "EUR", "dashboard_year": 2026, "demo": True,
    })
    pid = {"R": R, "M": M}
    for p, amount, start in INCOMES:
        await db.incomes.insert_one({"income_id": new_id("inc"), "household_id": hid, "person_id": pid[p],
                                     "source": "Salaris", "amount": amount, "frequency": "maandelijks",
                                     "start_date": start})
    for c, d, a, f, s, e, p in FIXED:
        await db.fixed_expenses.insert_one({"item_id": new_id("fex"), "household_id": hid, "category": c,
                                            "description": d, "amount": a, "frequency": f, "start_date": s,
                                            "end_date": e, "paid_by": pid[p]})
    for c, a, m, p in VARIABLE:
        await db.variable_expenses.insert_one({"item_id": new_id("vex"), "household_id": hid, "category": c,
                                               "description": "ROAD. BV", "amount": a, "month": m, "paid_by": pid[p]})
    dep = new_id("dep")
    await db.bouwdepots.insert_one({"bouwdepot_id": dep, "household_id": hid, "name": "Bouwdepot",
                                    "start_amount": 100251.02, "start_date": "2026-08-01",
                                    "end_date": "2027-01-09", "active": True})
    posts = {}
    for name, budget in (("Tuin", 81000), ("Kozijnen", 11000), ("Overig", 11000)):
        posts[name] = new_id("bp")
        await db.bouwposten.insert_one({"bouwpost_id": posts[name], "household_id": hid, "name": name,
                                        "budget": budget, "bouwdepot_id": dep})
    quotes = [("Uw veranda specialist", "Tuinkamer", 39083.0, "Tuin", "geaccepteerd"),
              ("Frank Bakker tuinen", "Tuinwerkzaamheden", 41232.0, "Tuin", "geaccepteerd"),
              ("Deza Kozijnen", "Vervanging deuren", 10580.46, "Kozijnen", "geaccepteerd"),
              ("Master Carpenter", "Kantoor verbouwing", 10520.95, "Overig", "ontvangen")]
    qids = {}
    for sup, desc, amt, post, status in quotes:
        qids[sup] = new_id("inv")
        await db.invoices.insert_one({"invoice_id": qids[sup], "household_id": hid, "bouwdepot_id": dep,
                                      "bouwpost_id": posts[post], "supplier": sup, "type": "offerte",
                                      "amount_incl_vat": amt, "status": status, "valid_until": "2026-10-10",
                                      "description": desc, "attachments": []})
    await db.invoices.insert_one({"invoice_id": new_id("inv"), "household_id": hid, "bouwdepot_id": dep,
                                  "bouwpost_id": posts["Tuin"], "supplier": "Uw veranda specialist",
                                  "type": "factuur", "parent_quote_id": qids["Uw veranda specialist"],
                                  "termijn": "1", "invoice_amount": 11724.90, "submitted_to_bank": True,
                                  "submitted_on": "2026-09-26", "description": "Termijn 30%", "attachments": []})


if __name__ == "__main__":
    asyncio.run(seed())
    port = int(os.environ.get("PORT", 8000))
    print(f"\n  Huishoudboekje DEMO draait op http://localhost:{port}\n")
    uvicorn.run(server.app, host="0.0.0.0", port=port, log_level="warning")
