from datetime import datetime, timezone

from deps import new_id


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
