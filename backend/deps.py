"""Gedeelde onderdelen: database, instellingen, JWT-sessies en de ingelogde gebruiker."""
import os
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import jwt
from dotenv import load_dotenv
from fastapi import Request, HTTPException

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")


def _csv(name: str) -> list[str]:
    return [x.strip().lower() for x in os.environ.get(name, "").split(",") if x.strip()]


# ---------- instellingen ----------
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "huishoudboekje")
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
# E-mailadressen die altijd mogen inloggen (komma-gescheiden). Uitgenodigde partners
# krijgen toegang via hun uitnodiging en hoeven hier niet in te staan.
ALLOWED_EMAILS = _csv("ALLOWED_EMAILS")
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() != "false"
ACCESS_HOURS = 12
REFRESH_DAYS = 30
JWT_ALGORITHM = "HS256"

if os.environ.get("USE_MONGOMOCK") == "1":  # alleen voor tests
    from mongomock_motor import AsyncMongoMockClient
    client = AsyncMongoMockClient()
else:
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]


def get_jwt_secret() -> str:
    secret = os.environ.get("JWT_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("JWT_SECRET ontbreekt of is korter dan 32 tekens")
    return secret


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


# ---------- sessie-cookies ----------
def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "type": "access",
               "exp": datetime.now(timezone.utc) + timedelta(hours=ACCESS_HOURS)}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "type": "refresh",
               "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_DAYS)}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def _cookie(response, key, value, max_age, path="/"):
    response.set_cookie(key, value, httponly=True, secure=COOKIE_SECURE,
                        samesite="lax", max_age=max_age, path=path)


def set_access_cookie(response, access: str):
    _cookie(response, "access_token", access, ACCESS_HOURS * 3600)


def set_auth_cookies(response, access: str, refresh: str):
    set_access_cookie(response, access)
    _cookie(response, "refresh_token", refresh, REFRESH_DAYS * 86400, path="/api/auth")


def clear_auth_cookies(response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/api/auth")


def public_user(user: dict) -> dict:
    return {"user_id": user["user_id"], "email": user["email"],
            "name": user.get("name", ""), "picture": user.get("picture", "")}


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Niet ingelogd")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Sessie verlopen")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Ongeldig token")
    user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0})
    if not user or user.get("disabled"):
        raise HTTPException(status_code=401, detail="Niet ingelogd")
    return user


async def log_change(household_id: str, user: dict, action: str, detail: str):
    await db.change_log.insert_one({
        "log_id": new_id("log"),
        "household_id": household_id,
        "user_id": user["user_id"],
        "user_name": user.get("name") or user.get("email"),
        "action": action,
        "detail": detail,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
