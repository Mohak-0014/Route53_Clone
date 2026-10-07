from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AuthSession
from app.routers.deps import get_current_session
from app.schemas.auth import LoginRequest, SessionOut, UserOut
from app.services import auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _session_out(s: AuthSession) -> SessionOut:
    return SessionOut(
        token=s.token,
        expires_at=s.expires_at,
        user=UserOut(username=s.user.username, account_id=s.user.account_id, role=s.user.role),
    )


@router.post("/login", response_model=SessionOut)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    return _session_out(auth_service.login(db, body.account_id, body.username, body.password))


@router.get("/session", response_model=SessionOut)
def current_session(session: AuthSession = Depends(get_current_session)):
    return _session_out(session)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(session: AuthSession = Depends(get_current_session), db: Session = Depends(get_db)):
    auth_service.logout(db, session.token)
