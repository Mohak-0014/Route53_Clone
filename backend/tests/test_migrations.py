"""Alembic migrations: fresh and pre-Alembic databases reach the same schema as the models."""
import os
import re
import subprocess
import sys

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, select, text

import app.models  # noqa: F401
from app.config import settings
from app.database import Base, SessionLocal
from app.db_migrations import BACKEND_DIR, alembic_config, upgrade_database
from app.models import HostedZone
from app.seed import DEMO_ZONES, init_db

HEAD = ScriptDirectory.from_config(alembic_config()).get_current_head()


def _norm(sql: str | None) -> str | None:
    return re.sub(r"\s+", " ", sql).strip().lower() if sql else sql


def schema_of(url: str) -> dict:
    """Everything that matters about a database's schema, in comparable form."""
    eng = create_engine(url)
    try:
        insp = inspect(eng)
        with eng.connect() as conn:
            index_sql = dict(conn.execute(text("SELECT name, sql FROM sqlite_master WHERE type = 'index'")).all())
        out = {}
        for table in sorted(set(insp.get_table_names()) - {"alembic_version"}):
            out[table] = {
                # Sorted: ALTER TABLE ADD COLUMN appends, so pre-Alembic files have role and
                # version last. Column order has no effect on the app.
                "columns": sorted(
                    (c["name"], str(c["type"]), c["nullable"], (c["default"] or "").strip("'\""))
                    for c in insp.get_columns(table)
                ),
                "pk": insp.get_pk_constraint(table)["constrained_columns"],
                "fks": sorted(
                    (tuple(f["constrained_columns"]), f["referred_table"], f["options"].get("ondelete"))
                    for f in insp.get_foreign_keys(table)
                ),
                "uniques": sorted((u["name"], tuple(u["column_names"])) for u in insp.get_unique_constraints(table)),
                "checks": sorted((c["name"], _norm(c["sqltext"])) for c in insp.get_check_constraints(table)),
                "indexes": sorted(
                    (
                        i["name"],
                        tuple(i["column_names"]),
                        bool(i["unique"]),
                        # The partial-index WHERE clause, which reflection doesn't report.
                        _norm(index_sql[i["name"]].split(" WHERE ", 1)[1]) if " WHERE " in (index_sql.get(i["name"]) or "") else None,
                    )
                    for i in insp.get_indexes(table)
                ),
            }
        return out
    finally:
        eng.dispose()


def _url(tmp_path, name: str) -> str:
    return f"sqlite:///{(tmp_path / name).as_posix()}"


@pytest.fixture()
def models_schema(tmp_path):
    """The schema Base.metadata describes (what create_all would build)."""
    url = _url(tmp_path, "models.db")
    eng = create_engine(url)
    Base.metadata.create_all(eng)
    eng.dispose()
    return schema_of(url)


def _version(url: str) -> str | None:
    eng = create_engine(url)
    with eng.connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    eng.dispose()
    return version


def test_fresh_database_upgrades_to_head_matching_the_models(tmp_path, models_schema):
    url = _url(tmp_path, "fresh.db")
    upgrade_database(url)
    assert _version(url) == HEAD
    assert schema_of(url) == models_schema


def test_alembic_check_finds_no_model_changes_without_a_migration(tmp_path):
    """`alembic check`: autogenerate must find nothing to migrate (columns, types, indexes...)."""
    url = _url(tmp_path, "check.db")
    upgrade_database(url)
    command.check(alembic_config(url))


@pytest.mark.parametrize("kind", ["first_release", "pre_alembic"])
def test_pre_alembic_database_upgrades_with_data_intact(legacy_db, kind, models_schema):
    url = legacy_db(kind)
    upgrade_database(url)
    assert _version(url) == HEAD
    # Same tables, columns, constraints and indexes as a fresh database.
    assert schema_of(url) == models_schema

    eng = create_engine(url)
    with eng.connect() as conn:
        q = lambda sql: conn.execute(text(sql)).all()  # noqa: E731
        assert q("SELECT id, name, zone_type, vpc_id, vpc_region FROM hosted_zones ORDER BY id") == [
            ("ZPRIV1", "corp.example", "private", "vpc-0a1b2c3d", "ap-south-1"),
            ("ZPUB1", "example.com", "public", None, None),
        ]
        assert q("SELECT id, hosted_zone_id, name, record_type, ttl, values_json FROM resource_record_sets ORDER BY id") == [
            ("R1", "ZPUB1", "example.com", "A", 300, '["192.0.2.1"]'),
            ("R2", "ZPUB1", "www.example.com", "CNAME", 60, '["example.com"]'),
            ("R3", "ZPRIV1", "db.corp.example", "A", 60, '["10.0.0.5"]'),
        ]
        assert q("SELECT token, user_id FROM sessions") == [("tok-1", 1)]
        assert q("SELECT id, action FROM changes") == ([("C1", "UPSERT")] if kind == "pre_alembic" else [])
        assert q("PRAGMA foreign_key_check") == []
    eng.dispose()


def test_upgrade_on_startup_is_a_no_op_at_head(tmp_path):
    url = _url(tmp_path, "twice.db")
    upgrade_database(url)
    before = schema_of(url)
    upgrade_database(url)
    assert schema_of(url) == before and _version(url) == HEAD


def test_init_db_migrates_and_seeds_a_fresh_database(client, monkeypatch):
    monkeypatch.setattr(settings, "seed_demo_data", True)
    from app.db_migrations import reset_database

    reset_database()
    init_db()
    assert _version(settings.database_url) == HEAD
    with SessionLocal() as db:
        assert sorted(db.scalars(select(HostedZone.name))) == sorted(z["zone"]["name"] for z in DEMO_ZONES)
    init_db()  # restart: no duplicate seed data
    with SessionLocal() as db:
        assert len(db.scalars(select(HostedZone)).all()) == len(DEMO_ZONES)


def test_seed_reset_command(tmp_path):
    env = {**os.environ, "DATABASE_URL": _url(tmp_path, "reset.db"), "SEED_DEMO_DATA": "true"}
    for _ in range(2):  # create, then wipe and rebuild
        r = subprocess.run(
            [sys.executable, "-m", "app.seed", "--reset"], cwd=BACKEND_DIR, env=env, capture_output=True, text=True
        )
        assert r.returncode == 0, r.stderr
    eng = create_engine(env["DATABASE_URL"])
    with eng.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM hosted_zones")).scalar() == len(DEMO_ZONES)
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == HEAD
    eng.dispose()
