import os
import logging
from datetime import datetime, timezone
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Body
from starlette.middleware.cors import CORSMiddleware

from deps import db, get_current_user, new_id, hash_password, verify_password, log_change, public_user
from auth import router as auth_router
from calc import compute_dashboard, compute_bouwdepot_summary, compute_bouwpost_rollup
from emailer import send_email, invite_email_html
from seed_data import seed_demo

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI()
api_router = APIRouter(prefix="/api")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "")


# ---------- helpers ----------
async def require_household(hid: str, user: dict):
    hh = await db.households.find_one({"household_id": hid}, {"_id": 0})
    if not hh:
        raise HTTPException(status_code=404, detail="Huishouden niet gevonden")
    if user["user_id"] not in hh.get("member_ids", []):
        raise HTTPException(status_code=403, detail="Geen toegang tot dit huishouden")
    return hh


def require_owner(hh: dict, user: dict):
    if hh.get("owner_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Alleen de eigenaar mag dit doen")


@api_router.get("/")
async def root():
    return {"message": "Huishoudbudget & Bouwdepot API"}


# ---------- households ----------
@api_router.get("/households")
async def list_households(user: dict = Depends(get_current_user)):
    return await db.households.find({"member_ids": user["user_id"]}, {"_id": 0}).to_list(100)


@api_router.post("/households")
async def create_household(body: dict = Body(...), user: dict = Depends(get_current_user)):
    hid = new_id("hh")
    hh = {
        "household_id": hid,
        "name": body.get("name", "Mijn huishouden"),
        "owner_id": user["user_id"],
        "members": [{"user_id": user["user_id"], "email": user["email"],
                     "name": user.get("name", ""), "role": "owner"}],
        "member_ids": [user["user_id"]],
        "persons": [{"person_id": new_id("prs"), "name": user.get("name") or "Persoon 1"}],
        "categories": {
            "income": ["Salaris", "Bonus", "Toeslagen"],
            "expense": ["Hypotheek/Huur", "Energie", "Verzekeringen", "Boodschappen", "Abonnementen"],
            "bouwpost": ["Keuken", "Badkamer", "Tuin", "Overig"],
        },
        "quote_statuses": ["ontvangen", "geaccepteerd"],
        "split_rule": body.get("split_rule", "5050"),
        "currency": "EUR",
        "dashboard_year": datetime.now(timezone.utc).year,
        "demo": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.households.insert_one(hh)
    hh.pop("_id", None)
    await log_change(hid, user, "aangemaakt", f"Huishouden '{hh['name']}' aangemaakt")
    return hh


@api_router.get("/households/{hid}")
async def get_household(hid: str, user: dict = Depends(get_current_user)):
    return await require_household(hid, user)


@api_router.patch("/households/{hid}")
async def update_household(hid: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    hh = await require_household(hid, user)
    updates = {k: body[k] for k in ("name", "split_rule", "dashboard_year", "quote_statuses")
               if k in body}
    if updates:
        await db.households.update_one({"household_id": hid}, {"$set": updates})
        await log_change(hid, user, "instellingen", f"Instellingen bijgewerkt: {', '.join(updates.keys())}")
    return await db.households.find_one({"household_id": hid}, {"_id": 0})


@api_router.delete("/households/{hid}")
async def delete_household(hid: str, user: dict = Depends(get_current_user)):
    hh = await require_household(hid, user)
    require_owner(hh, user)
    for coll in ("incomes", "fixed_expenses", "variable_expenses", "bouwdepots",
                 "bouwposten", "invoices", "change_log"):
        await db[coll].delete_many({"household_id": hid})
    await db.households.delete_one({"household_id": hid})
    return {"ok": True}


# ---------- persons ----------
@api_router.post("/households/{hid}/persons")
async def add_person(hid: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    await require_household(hid, user)
    person = {"person_id": new_id("prs"), "name": body.get("name", "Persoon")}
    await db.households.update_one({"household_id": hid}, {"$push": {"persons": person}})
    await log_change(hid, user, "persoon", f"Persoon '{person['name']}' toegevoegd")
    return await db.households.find_one({"household_id": hid}, {"_id": 0})


@api_router.delete("/households/{hid}/persons/{pid}")
async def remove_person(hid: str, pid: str, user: dict = Depends(get_current_user)):
    await require_household(hid, user)
    await db.households.update_one({"household_id": hid},
                                   {"$pull": {"persons": {"person_id": pid}}})
    return await db.households.find_one({"household_id": hid}, {"_id": 0})


# ---------- categories ----------
@api_router.post("/households/{hid}/categories")
async def add_category(hid: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    await require_household(hid, user)
    ctype, name = body.get("type"), body.get("name")
    if ctype not in ("income", "expense", "bouwpost") or not name:
        raise HTTPException(status_code=400, detail="Ongeldige categorie")
    await db.households.update_one({"household_id": hid},
                                   {"$addToSet": {f"categories.{ctype}": name}})
    return await db.households.find_one({"household_id": hid}, {"_id": 0})


@api_router.delete("/households/{hid}/categories")
async def remove_category(hid: str, type: str, name: str, user: dict = Depends(get_current_user)):
    await require_household(hid, user)
    await db.households.update_one({"household_id": hid},
                                   {"$pull": {f"categories.{type}": name}})
    return await db.households.find_one({"household_id": hid}, {"_id": 0})


# ---------- invites & members ----------
@api_router.post("/households/{hid}/invite")
async def invite_partner(hid: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    hh = await require_household(hid, user)
    require_owner(hh, user)
    email = (body.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=400, detail="E-mailadres vereist")
    token = new_id("invite")
    await db.invites.insert_one({
        "token": token, "household_id": hid, "household_name": hh["name"],
        "email": email, "invited_by": user.get("name") or user["email"],
        "accepted": False, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    link = f"{FRONTEND_URL}/invite/{token}"
    email_id = await send_email(
        to=email,
        subject=f"Uitnodiging voor huishouden {hh['name']}",
        html=invite_email_html(user.get("name") or user["email"], hh["name"], link),
    )
    await log_change(hid, user, "uitnodiging", f"Partner uitgenodigd: {email}")
    return {"ok": True, "token": token, "invite_link": link, "email_sent": bool(email_id)}


@api_router.get("/invites/{token}")
async def get_invite(token: str):
    inv = await db.invites.find_one({"token": token}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Uitnodiging niet gevonden")
    return {"household_name": inv["household_name"], "invited_by": inv["invited_by"],
            "accepted": inv["accepted"], "email": inv["email"]}


@api_router.post("/invites/{token}/accept")
async def accept_invite(token: str, user: dict = Depends(get_current_user)):
    inv = await db.invites.find_one({"token": token}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Uitnodiging niet gevonden")
    hh = await db.households.find_one({"household_id": inv["household_id"]}, {"_id": 0})
    if not hh:
        raise HTTPException(status_code=404, detail="Huishouden bestaat niet meer")
    if user["user_id"] not in hh.get("member_ids", []):
        member = {"user_id": user["user_id"], "email": user["email"],
                  "name": user.get("name", ""), "role": "member"}
        await db.households.update_one({"household_id": hh["household_id"]},
                                       {"$push": {"members": member},
                                        "$addToSet": {"member_ids": user["user_id"]}})
        await log_change(hh["household_id"], user, "lid", f"{user['email']} is lid geworden")
    await db.invites.update_one({"token": token}, {"$set": {"accepted": True}})
    return {"ok": True, "household_id": hh["household_id"]}


@api_router.delete("/households/{hid}/members/{uid}")
async def remove_member(hid: str, uid: str, user: dict = Depends(get_current_user)):
    hh = await require_household(hid, user)
    require_owner(hh, user)
    if uid == hh["owner_id"]:
        raise HTTPException(status_code=400, detail="Eigenaar kan niet verwijderd worden")
    await db.households.update_one({"household_id": hid},
                                   {"$pull": {"members": {"user_id": uid}, "member_ids": uid}})
    return await db.households.find_one({"household_id": hid}, {"_id": 0})


@api_router.get("/households/{hid}/changelog")
async def get_changelog(hid: str, user: dict = Depends(get_current_user)):
    await require_household(hid, user)
    return await db.change_log.find({"household_id": hid}, {"_id": 0}) \
        .sort("timestamp", -1).to_list(200)


# ---------- generic CRUD for line-item collections ----------
def register_crud(path, coll, id_field, prefix, fields):
    @api_router.get(f"/households/{{hid}}/{path}", name=f"list_{coll}")
    async def _list(hid: str, user: dict = Depends(get_current_user)):
        await require_household(hid, user)
        return await db[coll].find({"household_id": hid}, {"_id": 0}).to_list(1000)

    @api_router.post(f"/households/{{hid}}/{path}", name=f"create_{coll}")
    async def _create(hid: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
        await require_household(hid, user)
        doc = {id_field: new_id(prefix), "household_id": hid}
        for f in fields:
            doc[f] = body.get(f)
        await db[coll].insert_one(doc)
        doc.pop("_id", None)
        await log_change(hid, user, "toegevoegd",
                         f"{path}: {doc.get('description') or doc.get('name') or doc.get('source') or doc.get('supplier') or ''}")
        return doc

    @api_router.put(f"/households/{{hid}}/{path}/{{item_id}}", name=f"update_{coll}")
    async def _update(hid: str, item_id: str, body: dict = Body(...),
                      user: dict = Depends(get_current_user)):
        await require_household(hid, user)
        updates = {f: body[f] for f in fields if f in body}
        await db[coll].update_one({id_field: item_id, "household_id": hid}, {"$set": updates})
        await log_change(hid, user, "gewijzigd", f"{path} bijgewerkt")
        return await db[coll].find_one({id_field: item_id}, {"_id": 0})

    @api_router.delete(f"/households/{{hid}}/{path}/{{item_id}}", name=f"delete_{coll}")
    async def _delete(hid: str, item_id: str, user: dict = Depends(get_current_user)):
        await require_household(hid, user)
        await db[coll].delete_one({id_field: item_id, "household_id": hid})
        await log_change(hid, user, "verwijderd", f"{path} verwijderd")
        return {"ok": True}


register_crud("incomes", "incomes", "income_id", "inc",
              ["person_id", "source", "amount", "frequency", "start_date", "end_date"])
register_crud("fixed-expenses", "fixed_expenses", "item_id", "fex",
              ["category", "description", "amount", "frequency", "start_date", "end_date", "paid_by"])
register_crud("variable-expenses", "variable_expenses", "item_id", "vex",
              ["category", "description", "amount", "month", "paid_by"])
register_crud("bouwdepots", "bouwdepots", "bouwdepot_id", "dep",
              ["name", "start_amount", "start_date", "end_date", "active"])
register_crud("bouwposten", "bouwposten", "bouwpost_id", "bp",
              ["name", "category", "budget", "bouwdepot_id"])
register_crud("invoices", "invoices", "invoice_id", "inv",
              ["supplier", "bouwpost_id", "bouwdepot_id", "type", "amount_incl_vat",
               "valid_until", "status", "invoice_amount", "submitted_to_bank",
               "submitted_on", "paid_on", "description"])


# ---------- dashboard ----------
@api_router.get("/households/{hid}/dashboard")
async def dashboard(hid: str, year: int = None, user: dict = Depends(get_current_user)):
    hh = await require_household(hid, user)
    year = year or hh.get("dashboard_year") or datetime.now(timezone.utc).year
    incomes = await db.incomes.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    fixed = await db.fixed_expenses.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    variable = await db.variable_expenses.find({"household_id": hid}, {"_id": 0}).to_list(2000)
    return compute_dashboard(hh, incomes, fixed, variable, year)


# ---------- bouwdepot summary ----------
@api_router.get("/households/{hid}/bouwdepot-summary")
async def bouwdepot_summary(hid: str, user: dict = Depends(get_current_user)):
    await require_household(hid, user)
    depots = await db.bouwdepots.find({"household_id": hid}, {"_id": 0}).to_list(100)
    bouwposten = await db.bouwposten.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    invoices = await db.invoices.find({"household_id": hid}, {"_id": 0}).to_list(2000)
    summaries = [compute_bouwdepot_summary(d, bouwposten, invoices) for d in depots]
    return {"depots": summaries, "invoices": invoices, "bouwposten": bouwposten}


# ---------- app wiring ----------
app.include_router(auth_router)
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[o for o in os.environ.get('CORS_ORIGINS', '*').split(',') if o],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.user_sessions.create_index("session_token")
    await db.households.create_index("member_ids")
    admin_email = os.environ.get("ADMIN_EMAIL", "").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "")
    if admin_email and admin_password:
        existing = await db.users.find_one({"email": admin_email})
        if not existing:
            owner = {"user_id": new_id("user"), "email": admin_email,
                     "name": "Robeson", "picture": "",
                     "password_hash": hash_password(admin_password), "provider": "password",
                     "created_at": datetime.now(timezone.utc).isoformat()}
            await db.users.insert_one(owner)
        elif not verify_password(admin_password, existing.get("password_hash", "") or ""):
            await db.users.update_one({"email": admin_email},
                                      {"$set": {"password_hash": hash_password(admin_password)}})
        owner = await db.users.find_one({"email": admin_email}, {"_id": 0})
        await seed_demo(db, owner)


@app.on_event("shutdown")
async def shutdown():
    from deps import client
    client.close()
