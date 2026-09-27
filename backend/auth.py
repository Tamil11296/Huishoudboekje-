"""Inloggen met Google. Alleen e-mailadressen op de toegangslijst of met een openstaande
uitnodiging komen erin; er is geen wachtwoordlogin en geen vrije registratie."""
import logging
from datetime import datetime, timezone

import jwt
from fastapi import APIRouter, Request, Response, HTTPException, Depends, Body

from deps import (db, new_id, create_access_token, create_refresh_token, set_auth_cookies,
                  set_access_cookie, clear_auth_cookies, public_user, get_current_user,
                  get_jwt_secret, JWT_ALGORITHM, GOOGLE_CLIENT_ID, ALLOWED_EMAILS, log_change)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


def verify_google_credential(credential: str) -> dict:
    """Controleert het ID-token van Google Identity Services en geeft de claims terug.
    In tests wordt deze functie vervangen."""
    from google.oauth2 import id_token
    from google.auth.transport import requests as google_requests
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_ID is niet ingesteld")
    try:
        return id_token.verify_oauth2_token(credential, google_requests.Request(), GOOGLE_CLIENT_ID)
    except ValueError:
        raise HTTPException(status_code=401, detail="Google-login ongeldig")


def _now():
    return datetime.now(timezone.utc)


def _invite_open(inv: dict) -> bool:
    if inv.get("accepted") or inv.get("revoked"):
        return False
    exp = inv.get("expires_at")
    if exp:
        exp_dt = datetime.fromisoformat(exp)
        if exp_dt.tzinfo is None:
            exp_dt = exp_dt.replace(tzinfo=timezone.utc)
        if exp_dt < _now():
            return False
    return True


async def open_invites_for(email: str) -> list:
    invs = await db.invites.find({"email": email}, {"_id": 0}).to_list(50)
    return [i for i in invs if _invite_open(i)]


async def may_login(email: str) -> bool:
    if email in ALLOWED_EMAILS:
        return True
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if user and await db.households.find_one({"member_ids": user["user_id"]}):
        return True
    return bool(await open_invites_for(email))


async def join_household_by_invite(inv: dict, user: dict) -> str | None:
    hh = await db.households.find_one({"household_id": inv["household_id"]}, {"_id": 0})
    if not hh:
        return None
    if user["user_id"] not in hh.get("member_ids", []):
        member = {"user_id": user["user_id"], "email": user["email"],
                  "name": user.get("name", ""), "role": "member"}
        await db.households.update_one({"household_id": hh["household_id"]},
                                       {"$push": {"members": member},
                                        "$addToSet": {"member_ids": user["user_id"]}})
        await log_change(hh["household_id"], user, "lid", f"{user['email']} is lid geworden")
    await db.invites.update_one({"token": inv["token"]},
                                {"$set": {"accepted": True, "accepted_at": _now().isoformat(),
                                          "accepted_by": user["user_id"]}})
    return hh["household_id"]


@router.post("/google")
async def google_login(response: Response, body: dict = Body(...)):
    claims = verify_google_credential(body.get("credential") or "")
    email = (claims.get("email") or "").lower().strip()
    if not email or not claims.get("email_verified"):
        raise HTTPException(status_code=401, detail="Google-account zonder geverifieerd e-mailadres")
    if not await may_login(email):
        logger.warning("Login geweigerd voor %s", email)
        raise HTTPException(status_code=403,
                            detail="Dit Google-account heeft geen toegang. Vraag om een uitnodiging.")

    user = await db.users.find_one({"email": email}, {"_id": 0})
    profile = {"name": claims.get("name") or email.split("@")[0],
               "picture": claims.get("picture", ""), "google_sub": claims.get("sub"),
               "last_login": _now().isoformat()}
    if user:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": profile})
        user.update(profile)
    else:
        user = {"user_id": new_id("user"), "email": email, "created_at": _now().isoformat(), **profile}
        await db.users.insert_one(dict(user))
        user.pop("_id", None)

    for inv in await open_invites_for(email):
        await join_household_by_invite(inv, user)

    set_auth_cookies(response, create_access_token(user["user_id"], email),
                     create_refresh_token(user["user_id"]))
    return public_user(user)


@router.post("/refresh")
async def refresh_token(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="Geen refresh token")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Sessie verlopen")
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Ongeldig token")
    user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0})
    if not user or user.get("disabled") or not await may_login(user["email"]):
        raise HTTPException(status_code=401, detail="Geen toegang meer")
    set_access_cookie(response, create_access_token(user["user_id"], user["email"]))
    return public_user(user)


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return public_user(user)


@router.post("/logout")
async def logout(response: Response):
    clear_auth_cookies(response)
    return {"ok": True}
