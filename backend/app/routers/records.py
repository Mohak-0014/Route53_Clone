from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AuthSession
from app.routers.deps import get_current_session
from app.schemas.change import ChangeResponse
from app.schemas.common import Page
from app.schemas.record import (
    BatchCreateRequest,
    BatchCreateResult,
    BulkDeleteRequest,
    BulkDeleteResult,
    ImportRequest,
    ImportResult,
    RecordChangeOut,
    RecordCreate,
    RecordOut,
    RecordUpdate,
)
from app.services import record_service, zonefile_service

router = APIRouter(
    prefix="/api/hosted-zones/{zone_id}/records",
    tags=["records"],
    dependencies=[Depends(get_current_session)],
)


@router.get("", response_model=Page[RecordOut])
def list_records(
    zone_id: str,
    search: str | None = Query(None, max_length=255),
    type: str | None = Query(None, max_length=64, description="Comma-separated record types"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
):
    _zone, items, total, total_pages = record_service.list_records(
        db, zone_id, search, type, page, page_size
    )
    return Page(items=items, total=total, page=page, page_size=page_size, total_pages=total_pages)


@router.post("", response_model=RecordChangeOut, status_code=status.HTTP_201_CREATED)
def create_record(
    zone_id: str,
    body: RecordCreate,
    db: Session = Depends(get_db),
    session: AuthSession = Depends(get_current_session),
):
    record, change = record_service.create_record(db, zone_id, body, actor=session.user.username)
    return RecordChangeOut(**record.model_dump(), change=change)


# Declared before /{record_id} so "batch"/"bulk-delete"/"import" are not treated as IDs.
@router.post("/batch", response_model=BatchCreateResult, status_code=status.HTTP_201_CREATED)
def create_records_batch(
    zone_id: str,
    body: BatchCreateRequest,
    db: Session = Depends(get_db),
    session: AuthSession = Depends(get_current_session),
):
    """Create several records in one atomic change (the console's "Add another record")."""
    records, change = record_service.create_records(db, zone_id, body.records, actor=session.user.username)
    return BatchCreateResult(records=records, change=change)


@router.post("/bulk-delete", response_model=BulkDeleteResult)
def bulk_delete_records(
    zone_id: str,
    body: BulkDeleteRequest,
    db: Session = Depends(get_db),
    session: AuthSession = Depends(get_current_session),
):
    deleted, skipped, change = record_service.bulk_delete(
        db, zone_id, body.record_ids, actor=session.user.username
    )
    return BulkDeleteResult(deleted=deleted, skipped=skipped, change=change)


@router.post("/import", response_model=ImportResult)
def import_zone_file(
    zone_id: str,
    body: ImportRequest,
    db: Session = Depends(get_db),
    session: AuthSession = Depends(get_current_session),
):
    created, skipped, errors, change = zonefile_service.import_bind(
        db, zone_id, body.zone_file, actor=session.user.username
    )
    return ImportResult(created=created, skipped=skipped, errors=errors, change=change)


@router.get("/{record_id}", response_model=RecordOut)
def get_record(zone_id: str, record_id: str, db: Session = Depends(get_db)):
    zone, rec = record_service.get_record(db, zone_id, record_id)
    return record_service.to_out(zone, rec)


@router.put("/{record_id}", response_model=RecordChangeOut)
def update_record(
    zone_id: str,
    record_id: str,
    body: RecordUpdate,
    db: Session = Depends(get_db),
    session: AuthSession = Depends(get_current_session),
):
    record, change = record_service.update_record(db, zone_id, record_id, body, actor=session.user.username)
    return RecordChangeOut(**record.model_dump(), change=change)


@router.delete("/{record_id}", response_model=ChangeResponse)
def delete_record(
    zone_id: str,
    record_id: str,
    db: Session = Depends(get_db),
    session: AuthSession = Depends(get_current_session),
):
    change = record_service.delete_record(db, zone_id, record_id, actor=session.user.username)
    return ChangeResponse(change=change)
