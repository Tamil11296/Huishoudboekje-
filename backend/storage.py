"""Bijlagen (offertes, facturen, bonnen) opgeslagen in MongoDB zelf.
Geen externe opslagdienst nodig; maximaal 10 MB per bestand (MongoDB-limiet is 16 MB)."""
from datetime import datetime, timezone
import uuid

from bson import Binary

from deps import db

MAX_BYTES = 10 * 1024 * 1024
ALLOWED_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}


async def put_object(household_id: str, invoice_id: str, filename: str, content_type: str, data: bytes) -> str:
    att_id = uuid.uuid4().hex
    await db.attachments.insert_one({
        "att_id": att_id, "household_id": household_id, "invoice_id": invoice_id,
        "filename": filename[:200], "content_type": content_type, "size": len(data),
        "data": Binary(data), "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return att_id


async def get_object(household_id: str, invoice_id: str, att_id: str):
    doc = await db.attachments.find_one({"att_id": att_id, "household_id": household_id,
                                         "invoice_id": invoice_id}, {"_id": 0})
    if not doc:
        return None
    return {"filename": doc["filename"], "content_type": doc["content_type"], "data": bytes(doc["data"])}


async def delete_object(household_id: str, invoice_id: str, att_id: str):
    await db.attachments.delete_one({"att_id": att_id, "household_id": household_id,
                                     "invoice_id": invoice_id})
