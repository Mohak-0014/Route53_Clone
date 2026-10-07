"""Change tracking: one row per submitted change, with a derived PENDING/INSYNC status."""
import math
from collections.abc import Sequence
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.errors import not_found
from app.models import Change, ResourceRecordSet
from app.schemas.change import ChangeInfo, ChangeOut
from app.services.zone_service import get_zone
from app.utils import generate_id, utcnow


def status(change: Change) -> str:
    """PENDING until the propagation delay has passed since submission, then INSYNC."""
    in_sync_at = change.submitted_at + timedelta(seconds=settings.propagation_seconds)
    return "INSYNC" if utcnow() >= in_sync_at else "PENDING"


def to_info(change: Change) -> ChangeInfo:
    return ChangeInfo(id=change.id, status=status(change), submitted_at=change.submitted_at)


def to_out(change: Change) -> ChangeOut:
    return ChangeOut(
        id=change.id,
        status=status(change),
        submitted_at=change.submitted_at,
        hosted_zone_id=change.hosted_zone_id,
        action=change.action,
        target=change.target,
        record_type=change.record_type,
        submitted_by=change.submitted_by,
    )


def describe(records: Sequence[ResourceRecordSet]) -> tuple[str, str | None]:
    """Target and record type for a change: "www.example.com A" for one record, "3 records" otherwise."""
    if len(records) == 1:
        return f"{records[0].name} {records[0].record_type}", records[0].record_type
    types = {r.record_type for r in records}
    return f"{len(records)} records", types.pop() if len(types) == 1 else None


def add(db: Session, zone_id: str, action: str, target: str, record_type: str | None, submitted_by: str) -> Change:
    """Stage a change row in the caller's transaction; it commits with the data change."""
    change = Change(
        id=generate_id("C", 20),
        hosted_zone_id=zone_id,
        action=action,
        target=target,
        record_type=record_type,
        submitted_by=submitted_by,
        submitted_at=utcnow(),
    )
    db.add(change)
    return change


def get_change(db: Session, change_id: str) -> Change:
    change = db.get(Change, change_id)
    if change is None:
        raise not_found("NoSuchChange", f"No change found with ID: {change_id}")
    return change


def list_changes(db: Session, zone_id: str, page: int, page_size: int) -> tuple[list[ChangeOut], int, int]:
    zone = get_zone(db, zone_id)
    total = db.scalar(select(func.count()).select_from(Change).where(Change.hosted_zone_id == zone.id)) or 0
    rows = db.scalars(
        select(Change)
        .where(Change.hosted_zone_id == zone.id)
        .order_by(Change.submitted_at.desc(), Change.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [to_out(c) for c in rows], total, max(1, math.ceil(total / page_size))
