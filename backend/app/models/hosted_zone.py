from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.utils import generate_id, utcnow


class HostedZone(Base):
    __tablename__ = "hosted_zones"

    # Route 53 style public identifier, e.g. "Z04123452ABCDEFGHIJKL"
    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: generate_id("Z", 20)
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    # "public" | "private"
    zone_type: Mapped[str] = mapped_column(String(16), nullable=False, default="public")
    comment: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Only set for private hosted zones
    vpc_region: Mapped[str | None] = mapped_column(String(32), nullable=True)
    vpc_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    caller_reference: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    records: Mapped[list["ResourceRecordSet"]] = relationship(  # noqa: F821
        back_populates="hosted_zone",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
