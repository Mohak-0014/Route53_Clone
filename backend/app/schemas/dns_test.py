from typing import Literal

from pydantic import BaseModel, Field

QueryType = Literal["A", "AAAA", "CAA", "CNAME", "MX", "NS", "PTR", "SOA", "SRV", "TXT"]


class TestRecordRequest(BaseModel):
    # "" or "@" for the zone apex; a subdomain prefix or a name in the zone, like the record form.
    record_name: str = Field("", max_length=254)
    type: QueryType


class ResourceRecordOut(BaseModel):
    name: str
    type: str
    ttl: int
    value: str


class TestRecordResult(BaseModel):
    query_name: str
    query_type: QueryType
    response_code: Literal["NOERROR", "NXDOMAIN"]
    protocol: Literal["UDP"]
    answers: list[ResourceRecordOut]
    authority: list[ResourceRecordOut]
    notes: list[str]
