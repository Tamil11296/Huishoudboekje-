from datetime import datetime, timezone

from deps import new_id


async def seed_demo(db, owner):
    """Create a demo household with sample Dutch budget + bouwdepot data (idempotent)."""
    existing = await db.households.find_one({"owner_id": owner["user_id"], "demo": True})
    if existing:
        return
    now = datetime.now(timezone.utc).isoformat()
    p_rob = new_id("prs")
    p_mir = new_id("prs")
    hid = new_id("hh")
    household = {
        "household_id": hid,
        "name": "Huize Constantine",
        "owner_id": owner["user_id"],
        "members": [{"user_id": owner["user_id"], "email": owner["email"],
                     "name": owner.get("name", "Robeson"), "role": "owner"}],
        "member_ids": [owner["user_id"]],
        "persons": [{"person_id": p_rob, "name": "Robeson"},
                    {"person_id": p_mir, "name": "Miraja"}],
        "categories": {
            "income": ["Salaris", "Bonus", "Toeslagen"],
            "expense": ["Hypotheek", "Energie", "Verzekeringen", "Boodschappen",
                        "Abonnementen", "Vervoer", "Uit eten", "Kleding"],
            "bouwpost": ["Keuken", "Badkamer", "Tuin", "Vloer", "Overig"],
        },
        "quote_statuses": ["ontvangen", "geaccepteerd"],
        "split_rule": "income",
        "currency": "EUR",
        "dashboard_year": 2026,
        "demo": True,
        "created_at": now,
    }
    await db.households.insert_one(household)

    incomes = [
        {"income_id": new_id("inc"), "household_id": hid, "person_id": p_rob,
         "source": "Salaris ACME BV", "amount": 3850, "frequency": "maandelijks",
         "start_date": "2026-01-01", "end_date": None},
        {"income_id": new_id("inc"), "household_id": hid, "person_id": p_mir,
         "source": "Salaris Zorggroep", "amount": 3150, "frequency": "maandelijks",
         "start_date": "2026-01-01", "end_date": None},
        {"income_id": new_id("inc"), "household_id": hid, "person_id": p_rob,
         "source": "Vakantiegeld", "amount": 2800, "frequency": "jaarlijks",
         "start_date": "2026-05-01", "end_date": None},
    ]
    fixed = [
        {"item_id": new_id("fex"), "household_id": hid, "category": "Hypotheek",
         "description": "Hypotheek + rente", "amount": 1480, "frequency": "maandelijks",
         "start_date": "2026-01-01", "end_date": None, "paid_by": "joint"},
        {"item_id": new_id("fex"), "household_id": hid, "category": "Energie",
         "description": "Gas, water & licht", "amount": 235, "frequency": "maandelijks",
         "start_date": "2026-01-01", "end_date": None, "paid_by": "joint"},
        {"item_id": new_id("fex"), "household_id": hid, "category": "Verzekeringen",
         "description": "Zorg + opstal + inboedel", "amount": 310, "frequency": "maandelijks",
         "start_date": "2026-01-01", "end_date": None, "paid_by": "joint"},
        {"item_id": new_id("fex"), "household_id": hid, "category": "Boodschappen",
         "description": "Boodschappen budget", "amount": 650, "frequency": "maandelijks",
         "start_date": "2026-01-01", "end_date": None, "paid_by": "joint"},
        {"item_id": new_id("fex"), "household_id": hid, "category": "Abonnementen",
         "description": "Telefoon + streaming", "amount": 85, "frequency": "maandelijks",
         "start_date": "2026-01-01", "end_date": None, "paid_by": p_rob},
        {"item_id": new_id("fex"), "household_id": hid, "category": "Vervoer",
         "description": "Leaseauto bijdrage", "amount": 120, "frequency": "maandelijks",
         "start_date": "2026-01-01", "end_date": None, "paid_by": p_mir},
    ]
    variable = [
        {"item_id": new_id("vex"), "household_id": hid, "category": "Uit eten",
         "description": "Restaurant verjaardag", "amount": 128, "month": "2026-03", "paid_by": p_rob},
        {"item_id": new_id("vex"), "household_id": hid, "category": "Kleding",
         "description": "Winterjassen", "amount": 240, "month": "2026-02", "paid_by": p_mir},
        {"item_id": new_id("vex"), "household_id": hid, "category": "Vervoer",
         "description": "Treinkaartjes", "amount": 76, "month": "2026-04", "paid_by": "joint"},
        {"item_id": new_id("vex"), "household_id": hid, "category": "Uit eten",
         "description": "Afhaal weekend", "amount": 54, "month": "2026-05", "paid_by": "joint"},
        {"item_id": new_id("vex"), "household_id": hid, "category": "Boodschappen",
         "description": "Extra feestdagen", "amount": 190, "month": "2026-06", "paid_by": p_mir},
    ]

    depot_id = new_id("dep")
    depot = {"bouwdepot_id": depot_id, "household_id": hid, "name": "Verbouwing 2026",
             "start_amount": 78000, "start_date": "2026-01-15", "end_date": "2026-12-31",
             "active": True}
    bp_keuken = new_id("bp")
    bp_bad = new_id("bp")
    bp_tuin = new_id("bp")
    bp_vloer = new_id("bp")
    bouwposten = [
        {"bouwpost_id": bp_keuken, "household_id": hid, "bouwdepot_id": depot_id,
         "name": "Keuken", "category": "Keuken", "budget": 26000},
        {"bouwpost_id": bp_bad, "household_id": hid, "bouwdepot_id": depot_id,
         "name": "Badkamer", "category": "Badkamer", "budget": 18500},
        {"bouwpost_id": bp_tuin, "household_id": hid, "bouwdepot_id": depot_id,
         "name": "Tuin & terras", "category": "Tuin", "budget": 12000},
        {"bouwpost_id": bp_vloer, "household_id": hid, "bouwdepot_id": depot_id,
         "name": "Vloer & afwerking", "category": "Vloer", "budget": 9500},
    ]
    invoices = [
        {"invoice_id": new_id("inv"), "household_id": hid, "bouwdepot_id": depot_id,
         "bouwpost_id": bp_keuken, "supplier": "Keukenstudio Van Dijk", "type": "offerte",
         "amount_incl_vat": 24800, "valid_until": "2026-08-01", "status": "geaccepteerd",
         "invoice_amount": 24800, "submitted_to_bank": True, "submitted_on": "2026-04-10",
         "paid_on": "2026-04-24", "description": "Complete keuken incl. montage"},
        {"invoice_id": new_id("inv"), "household_id": hid, "bouwdepot_id": depot_id,
         "bouwpost_id": bp_bad, "supplier": "Sanitair Totaal", "type": "offerte",
         "amount_incl_vat": 17200, "valid_until": "2026-09-01", "status": "geaccepteerd",
         "invoice_amount": 8600, "submitted_to_bank": True, "submitted_on": "2026-05-15",
         "paid_on": None, "description": "Aanbetaling badkamer 50%"},
        {"invoice_id": new_id("inv"), "household_id": hid, "bouwdepot_id": depot_id,
         "bouwpost_id": bp_tuin, "supplier": "Groenaanleg Peters", "type": "offerte",
         "amount_incl_vat": 11400, "valid_until": "2026-10-01", "status": "geaccepteerd",
         "invoice_amount": None, "submitted_to_bank": False, "submitted_on": None,
         "paid_on": None, "description": "Bestrating + beplanting"},
        {"invoice_id": new_id("inv"), "household_id": hid, "bouwdepot_id": depot_id,
         "bouwpost_id": bp_vloer, "supplier": "Vloerenhuis", "type": "offerte",
         "amount_incl_vat": 8900, "valid_until": "2026-07-15", "status": "ontvangen",
         "invoice_amount": None, "submitted_to_bank": False, "submitted_on": None,
         "paid_on": None, "description": "PVC vloer hele benedenverdieping"},
    ]

    await db.incomes.insert_many(incomes)
    await db.fixed_expenses.insert_many(fixed)
    await db.variable_expenses.insert_many(variable)
    await db.bouwdepots.insert_one(depot)
    await db.bouwposten.insert_many(bouwposten)
    await db.invoices.insert_many(invoices)


async def ensure_demo_pots(db, hid):
    """Idempotently add demo envelope pots linked to variable-expense categories."""
    if await db.pots.find_one({"household_id": hid}):
        return
    await db.pots.insert_many([
        {"pot_id": new_id("pot"), "household_id": hid, "name": "Boodschappen extra",
         "monthly_amount": 150, "categories": ["Boodschappen"], "note": ""},
        {"pot_id": new_id("pot"), "household_id": hid, "name": "Etentjes & uitjes",
         "monthly_amount": 200, "categories": ["Uit eten"], "note": ""},
        {"pot_id": new_id("pot"), "household_id": hid, "name": "Kleding",
         "monthly_amount": 120, "categories": ["Kleding"], "note": ""},
        {"pot_id": new_id("pot"), "household_id": hid, "name": "Vervoer",
         "monthly_amount": 80, "categories": ["Vervoer"], "note": ""},
    ])


async def ensure_demo_goal(db, hid):
    """Idempotently add a demo savings goal (e.g. baby) as a pot with cost items."""
    if await db.pots.find_one({"household_id": hid, "target_date": {"$ne": None}}):
        return
    if await db.projects.find_one({"household_id": hid}):
        return  # legacy project will be migrated into a goal
    pot_id = new_id("pot")
    await db.pots.insert_one({
        "pot_id": pot_id, "household_id": hid, "name": "Kindje op komst",
        "monthly_amount": 300, "categories": [], "note": "",
        "target_date": "2027-03-01", "already_saved": 2500})
    await db.project_items.insert_many([
        {"item_id": new_id("pit"), "household_id": hid, "project_id": pot_id,
         "name": "Babykamer & meubels", "amount": 2200, "note": ""},
        {"item_id": new_id("pit"), "household_id": hid, "project_id": pot_id,
         "name": "Kinderwagen & autostoel", "amount": 1400, "note": ""},
        {"item_id": new_id("pit"), "household_id": hid, "project_id": pot_id,
         "name": "Verlof / inkomstenbuffer", "amount": 6000, "note": ""},
        {"item_id": new_id("pit"), "household_id": hid, "project_id": pot_id,
         "name": "Kleding & startspullen", "amount": 900, "note": ""},
    ])


async def migrate_projects_to_goals(db):
    """One-way migration: convert legacy 'projects' docs into 'pots' (goals),
    re-pointing their project_items. Idempotent (projects collection empties out)."""
    cursor = db.projects.find({})
    async for pr in cursor:
        pot_id = new_id("pot")
        await db.pots.insert_one({
            "pot_id": pot_id, "household_id": pr["household_id"],
            "name": pr.get("name", "Doel"), "monthly_amount": 0, "categories": [],
            "note": pr.get("note", ""), "target_date": pr.get("target_date"),
            "already_saved": float(pr.get("already_saved") or 0)})
        await db.project_items.update_many(
            {"project_id": pr["project_id"]}, {"$set": {"project_id": pot_id}})
        await db.projects.delete_one({"project_id": pr["project_id"]})
