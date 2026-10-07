"""Partial unique index: one VPC can't have two private hosted zones with the same name.

Public zones with the same name stay allowed, as in Route 53. Before this index the rule was
only a check-then-insert in zone_service.create_zone, which two concurrent requests could race.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "uq_hosted_zones_private_name_vpc",
        "hosted_zones",
        ["name", "vpc_id", "vpc_region"],
        unique=True,
        sqlite_where=sa.text("zone_type = 'private'"),
    )


def downgrade() -> None:
    op.drop_index("uq_hosted_zones_private_name_vpc", table_name="hosted_zones")
