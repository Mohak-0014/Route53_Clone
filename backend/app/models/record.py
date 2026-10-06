import json
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.utils import generate_id, utcnow


class ResourceRecordSet(Base):
    """A DNS record set: one (name, type) pair holding one or more values.

    Mirrors Route 53's data model, where e.g. an A record set for www.example.com
    can contain several IP addresses.
    """

    __tablename__ = "resource_record_sets"
    __table_args__ = (
        UniqueConstraint("hosted_zone_id", "name", "record_type", name="uq_record_name_type"),
    )

    id: Mapped[str] = mapped_column(
        String(32), primary_key=True, default=lambda: generate_id("R", 16)
    )
    hosted_zone_id: Mapped[str] = mapped_column(
        ForeignKey("hosted_zones.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Fully-qualified name without trailing dot, e.g. "www.example.com"
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    record_type: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    ttl: Mapped[int] = mapped_column(Integer, nullable=False, default=300)
    # JSON-encoded list[str]; one entry per value line in the console
    values_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    routing_policy: Mapped[str] = mapped_column(String(16), nullable=False, default="simple")
    comment: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Optimistic-locking counter: SQLAlchemy bumps it on every UPDATE and adds
    # "WHERE version = <loaded>" so a concurrent write fails instead of being lost.
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    hosted_zone: Mapped["HostedZone"] = relationship(back_populates="records")  # noqa: F821

    __mapper_args__ = {"version_id_col": version}

    @property
    def values(self) -> list[str]:
        return json.loads(self.values_json)

    @values.setter
    def values(self, new_values: list[str]) -> None:
        self.values_json = json.dumps(new_values)
