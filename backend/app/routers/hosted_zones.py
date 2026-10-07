from typing import Literal

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.routers.deps import get_current_session, require_write
from app.schemas.common import Page
from app.schemas.dns_test import TestRecordRequest, TestRecordResult
from app.schemas.hosted_zone import HostedZoneCreate, HostedZoneOut, HostedZoneUpdate
from app.services import dns_test_service, zone_service, zonefile_service

router = APIRouter(
    prefix="/api/hosted-zones",
    tags=["hosted-zones"],
    dependencies=[Depends(get_current_session)],
)


@router.get("", response_model=Page[HostedZoneOut])
def list_hosted_zones(
    search: str | None = Query(None, max_length=255),
    type: Literal["public", "private"] | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
):
    items, total, total_pages = zone_service.list_zones(db, search, type, page, page_size)
    return Page(items=items, total=total, page=page, page_size=page_size, total_pages=total_pages)


@router.post(
    "",
    response_model=HostedZoneOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_write("CreateHostedZone"))],
)
def create_hosted_zone(body: HostedZoneCreate, db: Session = Depends(get_db)):
    zone = zone_service.create_zone(db, body)
    return zone_service.to_out(db, zone)


@router.get("/{zone_id}", response_model=HostedZoneOut)
def get_hosted_zone(zone_id: str, db: Session = Depends(get_db)):
    return zone_service.to_out(db, zone_service.get_zone(db, zone_id))


@router.put(
    "/{zone_id}",
    response_model=HostedZoneOut,
    dependencies=[Depends(require_write("UpdateHostedZoneComment"))],
)
def update_hosted_zone(zone_id: str, body: HostedZoneUpdate, db: Session = Depends(get_db)):
    return zone_service.to_out(db, zone_service.update_zone(db, zone_id, body))


@router.delete(
    "/{zone_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_write("DeleteHostedZone"))],
)
def delete_hosted_zone(zone_id: str, db: Session = Depends(get_db)):
    zone_service.delete_zone(db, zone_id)


@router.get("/{zone_id}/export")
def export_hosted_zone(
    zone_id: str,
    format: Literal["bind", "json"] = "bind",
    db: Session = Depends(get_db),
):
    if format == "json":
        return zonefile_service.export_json(db, zone_id)
    zone, text = zonefile_service.export_bind(db, zone_id)
    return PlainTextResponse(
        text, headers={"Content-Disposition": f'attachment; filename="{zone.name}.zone"'}
    )


@router.post("/{zone_id}/test-record", response_model=TestRecordResult)
def test_record(zone_id: str, body: TestRecordRequest, db: Session = Depends(get_db)):
    """Simulate the DNS response Route 53 would return (the console's "Test record")."""
    return dns_test_service.answer_query(db, zone_id, body.record_name, body.type)
