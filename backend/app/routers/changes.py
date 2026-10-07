from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.routers.deps import get_current_session
from app.schemas.change import ChangeOut
from app.schemas.common import Page
from app.services import change_service

router = APIRouter(prefix="/api", tags=["changes"], dependencies=[Depends(get_current_session)])


@router.get("/changes/{change_id}", response_model=ChangeOut)
def get_change(change_id: str, db: Session = Depends(get_db)):
    """Route 53 GetChange: the status of a submitted change (PENDING → INSYNC)."""
    return change_service.to_out(change_service.get_change(db, change_id))


@router.get("/hosted-zones/{zone_id}/changes", response_model=Page[ChangeOut])
def list_zone_changes(
    zone_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """The hosted zone's change history, newest first."""
    items, total, total_pages = change_service.list_changes(db, zone_id, page, page_size)
    return Page(items=items, total=total, page=page, page_size=page_size, total_pages=total_pages)
