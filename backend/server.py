import os
import io
import json
import hmac
import logging
from datetime import datetime, timezone
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Body, Response, Header, BackgroundTasks
from starlette.middleware.cors import CORSMiddleware

from deps import db, get_current_user, new_id, hash_password, verify_password, log_change, public_user
from auth import router as auth_router
from calc import (compute_dashboard, compute_bouwdepot_summary, compute_bouwpost_rollup,
                  compute_projects_summary, compute_pots_summary, compute_goals_summary,
                  derive_invoice_status)
from emailer import send_email, invite_email_html, pot_reminder_email_html
from seed_data import seed_demo, ensure_demo_pots, ensure_demo_goal, migrate_projects_to_goals
import uuid
from fastapi import UploadFile, File
from storage import put_object, get_object, APP_NAME
from export import build_excel, build_pdf
from llm import ask_claude

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI()
api_router = APIRouter(prefix="/api")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "")
WEBHOOK_CRON_SECRET = os.environ.get("WEBHOOK_CRON_SECRET", "")


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


async def _run_pot_reminders():
    now = datetime.now(timezone.utc)
    month = now.strftime("%Y-%m")
    households = await db.households.find({}, {"_id": 0}).to_list(1000)
    for hh in households:
        pots = await db.pots.find({"household_id": hh["household_id"]}, {"_id": 0}).to_list(200)
        unfunded = []
        for pot in pots:
            monthly = float(pot.get("monthly_amount") or 0)
            manual = pot.get("manual_contribution")
            if manual is None:
                manual = not (pot.get("categories") or [])
            if not manual or monthly <= 0:
                continue
            if float((pot.get("contributions") or {}).get(month) or 0) > 0.005:
                continue
            unfunded.append({"name": pot.get("name"), "amount": monthly})
        if not unfunded:
            continue
        html = pot_reminder_email_html(hh["name"], unfunded, FRONTEND_URL)
        for m in hh.get("members", []):
            em = m.get("email")
            if em:
                await send_email(to=em,
                                 subject=f"Herinnering: inleg doelen & sparen ({hh['name']})",
                                 html=html)


@api_router.post("/cron/pot-reminders")
async def cron_pot_reminders(background: BackgroundTasks, authorization: str = Header(None)):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    if not WEBHOOK_CRON_SECRET or not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="unauthorized")
    if not hmac.compare_digest(authorization.split(" ", 1)[1], WEBHOOK_CRON_SECRET):
        raise HTTPException(status_code=401, detail="unauthorized")
    background.add_task(_run_pot_reminders)
    return {"ok": True}


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
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "bin"
    att_id = uuid.uuid4().hex
    path = f"{APP_NAME}/{hid}/{invoice_id}/{att_id}.{ext}"
    data = await file.read()
    ct = file.content_type or "application/octet-stream"
    res = await put_object(path, data, ct)
    att = {"id": att_id, "path": res["path"], "filename": file.filename or f"bijlage.{ext}", "content_type": ct}
    await db.invoices.update_one({"invoice_id": invoice_id, "household_id": hid}, {"$push": {"attachments": att}})
    await log_change(hid, user, "bouwdepot", f"Bijlage toegevoegd aan '{inv.get('supplier', '?')}'")
    return att


@api_router.get("/households/{hid}/invoices/{invoice_id}/attachment/{att_id}")
async def get_invoice_attachment(hid: str, invoice_id: str, att_id: str,
                                 user: dict = Depends(get_current_user)):
    await require_household(hid, user)
    inv = await db.invoices.find_one({"invoice_id": invoice_id, "household_id": hid}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Niet gevonden")
    atts = inv.get("attachments") or ([inv["attachment"]] if inv.get("attachment") else [])
    att = next((a for a in atts if a.get("id") == att_id or a.get("path") == att_id), None)
    if not att:
        raise HTTPException(status_code=404, detail="Geen bijlage")
    data, ct = await get_object(att["path"])
    return Response(content=data, media_type=att.get("content_type", ct),
                    headers={"Content-Disposition": f'inline; filename="{att.get("filename", "offerte")}"'})


@api_router.delete("/households/{hid}/invoices/{invoice_id}/attachment/{att_id}")
async def delete_invoice_attachment(hid: str, invoice_id: str, att_id: str,
                                    user: dict = Depends(get_current_user)):
    await require_household(hid, user)
    await db.invoices.update_one({"invoice_id": invoice_id, "household_id": hid},
                                 {"$pull": {"attachments": {"id": att_id}}})
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


@api_router.post("/households/{hid}/goals/{pot_id}/tip")
async def goal_tip(hid: str, pot_id: str, user: dict = Depends(get_current_user)):
    hh = await require_household(hid, user)
    goals, avg, _dash = await _goals_ctx(hid, hh)
    g = next((x for x in goals if x["pot_id"] == pot_id), None)
    if not g:
        raise HTTPException(status_code=404, detail="Doel niet gevonden")
    status = "behaald" if g.get("completed") else ("op schema/haalbaar" if g.get("feasible") else "nog niet haalbaar binnen de tijd")
    system = ("Je bent een enthousiaste Nederlandse financiële coach. Antwoord in 1-2 korte zinnen "
              "(max 35 woorden), met euro-bedragen. Feliciteer als het doel is behaald; geef anders één "
              "concrete vervolgtip. Verzin geen getallen buiten de gegeven data.")
    prompt = (f"Doel '{g['name']}': saldo €{g['balance']}, doelbedrag €{g.get('total_cost', 0)}, "
              f"inleg €{g['monthly_amount']}/mnd, streefdatum {g.get('target_date') or 'geen'}, "
              f"per maand nodig €{g.get('required_monthly', 0)}, gem. overschot €{avg}/mnd, status: {status}.")
    reply = await ask_claude(new_id("gtip"), system, prompt)
    return {"tip": reply}


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


# ---------- AI assistant (Claude) ----------
async def _ai_context(hid, hh):
    now = datetime.now(timezone.utc)
    year = hh.get("dashboard_year") or now.year
    incomes = await db.incomes.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    fixed = await db.fixed_expenses.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    variable = await db.variable_expenses.find({"household_id": hid}, {"_id": 0}).to_list(2000)
    dash = compute_dashboard(hh, incomes, fixed, variable, year)
    a = dash["annual"]
    depots = await db.bouwdepots.find({"household_id": hid}, {"_id": 0}).to_list(100)
    bouwposten = await db.bouwposten.find({"household_id": hid}, {"_id": 0}).to_list(1000)
    invoices = await db.invoices.find({"household_id": hid}, {"_id": 0}).to_list(2000)
    depsum = [compute_bouwdepot_summary(d, bouwposten, invoices) for d in depots]
    variable2 = variable
    pots = await db.pots.find({"household_id": hid}, {"_id": 0}).to_list(200)
    cur_month = now.month if year == now.year else (12 if year < now.year else 0)
    potsum = compute_pots_summary(pots, variable2, year, cur_month, cur_month)
    L = [f"Huishouden '{hh['name']}', valuta EUR, dashboardjaar {year}. Vandaag: {now.date().isoformat()}.",
         f"Jaartotaal: inkomen €{a['income']}, totale lasten €{a['expenses']}, over €{a['over']}, "
         f"spaarquote {a['savings_rate']}%, gemiddeld €{a['avg_monthly_over']} per maand over.",
         "Uitgaven per categorie (jaar): " + ", ".join(f"{k} €{v}" for k, v in dash["expense_by_category"].items())]
    pp = ", ".join(f"{p['name']} houdt €{dash['per_person_year'][p['person_id']]['net']} over (jaar)"
                   for p in dash["persons"])
    if pp:
        L.append("Per persoon: " + pp)
    for d in depsum:
        L.append(f"Bouwdepot '{d['name']}': start €{d['start_amount']}, uitbetaald €{d['paid_out']}, "
                 f"vrij besteedbaar €{d['freely_available']}, dagen resterend {d['days_remaining']}.")
    if potsum["pots"]:
        def _pot_line(p):
            over = p["monthly_amount"] > 0 and p["spent_month"] > p["monthly_amount"]
            return (f"{p['name']}: deze maand besteed €{p['spent_month']} van €{p['monthly_amount']}/mnd (budget)"
                    f"{', OVER BUDGET' if over else ''}, saldo €{p['balance']}")
        L.append("Potjes (budget = maandbedrag): " + "; ".join(_pot_line(p) for p in potsum["pots"]))
    return "\n".join(L)


def _parse_json_list(raw):
    try:
        s = raw[raw.index("["):raw.rindex("]") + 1]
        return [str(x) for x in json.loads(s)][:5]
    except Exception:
        return [ln.strip("-•* ").strip() for ln in raw.splitlines() if ln.strip()][:3]


def _parse_json_obj(raw):
    try:
        return json.loads(raw[raw.index("{"):raw.rindex("}") + 1])
    except Exception:
        return {}


@api_router.post("/households/{hid}/ai/chat")
async def ai_chat(hid: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    hh = await require_household(hid, user)
    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Leeg bericht")
    session_id = body.get("session_id") or new_id("chat")
    context = await _ai_context(hid, hh)
    history = await db.ai_messages.find({"household_id": hid, "session_id": session_id}, {"_id": 0}) \
        .sort("ts", 1).to_list(12)
    hist_txt = "\n".join(f"{m['role']}: {m['content']}" for m in history[-8:])
    system = ("Je bent een behulpzame Nederlandse financiële assistent voor dit huishouden. "
              "Antwoord kort en concreet in het Nederlands, met euro-bedragen. Baseer je uitsluitend op de "
              "cijfers hieronder; verzin geen getallen. Als iets niet uit de data blijkt, zeg dat eerlijk.\n\n"
              "=== CIJFERS ===\n" + context)
    prompt = (f"Gesprek tot nu toe:\n{hist_txt}\n\n" if hist_txt else "") + f"Vraag: {message}"
    reply = await ask_claude(f"{hid}:{session_id}", system, prompt)
    ts = datetime.now(timezone.utc).isoformat()
    await db.ai_messages.insert_many([
        {"household_id": hid, "session_id": session_id, "role": "user", "content": message, "ts": ts},
        {"household_id": hid, "session_id": session_id, "role": "assistant", "content": reply, "ts": ts},
    ])
    return {"reply": reply, "session_id": session_id}


@api_router.post("/households/{hid}/ai/insights")
async def ai_insights(hid: str, user: dict = Depends(get_current_user)):
    hh = await require_household(hid, user)
    context = await _ai_context(hid, hh)
    system = ("Je bent een Nederlandse financiële coach. Geef op basis van de cijfers 3 korte, concrete "
              "observaties of bespaartips (elk max 20 woorden). Antwoord ALLEEN met een JSON-array van "
              "strings, niets anders.\n\n=== CIJFERS ===\n" + context)
    raw = await ask_claude(new_id("ins"), system, "Geef de 3 tips als JSON array van strings.")
    return {"tips": _parse_json_list(raw)}


@api_router.post("/households/{hid}/ai/categorize")
async def ai_categorize(hid: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    hh = await require_household(hid, user)
    desc = (body.get("description") or "").strip()
    if not desc:
        raise HTTPException(status_code=400, detail="Geef een omschrijving")
    expense_cats = hh.get("categories", {}).get("expense", [])
    pots = await db.pots.find({"household_id": hid}, {"_id": 0}).to_list(200)
    pot_names = [p["name"] for p in pots]
    system = ("Je bepaalt de beste uitgavencategorie en (optioneel) potje voor een uitgave in een Nederlands "
              f"huishoudboekje. Kies de categorie UITSLUITEND uit deze lijst: {expense_cats}. "
              f"Kies het potje uit: {pot_names} of gebruik null. "
              'Antwoord ALLEEN met JSON: {"category": "...", "pot": "... of null"}.')
    raw = await ask_claude(new_id("cat"), system, f"Uitgave: {desc} (bedrag: €{body.get('amount', '?')})")
    data = _parse_json_obj(raw)
    return {"category": data.get("category"), "pot": data.get("pot")}


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
        demo = await db.households.find_one({"owner_id": owner["user_id"], "demo": True}, {"_id": 0})
        if demo:
            await ensure_demo_pots(db, demo["household_id"])
            await ensure_demo_goal(db, demo["household_id"])
    await migrate_projects_to_goals(db)


@app.on_event("shutdown")
async def shutdown():
    from deps import client
    client.close()
