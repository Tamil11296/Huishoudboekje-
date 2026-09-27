"""Huishoudboekje API: huishoudens, budget, bouwdepot en doelen."""
import os
import json
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Body, Response, Request
from fastapi import UploadFile, File
from fastapi.responses import FileResponse
from starlette.middleware.cors import CORSMiddleware

from deps import db, get_current_user, new_id, log_change
from auth import router as auth_router, _invite_open, join_household_by_invite
from calc import (compute_dashboard, compute_bouwdepot_summary,
                  compute_projects_summary, compute_pots_summary, compute_goals_summary,
                  derive_invoice_status)
from emailer import send_email, email_enabled, invite_email_html
from seed_data import migrate_projects_to_goals
from storage import put_object, get_object, delete_object, ALLOWED_TYPES, MAX_BYTES
from export import build_excel, build_pdf

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(title="Huishoudboekje", docs_url=None, redoc_url=None, openapi_url=None)
api_router = APIRouter(prefix="/api")

APP_URL = os.environ.get("APP_URL", "").rstrip("/")
INVITE_DAYS = 14

# Alle collecties die bij een huishouden horen (voor verwijderen en back-up).
HOUSEHOLD_COLLECTIONS = ("incomes", "fixed_expenses", "variable_expenses", "bouwdepots",
                         "bouwposten", "invoices", "pots", "projects", "project_items",
                         "change_log", "invites")


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
    return {"message": "Huishoudboekje API"}


@api_router.get("/config")
async def public_config():
    """Openbare instellingen die de frontend nodig heeft (geen geheimen)."""
    from deps import GOOGLE_CLIENT_ID
    # demo: alleen tools/demo/demo_server.py zet dit aan. In productie verifieert de backend
    # altijd een echt Google-token, dus deze vlag geeft daar geen toegang.
    return {"google_client_id": GOOGLE_CLIENT_ID, "demo": os.environ.get("DEMO_MODE") == "1"}


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
        "quick_presets": [],
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
    updates = {k: body[k] for k in ("name", "split_rule", "dashboard_year", "quote_statuses", "quick_presets")
               if k in body}
    if updates:
        await db.households.update_one({"household_id": hid}, {"$set": updates})
        await log_change(hid, user, "instellingen", f"Instellingen bijgewerkt: {', '.join(updates.keys())}")
    return await db.households.find_one({"household_id": hid}, {"_id": 0})



@api_router.delete("/households/{hid}")
async def delete_household(hid: str, user: dict = Depends(get_current_user)):
    hh = await require_household(hid, user)
    require_owner(hh, user)
    for coll in HOUSEHOLD_COLLECTIONS:
        await db[coll].delete_many({"household_id": hid})
    await db.attachments.delete_many({"household_id": hid})
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
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Geldig e-mailadres vereist")
    if any((m.get("email") or "").lower() == email for m in hh.get("members", [])):
        raise HTTPException(status_code=400, detail="Deze persoon is al lid")
    # Eerdere openstaande uitnodigingen voor hetzelfde adres vervallen.
    await db.invites.update_many({"household_id": hid, "email": email, "accepted": False},
                                 {"$set": {"revoked": True}})
    token = new_id("invite") + new_id("x")[2:]
    now = datetime.now(timezone.utc)
    await db.invites.insert_one({
        "token": token, "household_id": hid, "household_name": hh["name"],
        "email": email, "invited_by": user.get("name") or user["email"],
        "accepted": False, "revoked": False, "created_at": now.isoformat(),
        "expires_at": (now + timedelta(days=INVITE_DAYS)).isoformat(),
    })
    base = APP_URL or ""
    link = f"{base}/invite/{token}"
    email_sent = False
    if email_enabled():
        email_sent = bool(await send_email(
            to=email, subject=f"Uitnodiging voor huishouden {hh['name']}",
            html=invite_email_html(user.get("name") or user["email"], hh["name"], link)))
    await log_change(hid, user, "uitnodiging", f"Partner uitgenodigd: {email}")
    return {"ok": True, "invite_link": link, "email_sent": email_sent,
            "expires_at": (now + timedelta(days=INVITE_DAYS)).isoformat()}


@api_router.get("/invites/{token}")
async def get_invite(token: str):
    inv = await db.invites.find_one({"token": token}, {"_id": 0})
    if not inv or not _invite_open(inv):
        raise HTTPException(status_code=404, detail="Uitnodiging niet gevonden of verlopen")
    return {"household_name": inv["household_name"], "invited_by": inv["invited_by"],
            "email": inv["email"]}


@api_router.post("/invites/{token}/accept")
async def accept_invite(token: str, user: dict = Depends(get_current_user)):
    inv = await db.invites.find_one({"token": token}, {"_id": 0})
    if not inv or not _invite_open(inv):
        raise HTTPException(status_code=404, detail="Uitnodiging niet gevonden of verlopen")
    if inv["email"] != user["email"].lower():
        raise HTTPException(status_code=403,
                            detail=f"Deze uitnodiging is voor {inv['email']}. Log in met dat Google-account.")
    hid = await join_household_by_invite(inv, user)
    if not hid:
        raise HTTPException(status_code=404, detail="Huishouden bestaat niet meer")
    return {"ok": True, "household_id": hid}


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
NUMERIC_FIELDS = {"amount", "amount_incl_vat", "invoice_amount", "paid_amount", "budget",
                  "start_amount", "monthly_amount", "already_saved", "priority"}


def _clean(fields, body, partial):
    out = {}
    for f in fields:
        if partial and f not in body:
            continue
        v = body.get(f)
        if f in NUMERIC_FIELDS and v not in (None, ""):
            try:
                v = float(str(v).replace(",", "."))
            except ValueError:
                raise HTTPException(status_code=400, detail=f"'{f}' moet een getal zijn")
        elif f in NUMERIC_FIELDS:
            v = None
        out[f] = v
    return out


def register_crud(path, coll, id_field, prefix, fields):
    @api_router.get(f"/households/{{hid}}/{path}", name=f"list_{coll}")
    async def _list(hid: str, user: dict = Depends(get_current_user)):
        await require_household(hid, user)
        return await db[coll].find({"household_id": hid}, {"_id": 0}).to_list(5000)

    @api_router.post(f"/households/{{hid}}/{path}", name=f"create_{coll}")
    async def _create(hid: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
        await require_household(hid, user)
        doc = {id_field: new_id(prefix), "household_id": hid, **_clean(fields, body, False)}
        await db[coll].insert_one(doc)
        doc.pop("_id", None)
        await log_change(hid, user, "toegevoegd",
                         f"{path}: {doc.get('description') or doc.get('name') or doc.get('source') or doc.get('supplier') or ''}")
        return doc

    @api_router.put(f"/households/{{hid}}/{path}/{{item_id}}", name=f"update_{coll}")
    async def _update(hid: str, item_id: str, body: dict = Body(...),
                      user: dict = Depends(get_current_user)):
        await require_household(hid, user)
        updates = _clean(fields, body, True)
        res = await db[coll].update_one({id_field: item_id, "household_id": hid}, {"$set": updates})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Niet gevonden")
        await log_change(hid, user, "gewijzigd", f"{path} bijgewerkt")
        return await db[coll].find_one({id_field: item_id, "household_id": hid}, {"_id": 0})

    @api_router.delete(f"/households/{{hid}}/{path}/{{item_id}}", name=f"delete_{coll}")
    async def _delete(hid: str, item_id: str, user: dict = Depends(get_current_user)):
        await require_household(hid, user)
        await db[coll].delete_one({id_field: item_id, "household_id": hid})
        if coll == "invoices":
            await db.attachments.delete_many({"household_id": hid, "invoice_id": item_id})
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
               "submitted_on", "paid_on", "description",
               "parent_quote_id", "termijn", "due_date", "paid_amount"])
register_crud("pots", "pots", "pot_id", "pot",
              ["name", "monthly_amount", "categories", "note", "target_date", "already_saved", "priority", "funded_by", "manual_contribution"])
register_crud("projects", "projects", "project_id", "proj",
              ["name", "target_date", "already_saved", "note"])
register_crud("project-items", "project_items", "item_id", "pit",
              ["project_id", "name", "amount", "note"])


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
    overdue = 0
    out = []
    for i in invoices:
        s = derive_invoice_status(i)
        if s == "telaat":
            overdue += 1
        atts = i.get("attachments") or (
            [{**i["attachment"], "id": i["attachment"].get("id", i["attachment"].get("path"))}]
            if i.get("attachment") else [])
        out.append({**i, "derived_status": s, "attachments": atts})
    return {"depots": summaries, "invoices": out, "bouwposten": bouwposten, "overdue_count": overdue}



@api_router.post("/households/{hid}/invoices/{invoice_id}/attachment")
async def upload_invoice_attachment(hid: str, invoice_id: str,
                                    file: UploadFile = File(...),
                                    user: dict = Depends(get_current_user)):
    await require_household(hid, user)
    inv = await db.invoices.find_one({"invoice_id": invoice_id, "household_id": hid})
    if not inv:
        raise HTTPException(status_code=404, detail="Factuur/offerte niet gevonden")
    ct = (file.content_type or "").lower()
    if ct not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Alleen PDF of afbeelding (jpg, png, webp, heic)")
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Bestand is groter dan 10 MB")
    att_id = await put_object(hid, invoice_id, file.filename or "bijlage", ct, data)
    att = {"id": att_id, "filename": file.filename or "bijlage", "content_type": ct}
    await db.invoices.update_one({"invoice_id": invoice_id, "household_id": hid}, {"$push": {"attachments": att}})
    await log_change(hid, user, "bouwdepot", f"Bijlage toegevoegd aan '{inv.get('supplier', '?')}'")
    return att


@api_router.get("/households/{hid}/invoices/{invoice_id}/attachment/{att_id}")
async def get_invoice_attachment(hid: str, invoice_id: str, att_id: str,
                                 user: dict = Depends(get_current_user)):
    await require_household(hid, user)
    obj = await get_object(hid, invoice_id, att_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Geen bijlage")
    safe_name = "".join(ch for ch in obj["filename"] if ch.isalnum() or ch in "._- ") or "bijlage"
    return Response(content=obj["data"], media_type=obj["content_type"],
                    headers={"Content-Disposition": f'inline; filename="{safe_name}"',
                             "X-Content-Type-Options": "nosniff"})


@api_router.delete("/households/{hid}/invoices/{invoice_id}/attachment/{att_id}")
async def delete_invoice_attachment(hid: str, invoice_id: str, att_id: str,
                                    user: dict = Depends(get_current_user)):
    await require_household(hid, user)
    await db.invoices.update_one({"invoice_id": invoice_id, "household_id": hid},
                                 {"$pull": {"attachments": {"id": att_id}}})
    await delete_object(hid, invoice_id, att_id)
    return {"ok": True}


# ---------- projects & saving ----------
@api_router.get("/households/{hid}/projects-summary")
async def projects_summary(hid: str, user: dict = Depends(get_current_user)):
    hh = await require_household(hid, user)
    year = hh.get("dashboard_year") or datetime.now(timezone.utc).year
    incomes = await db.incomes.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    fixed = await db.fixed_expenses.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    variable = await db.variable_expenses.find({"household_id": hid}, {"_id": 0}).to_list(2000)
    dash = compute_dashboard(hh, incomes, fixed, variable, year)
    avg = dash["annual"].get("avg_monthly_over", 0)
    projects = await db.projects.find({"household_id": hid}, {"_id": 0}).to_list(100)
    pitems = await db.project_items.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    return {"projects": compute_projects_summary(projects, pitems, avg), "avg_monthly_over": avg}


# ---------- export ----------
async def _gather_export(hid, hh):
    year = hh.get("dashboard_year") or datetime.now(timezone.utc).year
    incomes = await db.incomes.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    fixed = await db.fixed_expenses.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    variable = await db.variable_expenses.find({"household_id": hid}, {"_id": 0}).to_list(2000)
    dash = compute_dashboard(hh, incomes, fixed, variable, year)
    depots = await db.bouwdepots.find({"household_id": hid}, {"_id": 0}).to_list(100)
    bouwposten = await db.bouwposten.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    invoices = await db.invoices.find({"household_id": hid}, {"_id": 0}).to_list(2000)
    depot_sum = [compute_bouwdepot_summary(d, bouwposten, invoices) for d in depots]
    projects = await db.projects.find({"household_id": hid}, {"_id": 0}).to_list(100)
    pitems = await db.project_items.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    pots = await db.pots.find({"household_id": hid}, {"_id": 0}).to_list(200)
    now = datetime.now(timezone.utc)
    cur_month = now.month if year == now.year else (12 if year < now.year else 0)
    goals = compute_goals_summary(pots, pitems, variable, year, cur_month, cur_month,
                                  dash["annual"].get("avg_monthly_over", 0))["goals"]
    return {"household": hh, "dashboard": dash, "depots": depot_sum,
            "invoices": invoices, "goals": goals}


@api_router.get("/households/{hid}/export/{fmt}")
async def export_household(hid: str, fmt: str, user: dict = Depends(get_current_user)):
    hh = await require_household(hid, user)
    payload = await _gather_export(hid, hh)
    if fmt == "excel":
        data = build_excel(payload)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        fn = "overzicht.xlsx"
    elif fmt == "pdf":
        data = build_pdf(payload)
        media = "application/pdf"
        fn = "overzicht.pdf"
    else:
        raise HTTPException(status_code=400, detail="Onbekend formaat")
    return Response(content=data, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{fn}"'})


# ---------- potjes (envelope budget) ----------
@api_router.get("/households/{hid}/pots-summary")
async def pots_summary(hid: str, user: dict = Depends(get_current_user)):
    hh = await require_household(hid, user)
    now = datetime.now(timezone.utc)
    year = hh.get("dashboard_year") or now.year
    cur_month = now.month if year == now.year else (12 if year < now.year else 0)
    variable = await db.variable_expenses.find({"household_id": hid}, {"_id": 0}).to_list(2000)
    pots = await db.pots.find({"household_id": hid}, {"_id": 0}).to_list(200)
    res = compute_pots_summary(pots, variable, year, cur_month, cur_month)
    incomes = await db.incomes.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    fixed = await db.fixed_expenses.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    dash = compute_dashboard(hh, incomes, fixed, variable, year)
    avg = dash["annual"].get("avg_monthly_over", 0)
    res["avg_monthly_over"] = avg
    res["free_surplus"] = round(avg - res["total_monthly"], 2)
    return res


async def _goals_ctx(hid, hh):
    now = datetime.now(timezone.utc)
    year = hh.get("dashboard_year") or now.year
    cur_month = now.month if year == now.year else (12 if year < now.year else 0)
    variable = await db.variable_expenses.find({"household_id": hid}, {"_id": 0}).to_list(2000)
    pots = await db.pots.find({"household_id": hid}, {"_id": 0}).to_list(200)
    pitems = await db.project_items.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    incomes = await db.incomes.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    fixed = await db.fixed_expenses.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    dash = compute_dashboard(hh, incomes, fixed, variable, year)
    avg = dash["annual"].get("avg_monthly_over", 0)
    goals = compute_goals_summary(pots, pitems, variable, year, cur_month, cur_month, avg)["goals"]
    return goals, avg, dash


@api_router.post("/households/{hid}/goals/distribute")
async def distribute_goals(hid: str, apply: bool = False, user: dict = Depends(get_current_user)):
    hh = await require_household(hid, user)
    goals, avg, dash = await _goals_ctx(hid, hh)
    from datetime import date as _date

    def keyf(g):
        pr = g.get("priority")
        pr = pr if isinstance(pr, (int, float)) else 999
        td = g.get("target_date")
        try:
            d = _date.fromisoformat(str(td)[:10]) if td else _date.max
        except Exception:
            d = _date.max
        return (pr, d)

    alloc = {g["pot_id"]: 0.0 for g in goals}

    def fund(gs, budget):
        left = max(budget, 0)
        for g in sorted([x for x in gs if x.get("has_target") and x.get("remaining", 0) > 0], key=keyf):
            give = round(min(g["required_monthly"], max(left, 0)), 2)
            alloc[g["pot_id"]] = give
            left = round(left - give, 2)
        cont = sorted([g for g in gs if not g.get("has_target")], key=keyf)
        if cont and left > 0:
            each = round(left / len(cont), 2)
            for g in cont:
                alloc[g["pot_id"]] = each
            left = 0
        return max(left, 0)

    # Each person funds their own goals from their monthly surplus; leftover pools to joint.
    per_person = {pid: max(round(v.get("net", 0) / 12, 2), 0)
                  for pid, v in dash.get("per_person_year", {}).items()}
    pool = 0.0
    for pid, avail in per_person.items():
        pool += fund([g for g in goals if g.get("funded_by") == pid], avail)
    joint = [g for g in goals if g.get("funded_by") not in per_person]
    fund(joint, pool if per_person else max(avg, 0))

    plan = [{"pot_id": g["pot_id"], "name": g["name"], "current": g["monthly_amount"],
             "proposed": alloc[g["pot_id"]], "has_target": g.get("has_target", False),
             "priority": g.get("priority"), "funded_by": g.get("funded_by", "joint")} for g in goals]
    if apply:
        for pid, val in alloc.items():
            await db.pots.update_one({"pot_id": pid, "household_id": hid}, {"$set": {"monthly_amount": val}})
        await log_change(hid, user, "doelen", "Overschot automatisch verdeeld over doelen")
    return {"plan": plan, "avg_monthly_over": avg, "applied": apply}


@api_router.post("/households/{hid}/pots/confirm-all")
async def pots_confirm_all(hid: str, body: dict = Body(default={}), user: dict = Depends(get_current_user)):
    await require_household(hid, user)
    now = datetime.now(timezone.utc)
    month = body.get("month") or now.strftime("%Y-%m")
    amounts = body.get("amounts") or {}
    pots = await db.pots.find({"household_id": hid}, {"_id": 0}).to_list(200)
    n = 0
    for pot in pots:
        monthly = float(pot.get("monthly_amount") or 0)
        manual = pot.get("manual_contribution")
        if manual is None:
            manual = not (pot.get("categories") or [])
        if not manual or monthly <= 0:
            continue
        if float((pot.get("contributions") or {}).get(month) or 0) > 0.005:
            continue
        amt = float(amounts.get(pot["pot_id"], pot.get("monthly_amount")) or 0)
        if amt <= 0:
            continue
        await db.pots.update_one({"pot_id": pot["pot_id"], "household_id": hid},
                                 {"$inc": {f"contributions.{month}": round(amt, 2)}})
        n += 1
    if n:
        await log_change(hid, user, "inleg", f"{n} potje(s) inleg bevestigd voor {month}")
    return {"ok": True, "confirmed": n, "month": month}


@api_router.post("/households/{hid}/pots/{pot_id}/contribute")
async def pot_contribute(hid: str, pot_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    await require_household(hid, user)
    amount = round(float(body.get("amount") or 0), 2)
    month = body.get("month") or datetime.now(timezone.utc).strftime("%Y-%m")
    pot = await db.pots.find_one({"pot_id": pot_id, "household_id": hid})
    if not pot:
        raise HTTPException(status_code=404, detail="Potje niet gevonden")
    await db.pots.update_one({"pot_id": pot_id, "household_id": hid},
                             {"$inc": {f"contributions.{month}": amount}})
    await log_change(hid, user, "inleg", f"{pot.get('name')}: +€{amount} ({month})")
    doc = await db.pots.find_one({"pot_id": pot_id, "household_id": hid}, {"_id": 0})
    return {"ok": True, "month": month, "contribution": round((doc.get("contributions") or {}).get(month, 0), 2)}


@api_router.get("/households/{hid}/goals-summary")
async def goals_summary(hid: str, user: dict = Depends(get_current_user)):
    hh = await require_household(hid, user)
    now = datetime.now(timezone.utc)
    year = hh.get("dashboard_year") or now.year
    cur_month = now.month if year == now.year else (12 if year < now.year else 0)
    variable = await db.variable_expenses.find({"household_id": hid}, {"_id": 0}).to_list(2000)
    pots = await db.pots.find({"household_id": hid}, {"_id": 0}).to_list(200)
    pitems = await db.project_items.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    incomes = await db.incomes.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    fixed = await db.fixed_expenses.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    dash = compute_dashboard(hh, incomes, fixed, variable, year)
    avg = dash["annual"].get("avg_monthly_over", 0)
    res = compute_goals_summary(pots, pitems, variable, year, cur_month, cur_month, avg)
    today = datetime.now(timezone.utc).date().isoformat()
    for g in res["goals"]:
        pot = next((p for p in pots if p["pot_id"] == g["pot_id"]), {})
        existing = pot.get("completed_at")
        if g["completed"] and not existing:
            await db.pots.update_one({"pot_id": g["pot_id"], "household_id": hid}, {"$set": {"completed_at": today}})
            g["completed_at"] = today
        elif not g["completed"] and existing:
            await db.pots.update_one({"pot_id": g["pot_id"], "household_id": hid}, {"$unset": {"completed_at": ""}})
            g["completed_at"] = None
        else:
            g["completed_at"] = existing
    res["avg_monthly_over"] = avg
    res["free_surplus"] = round(avg - res.get("savings_planned_monthly", res["total_monthly"]), 2)
    res["month"] = f"{year}-{cur_month:02d}" if cur_month else None
    res["unconfirmed_this_month"] = [
        {"pot_id": g["pot_id"], "name": g["name"], "monthly_amount": g["monthly_amount"]}
        for g in res["goals"] if g.get("needs_contribution") and not g.get("confirmed_this_month")
    ]
    return res



# ---------- back-up ----------
@api_router.get("/households/{hid}/backup")
async def backup_household(hid: str, user: dict = Depends(get_current_user)):
    """Volledige back-up (JSON) van een huishouden, zonder bijlagen."""
    hh = await require_household(hid, user)
    out = {"version": 1, "exported_at": datetime.now(timezone.utc).isoformat(), "household": hh}
    for coll in HOUSEHOLD_COLLECTIONS:
        if coll == "invites":
            continue
        out[coll] = await db[coll].find({"household_id": hid}, {"_id": 0}).to_list(20000)
    body = json.dumps(out, ensure_ascii=False, default=str, indent=1)
    fn = f"backup-{datetime.now(timezone.utc).date().isoformat()}.json"
    return Response(content=body, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{fn}"'})


@api_router.post("/households/{hid}/restore")
async def restore_household(hid: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    """Zet een back-up terug in dit huishouden. Vervangt alle regels; leden en eigenaar blijven."""
    hh = await require_household(hid, user)
    require_owner(hh, user)
    if body.get("version") != 1:
        raise HTTPException(status_code=400, detail="Onbekend back-upformaat")
    src = body.get("household") or {}
    keep = {k: src[k] for k in ("name", "persons", "categories", "quote_statuses", "quick_presets",
                               "split_rule", "dashboard_year") if k in src}
    if keep:
        await db.households.update_one({"household_id": hid}, {"$set": keep})
    counts = {}
    for coll in HOUSEHOLD_COLLECTIONS:
        if coll in ("invites", "change_log"):
            continue
        rows = []
        for r in body.get(coll) or []:
            r = {k: v for k, v in r.items() if k not in ("_id", "attachment", "attachments")}
            r["household_id"] = hid
            if coll == "invoices":
                r["attachments"] = []  # bijlagen zitten niet in de back-up
            rows.append(r)
        await db[coll].delete_many({"household_id": hid})
        if rows:
            await db[coll].insert_many(rows)
        counts[coll] = len(rows)
    await log_change(hid, user, "herstel", f"Back-up teruggezet: {counts}")
    return {"ok": True, "counts": counts}



# ---------- app wiring ----------
app.include_router(auth_router)
app.include_router(api_router)

_cors = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip() and o.strip() != "*"]
if _cors:  # alleen nodig als frontend en backend op verschillende adressen draaien (lokaal ontwikkelen)
    app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=_cors,
                       allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    if request.url.path.startswith("/api/"):
        resp.headers.setdefault("Cache-Control", "no-store")
    return resp


@app.on_event("startup")
async def startup():
    from deps import get_jwt_secret
    get_jwt_secret()  # stopt direct als JWT_SECRET ontbreekt
    await db.users.create_index("email", unique=True)
    await db.households.create_index("member_ids")
    await db.invites.create_index("token", unique=True)
    await migrate_projects_to_goals(db)


@app.on_event("shutdown")
async def shutdown():
    from deps import client
    client.close()


# ---------- frontend (gebouwde React-app) ----------
STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).parent / "static"))

if STATIC_DIR.is_dir():
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        target = (STATIC_DIR / full_path).resolve()
        if full_path and target.is_file() and STATIC_DIR.resolve() in target.parents:
            headers = {"Cache-Control": "public, max-age=31536000, immutable"} \
                if full_path.startswith("static/") else {"Cache-Control": "no-cache"}
            return FileResponse(target, headers=headers)
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})
