from pydantic import BaseModel, Field, field_validator

from app.schemas.change import ChangeInfo
from app.schemas.common import UTCDateTime
from app.services.validators import MAX_TTL, SUPPORTED_RECORD_TYPES


class RecordBase(BaseModel):
    ttl: int = Field(300, ge=0, le=MAX_TTL)
    values: list[str] = Field(..., min_length=1, max_length=100)
    comment: str = Field("", max_length=256)

    @field_validator("values")
    @classmethod
    def _strip_blank(cls, v: list[str]) -> list[str]:
        cleaned = [x.strip() for x in v if x.strip()]
        if not cleaned:
            raise ValueError("Enter at least one value.")
        return cleaned


class RecordCreate(RecordBase):
    # Subdomain prefix ("www"), "" / "@" for the zone apex, or a full name in the zone.
    name: str = Field("", max_length=253)
    type: str

    @field_validator("type")
    @classmethod
    def _type(cls, v: str) -> str:
        v = v.upper().strip()
        if v not in SUPPORTED_RECORD_TYPES:
            raise ValueError(f"Record type must be one of {', '.join(SUPPORTED_RECORD_TYPES)}.")
        return v


class RecordUpdate(RecordCreate):
    # Optimistic locking: the version the client loaded. Omit to overwrite unconditionally.
    expected_version: int | None = Field(None, ge=1)


class RecordOut(BaseModel):
    id: str
    hosted_zone_id: str
    name: str
    type: str
    ttl: int
    values: list[str]
    routing_policy: str
    alias: bool = False
    comment: str
    is_default: bool  # zone-apex SOA/NS records that Route 53 creates automatically
    version: int
    created_at: UTCDateTime
    updated_at: UTCDateTime


class RecordChangeOut(RecordOut):
    """A created or updated record plus the change that applied it."""

    change: ChangeInfo


class BatchCreateResult(BaseModel):
    records: list[RecordOut]
    change: ChangeInfo


class BulkDeleteResult(BaseModel):
    deleted: int
    skipped: int
    change: ChangeInfo | None  # None when nothing was deleted


class BatchCreateRequest(BaseModel):
    records: list[RecordCreate] = Field(..., min_length=1, max_length=50)


class BulkDeleteRequest(BaseModel):
    record_ids: list[str] = Field(..., min_length=1, max_length=500)


class ImportRequest(BaseModel):
    zone_file: str = Field(..., min_length=1, max_length=1_000_000)


class ImportResult(BaseModel):
    created: int
    skipped: int
    errors: list[str]
    change: ChangeInfo | None = None  # None when nothing was imported
