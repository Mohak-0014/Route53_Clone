"""Database-level rules: CHECK constraints reject bad rows even when the API is bypassed."""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.database import engine

NOW = "'2026-01-01'"
ZONE = "INSERT INTO hosted_zones VALUES ('{id}', 'example.com', {type}, '', {region}, {vpc}, 'ref', " + NOW + ", " + NOW + ")"
RECORD = (
    "INSERT INTO resource_record_sets VALUES ('{id}', 'ZOK', 'www.example.com', {type}, {ttl}, '[]', 'simple', '', "
    "{version}, " + NOW + ", " + NOW + ")"
)
USER = "INSERT INTO users VALUES ({id}, '123456789012', 'u{id}', 'x', {role}, " + NOW + ")"
CHANGE = "INSERT INTO changes VALUES ('{id}', 'ZOK', {action}, 'www.example.com A', 'A', 'demo', " + NOW + ")"


def _zone(id="Z1", type="'public'", region="NULL", vpc="NULL"):
    return ZONE.format(id=id, type=type, region=region, vpc=vpc)


def _record(id="R1", type="'A'", ttl="300", version="1"):
    return RECORD.format(id=id, type=type, ttl=ttl, version=version)


VALID = [
    _zone("ZOK"),
    _zone("ZPRIV", "'private'", "'us-east-1'", "'vpc-0abc1234'"),
    _record("ROK"),
    _record("RSOA", "'SOA'", "0", "7"),
    _record("RMAX", "'TXT'", "2147483647"),
    USER.format(id=10, role="'read_only'"),
    CHANGE.format(id="COK", action="'IMPORT'"),
]

INVALID = {
    "ck_hosted_zones_zone_type": _zone(type="'shared'"),
    "ck_hosted_zones_vpc: private without VPC": _zone(type="'private'"),
    "ck_hosted_zones_vpc: private without region": _zone(type="'private'", vpc="'vpc-0abc1234'"),
    "ck_hosted_zones_vpc: public with VPC": _zone(region="'us-east-1'", vpc="'vpc-0abc1234'"),
    "ck_resource_record_sets_record_type": _record(type="'ALIAS'"),
    "ck_resource_record_sets_record_type: lowercase": _record(type="'a'"),
    "ck_resource_record_sets_ttl: negative": _record(ttl="-1"),
    "ck_resource_record_sets_ttl: too large": _record(ttl="2147483648"),
    "ck_resource_record_sets_version": _record(version="0"),
    "ck_users_role": USER.format(id=20, role="'superuser'"),
    "ck_changes_action": CHANGE.format(id="CBAD", action="'UPDATE'"),
}


@pytest.fixture()
def raw(client):
    """A connection on a freshly migrated database, with a valid zone ZOK to attach rows to."""
    with engine.connect() as conn:
        conn.execute(text(_zone("ZOK")))
        conn.commit()
        yield conn
        conn.rollback()


def test_valid_rows_are_accepted(raw):
    for sql in VALID[1:]:
        raw.execute(text(sql))


@pytest.mark.parametrize("sql", INVALID.values(), ids=INVALID.keys())
def test_check_constraint_rejects_bad_row(raw, sql):
    with pytest.raises(IntegrityError, match="CHECK constraint failed"):
        raw.execute(text(sql))


def _private(id, name="corp.example", vpc="'vpc-0abc1234'", region="'us-east-1'"):
    return ZONE.replace("'example.com'", f"'{name}'").format(id=id, type="'private'", region=region, vpc=vpc)


def test_partial_unique_index_rejects_a_second_private_zone_in_the_same_vpc(raw):
    raw.execute(text(_private("ZP1")))
    with pytest.raises(IntegrityError, match="UNIQUE constraint failed"):
        raw.execute(text(_private("ZP2")))


def test_partial_unique_index_allows_what_route_53_allows(raw):
    raw.execute(text(_private("ZP1")))
    raw.execute(text(_private("ZP2", vpc="'vpc-0def5678'")))  # same name, another VPC
    raw.execute(text(_private("ZP3", region="'eu-west-1'")))  # same VPC ID, another region
    raw.execute(text(_private("ZP4", name="other.example")))  # same VPC, another name
    raw.execute(text(_zone("ZPUB2").replace("'example.com'", "'corp.example'")))  # public zone, same name
    raw.execute(text(_zone("ZPUB3")))  # a second public example.com (ZOK is the first)
    names = raw.execute(text("SELECT name FROM hosted_zones WHERE zone_type = 'public' AND name = 'example.com'")).all()
    assert len(names) == 2
