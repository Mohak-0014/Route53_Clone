"""Mocked authentication: one demo IAM user, opaque bearer-token sessions in SQLite."""
import hashlib
import hmac
import secrets
from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.errors import AppError
from app.models import AuthSession, User
from app.utils import utcnow

_ITERATIONS = 200_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _algo, iterations, salt, expected = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iterations))
    return hmac.compare_digest(digest.hex(), expected)


def _invalid_credentials() -> AppError:
    # Deliberately vague, like the AWS sign-in page.
    return AppError(401, "InvalidCredentials", "Your authentication information is incorrect. Please try again.")


def login(db: Session, account_id: str, username: str, password: str) -> AuthSession:
    user = db.scalar(select(User).where(User.username == username.strip()))
    if (
        user is None
        or user.account_id != account_id.strip().replace("-", "")
        or not verify_password(password, user.password_hash)
    ):
        raise _invalid_credentials()

    now = utcnow()
    # Opportunistically clean up expired sessions.
    db.execute(delete(AuthSession).where(AuthSession.expires_at < now))
    session = AuthSession(
        token=secrets.token_urlsafe(32),
        user_id=user.id,
        created_at=now,
        expires_at=now + timedelta(hours=settings.session_ttl_hours),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_session(db: Session, token: str) -> AuthSession | None:
    session = db.scalar(select(AuthSession).where(AuthSession.token == token))
    if session is None or session.expires_at < utcnow():
        return None
    return session


def logout(db: Session, token: str) -> None:
    db.execute(delete(AuthSession).where(AuthSession.token == token))
    db.commit()
