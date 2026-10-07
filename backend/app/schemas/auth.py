from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import UTCDateTime

Role = Literal["admin", "read_only"]

class LoginRequest(BaseModel):
    account_id: str = Field(..., min_length=1, max_length=64, description="12-digit account ID or alias")
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class UserOut(BaseModel):
    username: str
    account_id: str
    role: Role


class SessionOut(BaseModel):
    token: str
    expires_at: UTCDateTime
    user: UserOut
