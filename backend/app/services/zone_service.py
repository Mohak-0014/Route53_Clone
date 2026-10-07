"""Hosted zone business logic."""
import math
import random
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.errors import AppError, conflict, not_found
from app.models import HostedZone, ResourceRecordSet
from app.schemas.hosted_zone import HostedZoneCreate, HostedZoneOut, HostedZoneUpdate
from app.utils import like_pattern

_NS_TLDS = ["com", "net", "org", "co.uk"]


def _default_name_servers() -> list[str]:
    """Four name servers spread across TLDs, like a Route 53 delegation set."""
    return [
        f"ns-{random.randint(0, 2047)}.awsdns-{random.randint(0, 63):02d}.{tld}"
        for tld in _NS_TLDS
    ]


def _record_count_subquery():
    return (
        select(ResourceRecordSet.hosted_zone_id, func.count().label("cnt"))
        .group_by(ResourceRecordSet.hosted_zone_id)
        .subquery()
    )


def _apex_ns(db: Session, zones: list[HostedZone]) -> dict[str, list[str]]:
    """Apex NS values for several zones in one query (zone ID → name servers)."""
    if not zones:
        return {}
    rows = db.scalars(
        select(ResourceRecordSet)
        .join(HostedZone, HostedZone.id == ResourceRecordSet.hosted_zone_id)
        .where(
            ResourceRecordSet.hosted_zone_id.in_([z.id for z in zones]),
            ResourceRecordSet.name == HostedZone.name,
            ResourceRecordSet.record_type == "NS",
        )
    )
    return {r.hosted_zone_id: r.values for r in rows}


def to_out(
    db: Session,
    zone: HostedZone,
    record_count: int | None = None,
    name_servers: list[str] | None = None,
) -> HostedZoneOut:
    if record_count is None:
        record_count = db.scalar(
            select(func.count()).where(ResourceRecordSet.hosted_zone_id == zone.id)
        ) or 0
    if name_servers is None:
        name_servers = _apex_ns(db, [zone]).get(zone.id, [])
    return HostedZoneOut(
        id=zone.id,
        name=zone.name,
        type=zone.zone_type,  # type: ignore[arg-type]
        comment=zone.comment,
        record_count=record_count,
        vpc_region=zone.vpc_region,
        vpc_id=zone.vpc_id,
        name_servers=name_servers,
        created_at=zone.created_at,
        updated_at=zone.updated_at,
    )


def list_zones(
    db: Session, search: str | None, zone_type: str | None, page: int, page_size: int
) -> tuple[list[HostedZoneOut], int, int]:
    counts = _record_count_subquery()
    stmt = select(HostedZone, func.coalesce(counts.c.cnt, 0)).outerjoin(
        counts, counts.c.hosted_zone_id == HostedZone.id
    )
    if search:
        like = like_pattern(search)
        stmt = stmt.where(
            or_(
                HostedZone.name.ilike(like, escape="\\"),
                HostedZone.id.ilike(like, escape="\\"),
                HostedZone.comment.ilike(like, escape="\\"),
            )
        )
    if zone_type in ("public", "private"):
        stmt = stmt.where(HostedZone.zone_type == zone_type)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    total_pages = max(1, math.ceil(total / page_size))
    rows = db.execute(
        stmt.order_by(HostedZone.name, HostedZone.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    # Two queries per page (zones with counts, then all their name servers), not one per zone.
    name_servers = _apex_ns(db, [zone for zone, _ in rows])
    items = [to_out(db, zone, cnt, name_servers.get(zone.id, [])) for zone, cnt in rows]
    return items, total, total_pages


def get_zone(db: Session, zone_id: str) -> HostedZone:
    zone = db.get(HostedZone, zone_id)
    if zone is None:
        raise not_found("NoSuchHostedZone", f"No hosted zone found with ID: {zone_id}")
    return zone


def _private_zone_conflict(db: Session, data: HostedZoneCreate) -> AppError | None:
    """The error for a private zone whose VPC already has a private zone of the same name."""
    if data.type != "private":
        return None
    existing = db.scalar(
        select(HostedZone).where(
            HostedZone.name == data.name,
            HostedZone.zone_type == "private",
            HostedZone.vpc_id == data.vpc_id,
            HostedZone.vpc_region == data.vpc_region,
        )
    )
    if existing is None:
        return None
    return conflict(
        "ConflictingDomainExists",
        f"VPC {data.vpc_id} ({data.vpc_region}) is already associated with private hosted zone "
        f"{data.name} ({existing.id}). Choose a different VPC or domain name.",
    )


def create_zone(db: Session, data: HostedZoneCreate) -> HostedZone:
    # Route 53 allows several hosted zones with the same name; each gets its own ID and
    # name servers. The exception: one VPC can't be associated with two private zones
    # that have the same name. Checked first for a clear message; the database's partial
    # unique index (uq_hosted_zones_private_name_vpc) decides if two requests race.
    if error := _private_zone_conflict(db, data):
        raise error

    zone = HostedZone(
        name=data.name,
        zone_type=data.type,
        comment=data.comment.strip(),
        vpc_region=data.vpc_region,
        vpc_id=data.vpc_id,
        caller_reference=str(uuid.uuid4()),
    )
    db.add(zone)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        if error := _private_zone_conflict(db, data):  # another request created it first
            raise error from exc
        raise

    # Route 53 automatically creates the apex NS and SOA records for every new zone.
    ns = _default_name_servers()
    db.add(ResourceRecordSet(hosted_zone_id=zone.id, name=zone.name, record_type="NS", ttl=172800, values=ns))
    db.add(
        ResourceRecordSet(
            hosted_zone_id=zone.id,
            name=zone.name,
            record_type="SOA",
            ttl=900,
            values=[f"{ns[0]}. awsdns-hostmaster.amazon.com. 1 7200 900 1209600 86400"],
        )
    )
    db.commit()
    db.refresh(zone)
    return zone


def update_zone(db: Session, zone_id: str, data: HostedZoneUpdate) -> HostedZone:
    zone = get_zone(db, zone_id)
    zone.comment = data.comment.strip()
    db.commit()
    db.refresh(zone)
    return zone


def delete_zone(db: Session, zone_id: str) -> None:
    zone = get_zone(db, zone_id)
    non_default = db.scalar(
        select(func.count()).where(
            ResourceRecordSet.hosted_zone_id == zone.id,
            ~(
                (ResourceRecordSet.name == zone.name)
                & ResourceRecordSet.record_type.in_(["SOA", "NS"])
            ),
        )
    ) or 0
    if non_default:
        raise AppError(
            400,
            "HostedZoneNotEmpty",
            f"The hosted zone {zone.name} contains {non_default} record(s) other than the default "
            "NS and SOA records. Delete those records before deleting the hosted zone.",
        )
    db.delete(zone)  # remaining SOA/NS rows go via ON DELETE CASCADE
    db.commit()
