import os
import tempfile

import pytest

# Point the app at a throwaway database before any app module is imported.
_tmpdir = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmpdir}/test.db"
os.environ["SEED_DEMO_DATA"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from app.db_migrations import reset_database  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import init_db  # noqa: E402


@pytest.fixture()
def client():
    reset_database()
    init_db()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def auth(client):
    r = client.post(
        "/api/auth/login",
        json={"account_id": "123456789012", "username": "demo", "password": "demo1234"},
    )
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def zone(client, auth):
    r = client.post("/api/hosted-zones", json={"name": "Test.Example.", "comment": "t"}, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()


# --- Database files from before Alembic, for migration tests ------------------------------

# The first release's schema (create_all), before records were versioned, users had roles
# and changes were recorded.
FIRST_RELEASE_DDL = [
    "CREATE TABLE users (id INTEGER NOT NULL, account_id VARCHAR(12) NOT NULL, username VARCHAR(64) NOT NULL, "
    "password_hash VARCHAR(256) NOT NULL, created_at DATETIME NOT NULL, PRIMARY KEY (id), UNIQUE (username))",
    "CREATE TABLE sessions (id INTEGER NOT NULL, token VARCHAR(128) NOT NULL, user_id INTEGER NOT NULL, "
    "created_at DATETIME NOT NULL, expires_at DATETIME NOT NULL, PRIMARY KEY (id), "
    "FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE)",
    "CREATE UNIQUE INDEX ix_sessions_token ON sessions (token)",
    "CREATE INDEX ix_sessions_user_id ON sessions (user_id)",
    "CREATE TABLE hosted_zones (id VARCHAR(32) NOT NULL, name VARCHAR(255) NOT NULL, zone_type VARCHAR(16) NOT NULL, "
    "comment TEXT NOT NULL, vpc_region VARCHAR(32), vpc_id VARCHAR(32), caller_reference VARCHAR(128) NOT NULL, "
    "created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, PRIMARY KEY (id))",
    "CREATE INDEX ix_hosted_zones_name ON hosted_zones (name)",
    "CREATE TABLE resource_record_sets (id VARCHAR(32) NOT NULL, hosted_zone_id VARCHAR(32) NOT NULL, "
    "name VARCHAR(255) NOT NULL, record_type VARCHAR(8) NOT NULL, ttl INTEGER NOT NULL, values_json TEXT NOT NULL, "
    "routing_policy VARCHAR(16) NOT NULL, comment TEXT NOT NULL, created_at DATETIME NOT NULL, "
    "updated_at DATETIME NOT NULL, PRIMARY KEY (id), "
    "CONSTRAINT uq_record_name_type UNIQUE (hosted_zone_id, name, record_type), "
    "FOREIGN KEY(hosted_zone_id) REFERENCES hosted_zones (id) ON DELETE CASCADE)",
    "CREATE INDEX ix_resource_record_sets_hosted_zone_id ON resource_record_sets (hosted_zone_id)",
    "CREATE INDEX ix_resource_record_sets_name ON resource_record_sets (name)",
    "CREATE INDEX ix_resource_record_sets_record_type ON resource_record_sets (record_type)",
]
FIRST_RELEASE_ROWS = [
    "INSERT INTO users VALUES (1, '123456789012', 'demo', 'x', '2026-01-01')",
    "INSERT INTO sessions VALUES (1, 'tok-1', 1, '2026-01-01', '2099-01-01')",
    "INSERT INTO hosted_zones VALUES ('ZPUB1', 'example.com', 'public', 'web', NULL, NULL, 'ref-1', "
    "'2026-01-01', '2026-01-01')",
    "INSERT INTO hosted_zones VALUES ('ZPRIV1', 'corp.example', 'private', '', 'ap-south-1', 'vpc-0a1b2c3d', "
    "'ref-2', '2026-01-01', '2026-01-01')",
    "INSERT INTO resource_record_sets VALUES ('R1', 'ZPUB1', 'example.com', 'A', 300, '[\"192.0.2.1\"]', "
    "'simple', '', '2026-01-01', '2026-01-01')",
    "INSERT INTO resource_record_sets VALUES ('R2', 'ZPUB1', 'www.example.com', 'CNAME', 60, '[\"example.com\"]', "
    "'simple', '', '2026-01-01', '2026-01-01')",
    "INSERT INTO resource_record_sets VALUES ('R3', 'ZPRIV1', 'db.corp.example', 'A', 60, '[\"10.0.0.5\"]', "
    "'simple', '', '2026-01-01', '2026-01-01')",
]
# What the pre-Alembic startup code then did to such files: migrate() added two columns with
# ALTER TABLE, and create_all added the changes table.
PRE_ALEMBIC_DDL = [
    "ALTER TABLE resource_record_sets ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'",
    "CREATE TABLE changes (id VARCHAR(32) NOT NULL, hosted_zone_id VARCHAR(32) NOT NULL, action VARCHAR(8) NOT NULL, "
    "target VARCHAR(512) NOT NULL, record_type VARCHAR(8), submitted_by VARCHAR(64) NOT NULL, "
    "submitted_at DATETIME NOT NULL, PRIMARY KEY (id), "
    "FOREIGN KEY(hosted_zone_id) REFERENCES hosted_zones (id) ON DELETE CASCADE)",
    "CREATE INDEX ix_changes_zone_submitted ON changes (hosted_zone_id, submitted_at)",
    "INSERT INTO users (id, account_id, username, password_hash, created_at, role) "
    "VALUES (2, '123456789012', 'viewer', 'y', '2026-01-02', 'read_only')",
    "UPDATE resource_record_sets SET version = 3 WHERE id = 'R1'",
    "INSERT INTO changes VALUES ('C1', 'ZPUB1', 'UPSERT', 'example.com A', 'A', 'demo', '2026-01-03')",
]


@pytest.fixture()
def legacy_db(tmp_path):
    """Build a pre-Alembic database file and return its URL.

    kind="first_release": the original schema; kind="pre_alembic": after the old migrate().
    """
    from sqlalchemy import create_engine

    def build(kind: str = "first_release") -> str:
        url = f"sqlite:///{(tmp_path / f'{kind}.db').as_posix()}"
        eng = create_engine(url)
        with eng.begin() as conn:
            for sql in FIRST_RELEASE_DDL + FIRST_RELEASE_ROWS + (PRE_ALEMBIC_DDL if kind == "pre_alembic" else []):
                conn.exec_driver_sql(sql)
        eng.dispose()
        return url

    return build
