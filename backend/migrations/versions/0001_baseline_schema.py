"""Baseline: the schema as it was before Alembic (create_all + the old startup migration).

Every table and index is created with IF NOT EXISTS so this revision can also be applied to
database files from before Alembic: it fills in what they lack (the oldest files have no
`changes` table) and leaves existing tables and their rows untouched.

Revision ID: 0001
Revises:
Create Date: 2026-10-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.String(length=12), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("password_hash", sa.String(length=256), nullable=False),
        sa.Column("role", sa.String(length=16), server_default="admin", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("username"),
        if_not_exists=True,
    )
    op.create_table(
        "sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(length=128), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        if_not_exists=True,
    )
    op.create_index("ix_sessions_token", "sessions", ["token"], unique=True, if_not_exists=True)
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"], unique=False, if_not_exists=True)

    op.create_table(
        "hosted_zones",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("zone_type", sa.String(length=16), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("vpc_region", sa.String(length=32), nullable=True),
        sa.Column("vpc_id", sa.String(length=32), nullable=True),
        sa.Column("caller_reference", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        if_not_exists=True,
    )
    op.create_index("ix_hosted_zones_name", "hosted_zones", ["name"], unique=False, if_not_exists=True)

    op.create_table(
        "resource_record_sets",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("hosted_zone_id", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("record_type", sa.String(length=8), nullable=False),
        sa.Column("ttl", sa.Integer(), nullable=False),
        sa.Column("values_json", sa.Text(), nullable=False),
        sa.Column("routing_policy", sa.String(length=16), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["hosted_zone_id"], ["hosted_zones.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hosted_zone_id", "name", "record_type", name="uq_record_name_type"),
        if_not_exists=True,
    )
    op.create_index(
        "ix_resource_record_sets_hosted_zone_id", "resource_record_sets", ["hosted_zone_id"], unique=False,
        if_not_exists=True,
    )
    op.create_index("ix_resource_record_sets_name", "resource_record_sets", ["name"], unique=False, if_not_exists=True)
    op.create_index(
        "ix_resource_record_sets_record_type", "resource_record_sets", ["record_type"], unique=False,
        if_not_exists=True,
    )

    op.create_table(
        "changes",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("hosted_zone_id", sa.String(length=32), nullable=False),
        sa.Column("action", sa.String(length=8), nullable=False),
        sa.Column("target", sa.String(length=512), nullable=False),
        sa.Column("record_type", sa.String(length=8), nullable=True),
        sa.Column("submitted_by", sa.String(length=64), nullable=False),
        sa.Column("submitted_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["hosted_zone_id"], ["hosted_zones.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        if_not_exists=True,
    )
    op.create_index(
        "ix_changes_zone_submitted", "changes", ["hosted_zone_id", "submitted_at"], unique=False, if_not_exists=True
    )


def downgrade() -> None:
    op.drop_table("changes")
    op.drop_table("resource_record_sets")
    op.drop_table("hosted_zones")
    op.drop_table("sessions")
    op.drop_table("users")
