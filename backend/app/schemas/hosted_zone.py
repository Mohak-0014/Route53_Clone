import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.common import UTCDateTime
from app.services.validators import validate_zone_name

ZoneType = Literal["public", "private"]

AWS_REGIONS = [
    "us-east-1", "us-east-2", "us-west-1", "us-west-2", "ap-south-1", "ap-southeast-1",
    "ap-southeast-2", "ap-northeast-1", "eu-west-1", "eu-west-2", "eu-central-1", "sa-east-1",
]


class HostedZoneCreate(BaseModel):
    name: str = Field(..., max_length=255)
    comment: str = Field("", max_length=256)
    type: ZoneType = "public"
    vpc_region: str | None = None
    vpc_id: str | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return validate_zone_name(v)

    @model_validator(mode="after")
    def _vpc(self):
        if self.type == "private":
            if not self.vpc_region or self.vpc_region not in AWS_REGIONS:
                raise ValueError("Private hosted zones require a valid VPC region.")
            if not self.vpc_id or not re.fullmatch(r"vpc-[0-9a-f]{8,17}", self.vpc_id):
                raise ValueError("Private hosted zones require a VPC ID such as vpc-0a1b2c3d.")
        else:
            self.vpc_region = None
            self.vpc_id = None
        return self


class HostedZoneUpdate(BaseModel):
    """Route 53 only allows changing a hosted zone's description (comment).

    Any other field (name, type, VPC settings) is rejected rather than silently ignored.
    """

    model_config = ConfigDict(extra="forbid")

    comment: str = Field(..., max_length=256)

    @model_validator(mode="before")
    @classmethod
    def _only_comment(cls, data):
        if isinstance(data, dict):
            immutable = sorted(k for k in data if k != "comment")
            if immutable:
                raise ValueError(
                    "Only the description of a hosted zone can be changed. "
                    f"These fields can't be updated: {', '.join(immutable)}."
                )
        return data


class HostedZoneOut(BaseModel):
    id: str
    name: str
    type: ZoneType
    comment: str
    record_count: int
    vpc_region: str | None
    vpc_id: str | None
    name_servers: list[str]
    created_by: str = "Route 53"
    created_at: UTCDateTime
    updated_at: UTCDateTime
