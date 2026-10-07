from collections.abc import Callable

from fastapi import Depends, Header, Request
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


def require_write(action: str) -> Callable[..., AuthSession]:
    """Dependency for write endpoints: read-only IAM users get 403 AccessDenied, as in AWS.

    `action` is the Route 53 API action, e.g. "ChangeResourceRecordSets".
    """

    def dependency(request: Request, session: AuthSession = Depends(get_current_session)) -> AuthSession:
        if session.user.role != "admin":
            zone_id = request.path_params.get("zone_id", "*")
            user = session.user
            raise AppError(
                403,
                "AccessDenied",
                f"User: arn:aws:iam::{user.account_id}:user/{user.username} is not authorized to perform: "
                f"route53:{action} on resource: arn:aws:route53:::hostedzone/{zone_id}",
            )
        return session

    return dependency
