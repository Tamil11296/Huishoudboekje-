import os
import uuid
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dotenv import load_dotenv
from fastapi import Request, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_ALGORITHM = "HS256"


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email,
               "exp": datetime.now(timezone.utc) + timedelta(hours=12), "type": "access"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id,
               "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def set_auth_cookies(response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=True,
                        samesite="none", max_age=43200, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True,
                        samesite="none", max_age=604800, path="/")


def clear_auth_cookies(response):
    for k in ("access_token", "refresh_token", "session_token"):
        response.delete_cookie(k, path="/")


def public_user(user: dict) -> dict:
    return {"user_id": user["user_id"], "email": user["email"],
            "name": user.get("name", ""), "picture": user.get("picture", "")}


async def _user_from_jwt(token: str):
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            return None
        return await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0})
    except jwt.PyJWTError:
        return None


async def _user_from_session(token: str):
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        return None
    expires_at = sess["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        return None
    return await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})


async def get_current_user(request: Request) -> dict:
    # Try JWT access token first (cookie then bearer), then Google session token.
    access = request.cookies.get("access_token")
    session = request.cookies.get("session_token")
    bearer = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        bearer = auth_header[7:]

    user = None
    if access:
        user = await _user_from_jwt(access)
    if not user and bearer:
        user = await _user_from_jwt(bearer)
    if not user and session:
        user = await _user_from_session(session)
    if not user and bearer:
        user = await _user_from_session(bearer)

    if not user:
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
