from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.database import get_db
from app.errors import AppError
from app.models import AuthSession
from app.services import auth_service


def _token_from_header(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


def get_current_session(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AuthSession:
    token = _token_from_header(authorization)
    session = auth_service.get_session(db, token) if token else None
    if session is None:
        raise AppError(401, "Unauthenticated", "Your session has expired. Please sign in again.")
    return session
