from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.utils import generate_id, utcnow


class Change(Base):
    """One submitted change batch (Route 53 ChangeInfo), written with the data change itself.

    Status is not stored: a change is PENDING until settings.propagation_seconds have
    passed since submitted_at, then INSYNC, mimicking propagation to Route 53's servers.
    """

    __tablename__ = "changes"
    __table_args__ = (Index("ix_changes_zone_submitted", "hosted_zone_id", "submitted_at"),)

    # Route 53 style identifier, e.g. "C2682N5HXP0BZ4EXAMPLE"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: generate_id("C", 20))
    hosted_zone_id: Mapped[str] = mapped_column(
        ForeignKey("hosted_zones.id", ondelete="CASCADE"), nullable=False
    )
    # CREATE | UPSERT | DELETE | IMPORT
    action: Mapped[str] = mapped_column(String(8), nullable=False)
    # What changed, e.g. "www.example.com A" or "3 records"
    target: Mapped[str] = mapped_column(String(512), nullable=False)
    record_type: Mapped[str | None] = mapped_column(String(8), nullable=True)
    submitted_by: Mapped[str] = mapped_column(String(64), nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
