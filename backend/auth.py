import os
import httpx
import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Request, Response, HTTPException, Depends
from pydantic import BaseModel, EmailStr

from deps import (db, hash_password, verify_password, new_id, create_access_token,
                  create_refresh_token, set_auth_cookies, clear_auth_cookies,
                  public_user, get_current_user)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


class RegisterBody(BaseModel):
    email: EmailStr
    password: str
    name: str


class LoginBody(BaseModel):
    email: EmailStr
    password: str


async def _get_or_create_user(email, name, picture="", password=None, provider="password"):
    email = email.lower().strip()
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        return existing
    user = {
        "user_id": new_id("user"),
        "email": email,
        "name": name or email.split("@")[0],
        "picture": picture,
        "password_hash": hash_password(password) if password else None,
        "provider": provider,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user)
    user.pop("_id", None)
    return user


@router.post("/register")
async def register(body: RegisterBody, response: Response):
    email = body.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="E-mailadres is al geregistreerd")
    user = await _get_or_create_user(email, body.name, password=body.password)
    access = create_access_token(user["user_id"], email)
    refresh = create_refresh_token(user["user_id"])
    set_auth_cookies(response, access, refresh)
    return public_user(user)


@router.post("/login")
async def login(body: LoginBody, response: Response):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not user.get("password_hash") or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Onjuiste e-mail of wachtwoord")
    access = create_access_token(user["user_id"], email)
    refresh = create_refresh_token(user["user_id"])
    set_auth_cookies(response, access, refresh)
    return public_user(user)


@router.post("/session")
async def google_session(request: Request, response: Response):
    session_id = request.headers.get("X-Session-ID")
    if not session_id:
        body = {}
        try:
            body = await request.json()
        except Exception:
            pass
        session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="Geen session_id")
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": session_id})
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Sessie ongeldig")
    data = r.json()
    user = await _get_or_create_user(data["email"], data.get("name", ""),
                                     data.get("picture", ""), provider="google")
    session_token = data["session_token"]
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user["user_id"],
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    response.set_cookie("session_token", session_token, httponly=True, secure=True,
                        samesite="none", max_age=604800, path="/")
    return public_user(user)


@router.post("/refresh")
async def refresh_token(request: Request, response: Response):
    import jwt as _jwt
    from deps import get_jwt_secret, JWT_ALGORITHM
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="Geen refresh token")
    try:
        payload = _jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Ongeldig token")
    except _jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Ongeldig token")
    user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Gebruiker niet gevonden")
    access = create_access_token(user["user_id"], user["email"])
    response.set_cookie("access_token", access, httponly=True, secure=True,
                        samesite="none", max_age=43200, path="/")
    return public_user(user)


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return public_user(user)


@router.post("/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    clear_auth_cookies(response)
    return {"ok": True}
