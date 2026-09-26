import os
import logging
import httpx

logger = logging.getLogger(__name__)

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "huishoudbudget"

_key = None


async def _init(force: bool = False):
    global _key
    if _key and not force:
        return _key
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY})
        r.raise_for_status()
        _key = r.json()["storage_key"]
    return _key


async def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = await _init()
    async with httpx.AsyncClient(timeout=120) as c:
        url = f"{STORAGE_URL}/objects/{path}"
        r = await c.put(url, headers={"X-Storage-Key": key, "Content-Type": content_type}, content=data)
        if r.status_code == 404:
            key = await _init(force=True)
            r = await c.put(url, headers={"X-Storage-Key": key, "Content-Type": content_type}, content=data)
        r.raise_for_status()
        return r.json()


async def get_object(path: str):
    key = await _init()
    async with httpx.AsyncClient(timeout=60) as c:
        url = f"{STORAGE_URL}/objects/{path}"
        r = await c.get(url, headers={"X-Storage-Key": key})
        if r.status_code == 404:
            key = await _init(force=True)
            r = await c.get(url, headers={"X-Storage-Key": key})
        r.raise_for_status()
        return r.content, r.headers.get("Content-Type", "application/octet-stream")
