from typing import Literal

from pydantic import BaseModel

from app.schemas.common import UTCDateTime

ChangeStatus = Literal["PENDING", "INSYNC"]
ChangeAction = Literal["CREATE", "UPSERT", "DELETE", "IMPORT"]


class ChangeInfo(BaseModel):
    """The ChangeInfo returned with every record change, as in Route 53."""

    id: str
    status: ChangeStatus
    submitted_at: UTCDateTime


class ChangeOut(ChangeInfo):
    """A change in the hosted zone's change history (GET /changes/{id}, zone history)."""

    hosted_zone_id: str
    action: ChangeAction
    target: str
    record_type: str | None
    submitted_by: str


class ChangeResponse(BaseModel):
    change: ChangeInfo
