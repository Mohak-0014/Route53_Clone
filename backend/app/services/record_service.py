"""DNS record (resource record set) business logic."""
import math

from sqlalchemy import case, exists, func, or_, select
from sqlalchemy.orm import Session

from app.errors import AppError, bad_request, concurrent_modification, conflict, not_found
from app.models import HostedZone, ResourceRecordSet
from app.schemas.change import ChangeInfo
from app.schemas.record import RecordCreate, RecordOut, RecordUpdate
from app.services import change_service
from app.services.validators import resolve_record_name, validate_value
from app.services.zone_service import get_zone
from app.utils import like_pattern


def is_default(zone: HostedZone, rec: ResourceRecordSet) -> bool:
    return rec.name == zone.name and rec.record_type in ("SOA", "NS")


def to_out(zone: HostedZone, rec: ResourceRecordSet) -> RecordOut:
    return RecordOut(
        id=rec.id,
        hosted_zone_id=rec.hosted_zone_id,
        name=rec.name,
        type=rec.record_type,
        ttl=rec.ttl,
        values=rec.values,
        routing_policy=rec.routing_policy,
        comment=rec.comment,
        is_default=is_default(zone, rec),
        version=rec.version,
        created_at=rec.created_at,
        updated_at=rec.updated_at,
    )


def list_records(
    db: Session,
    zone_id: str,
    search: str | None,
    record_type: str | None,
    page: int,
    page_size: int,
) -> tuple[HostedZone, list[RecordOut], int, int]:
    zone = get_zone(db, zone_id)
    stmt = select(ResourceRecordSet).where(ResourceRecordSet.hosted_zone_id == zone.id)
    if search:
        like = like_pattern(search)
        # Match each stored value as plain text (not the JSON encoding, whose quotes,
        # brackets and escapes would otherwise match too).
        value = func.json_each(ResourceRecordSet.values_json).table_valued("value").alias("v")
        value_match = exists(select(1).select_from(value).where(value.c.value.ilike(like, escape="\\")))
        stmt = stmt.where(or_(ResourceRecordSet.name.ilike(like, escape="\\"), value_match))
    if record_type:
        types = [t.strip().upper() for t in record_type.split(",") if t.strip()]
        stmt = stmt.where(ResourceRecordSet.record_type.in_(types))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    total_pages = max(1, math.ceil(total / page_size))
    # Apex records first (NS, SOA, then others), then alphabetical — like the console.
    order = [
        case((ResourceRecordSet.name == zone.name, 0), else_=1),
        case((ResourceRecordSet.record_type == "NS", 0), (ResourceRecordSet.record_type == "SOA", 1), else_=2),
        ResourceRecordSet.name,
        ResourceRecordSet.record_type,
    ]
    rows = db.scalars(stmt.order_by(*order).offset((page - 1) * page_size).limit(page_size)).all()
    return zone, [to_out(zone, r) for r in rows], total, total_pages


def get_record(db: Session, zone_id: str, record_id: str) -> tuple[HostedZone, ResourceRecordSet]:
    zone = get_zone(db, zone_id)
    rec = db.get(ResourceRecordSet, record_id)
    if rec is None or rec.hosted_zone_id != zone.id:
        raise not_found("NoSuchRecord", f"No record found with ID: {record_id}")
    return zone, rec


def _invalid(message: str) -> AppError:
    return bad_request("InvalidChangeBatch", message)


def _prepare(zone: HostedZone, data: RecordCreate) -> tuple[str, list[str]]:
    """Validate a record create/update payload and return (fqdn, normalized values)."""
    try:
        fqdn = resolve_record_name(data.name, zone.name)
    except ValueError as e:
        raise _invalid(str(e)) from None

    values: list[str] = []
    for raw in data.values:
        try:
            values.append(validate_value(data.type, raw))
        except ValueError as e:
            raise _invalid(str(e)) from None

    if len(set(values)) != len(values):
        raise _invalid("Duplicate values are not allowed in a single record.")
    if data.type == "CNAME":
        if len(values) != 1:
            raise _invalid("A CNAME record can contain only one value.")
        if fqdn == zone.name:
            raise _invalid(
                f"You can't create a CNAME record at the zone apex ({zone.name}). "
                "Use an A or AAAA record instead."
            )
    return fqdn, values


def _check_conflicts(
    db: Session, zone: HostedZone, fqdn: str, record_type: str, exclude_id: str | None = None
) -> None:
    stmt = select(ResourceRecordSet).where(
        ResourceRecordSet.hosted_zone_id == zone.id, ResourceRecordSet.name == fqdn
    )
    if exclude_id:
        stmt = stmt.where(ResourceRecordSet.id != exclude_id)
    same_name = db.scalars(stmt).all()
    for other in same_name:
        if other.record_type == record_type:
            raise conflict(
                "RecordAlreadyExists",
                f"A {record_type} record for {fqdn} already exists. "
                "Edit the existing record to add values.",
            )
    if record_type == "CNAME" and same_name:
        raise conflict(
            "CNAMEConflict",
            f"{fqdn} already has other records. A CNAME record can't coexist with other records of the same name.",
        )
    if any(o.record_type == "CNAME" for o in same_name):
        raise conflict(
            "CNAMEConflict",
            f"{fqdn} already has a CNAME record. Other records can't share a name with a CNAME.",
        )


def _log(db: Session, zone: HostedZone, action: str, recs: list[ResourceRecordSet], actor: str | None):
    """Stage the change row for a user action (seed data passes no actor and records none)."""
    if actor is None or not recs:
        return None
    target, record_type = change_service.describe(recs)
    return change_service.add(db, zone.id, action, target, record_type, actor)


def _info(change) -> ChangeInfo | None:
    return change_service.to_info(change) if change is not None else None


def create_record(
    db: Session, zone_id: str, data: RecordCreate, actor: str | None = None
) -> tuple[RecordOut, ChangeInfo | None]:
    zone = get_zone(db, zone_id)
    fqdn, values = _prepare(zone, data)
    _check_conflicts(db, zone, fqdn, data.type)
    rec = ResourceRecordSet(
        hosted_zone_id=zone.id,
        name=fqdn,
        record_type=data.type,
        ttl=data.ttl,
        values=values,
        comment=data.comment.strip(),
    )
    db.add(rec)
    db.flush()
    change = _log(db, zone, "CREATE", [rec], actor)
    db.commit()
    db.refresh(rec)
    return to_out(zone, rec), _info(change)


def create_records(
    db: Session, zone_id: str, batch: list[RecordCreate], actor: str | None = None
) -> tuple[list[RecordOut], ChangeInfo | None]:
    """Create several record sets atomically, like one Route 53 change batch.

    Each record is checked against the zone *and* the records before it in the batch;
    any failure rolls back the whole batch and names the offending record.
    """
    zone = get_zone(db, zone_id)
    created: list[ResourceRecordSet] = []
    try:
        for i, data in enumerate(batch, start=1):
            try:
                fqdn, values = _prepare(zone, data)
                _check_conflicts(db, zone, fqdn, data.type)
            except AppError as e:
                raise AppError(e.status_code, e.code, f"Record {i}: {e.message}") from None
            rec = ResourceRecordSet(
                hosted_zone_id=zone.id,
                name=fqdn,
                record_type=data.type,
                ttl=data.ttl,
                values=values,
                comment=data.comment.strip(),
            )
            db.add(rec)
            db.flush()  # later records in the batch must see this one in conflict checks
            created.append(rec)
        change = _log(db, zone, "CREATE", created, actor)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return [to_out(zone, r) for r in created], _info(change)


def update_record(
    db: Session, zone_id: str, record_id: str, data: RecordUpdate, actor: str | None = None
) -> tuple[RecordOut, ChangeInfo | None]:
    zone, rec = get_record(db, zone_id, record_id)
    if data.expected_version is not None and data.expected_version != rec.version:
        raise concurrent_modification()
    if is_default(zone, rec):
        # Default SOA/NS: values and TTL are editable, name and type are not.
        try:
            renamed = resolve_record_name(data.name, zone.name) != rec.name
        except ValueError:
            renamed = True
        if data.type != rec.record_type or renamed:
            raise _invalid(f"You can't change the name or type of the default {rec.record_type} record.")
        try:
            values = [validate_value(rec.record_type, v) for v in data.values]
        except ValueError as e:
            raise _invalid(str(e)) from None
        if rec.record_type == "SOA" and len(values) != 1:
            raise _invalid("The SOA record must contain exactly one value.")
        fqdn = rec.name
    else:
        fqdn, values = _prepare(zone, data)
        _check_conflicts(db, zone, fqdn, data.type, exclude_id=rec.id)

    rec.name = fqdn
    rec.record_type = data.type
    rec.ttl = data.ttl
    rec.values = values
    rec.comment = data.comment.strip()
    change = _log(db, zone, "UPSERT", [rec], actor)
    db.commit()
    db.refresh(rec)
    return to_out(zone, rec), _info(change)


def delete_record(db: Session, zone_id: str, record_id: str, actor: str | None = None) -> ChangeInfo | None:
    zone, rec = get_record(db, zone_id, record_id)
    if is_default(zone, rec):
        raise _invalid(
            f"You can't delete the {rec.record_type} record for the zone apex. "
            "Route 53 requires it while the hosted zone exists."
        )
    change = _log(db, zone, "DELETE", [rec], actor)
    db.delete(rec)
    db.commit()
    return _info(change)


def bulk_delete(
    db: Session, zone_id: str, record_ids: list[str], actor: str | None = None
) -> tuple[int, int, ChangeInfo | None]:
    zone = get_zone(db, zone_id)
    recs = db.scalars(
        select(ResourceRecordSet).where(
            ResourceRecordSet.hosted_zone_id == zone.id, ResourceRecordSet.id.in_(record_ids)
        )
    ).all()
    deletable = [r for r in recs if not is_default(zone, r)]
    change = _log(db, zone, "DELETE", deletable, actor)
    for r in deletable:
        db.delete(r)
    db.commit()
    return len(deletable), len(record_ids) - len(deletable), _info(change)
