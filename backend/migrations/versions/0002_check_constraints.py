"""CHECK constraints for values the API already validates.

The allowed values are written out here rather than imported from the app: a revision is a
snapshot of the schema at one point in time. The models build the same constraints from the
app's constants, and tests/test_migrations.py fails if the two ever disagree.

SQLite can't add a constraint with ALTER TABLE, so each table is rebuilt in batch mode
(create a copy with the constraints, copy the rows, drop the original, rename).

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-07
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RECORD_TYPES = ("A", "AAAA", "CAA", "CNAME", "MX", "NS", "PTR", "SRV", "TXT", "SOA")


def _in(column: str, values: Sequence[str]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.create_check_constraint("ck_users_role", _in("role", ("admin", "read_only")))

    with op.batch_alter_table("hosted_zones") as batch:
        batch.create_check_constraint("ck_hosted_zones_zone_type", _in("zone_type", ("public", "private")))
        batch.create_check_constraint(
            "ck_hosted_zones_vpc",
            "(zone_type = 'private' AND vpc_id IS NOT NULL AND vpc_region IS NOT NULL)"
            " OR (zone_type = 'public' AND vpc_id IS NULL AND vpc_region IS NULL)",
        )

    with op.batch_alter_table("resource_record_sets") as batch:
        batch.create_check_constraint("ck_resource_record_sets_record_type", _in("record_type", RECORD_TYPES))
        batch.create_check_constraint("ck_resource_record_sets_ttl", "ttl BETWEEN 0 AND 2147483647")
        batch.create_check_constraint("ck_resource_record_sets_version", "version >= 1")

    with op.batch_alter_table("changes") as batch:
        batch.create_check_constraint("ck_changes_action", _in("action", ("CREATE", "UPSERT", "DELETE", "IMPORT")))


def downgrade() -> None:
    with op.batch_alter_table("changes") as batch:
        batch.drop_constraint("ck_changes_action", type_="check")
    with op.batch_alter_table("resource_record_sets") as batch:
        batch.drop_constraint("ck_resource_record_sets_version", type_="check")
        batch.drop_constraint("ck_resource_record_sets_ttl", type_="check")
        batch.drop_constraint("ck_resource_record_sets_record_type", type_="check")
    with op.batch_alter_table("hosted_zones") as batch:
        batch.drop_constraint("ck_hosted_zones_vpc", type_="check")
        batch.drop_constraint("ck_hosted_zones_zone_type", type_="check")
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("ck_users_role", type_="check")
