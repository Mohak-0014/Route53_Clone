"""Optimistic locking on record updates (version / expected_version) and the startup migration."""
import pytest
from sqlalchemy import create_engine, text

from app.database import SessionLocal
from app.db_migrations import upgrade_database
from app.models import ResourceRecordSet


def _url(zone):
    return f"/api/hosted-zones/{zone['id']}/records"


@pytest.fixture()
def record(client, auth, zone):
    r = client.post(_url(zone), json={"name": "www", "type": "A", "values": ["192.0.2.1"]}, headers=auth)
    assert r.status_code == 201
    return r.json()


def _update(client, auth, zone, rec, value, **extra):
    body = {"name": "www", "type": "A", "values": [value], **extra}
    return client.put(f"{_url(zone)}/{rec['id']}", json=body, headers=auth)


def test_new_record_starts_at_version_1(record):
    assert record["version"] == 1


def test_update_with_current_version_increments(client, auth, zone, record):
    r = _update(client, auth, zone, record, "192.0.2.2", expected_version=1)
    assert r.status_code == 200 and r.json()["version"] == 2
    r = _update(client, auth, zone, record, "192.0.2.3", expected_version=2)
    assert r.status_code == 200 and r.json()["version"] == 3


def test_update_with_stale_version_is_409(client, auth, zone, record):
    assert _update(client, auth, zone, record, "192.0.2.2", expected_version=1).status_code == 200
    r = _update(client, auth, zone, record, "192.0.2.9", expected_version=1)
    assert r.status_code == 409
    assert r.json() == {
        "code": "ConcurrentModification",
        "message": "This record was changed after you opened it. Reload to see the latest values, then try again.",
    }
    got = client.get(f"{_url(zone)}/{record['id']}", headers=auth).json()
    assert got["values"] == ["192.0.2.2"] and got["version"] == 2  # the stale write changed nothing


def test_update_without_expected_version_still_works(client, auth, zone, record):
    r = _update(client, auth, zone, record, "192.0.2.5")
    assert r.status_code == 200 and r.json()["version"] == 2


def test_expected_version_validation(client, auth, zone, record):
    assert _update(client, auth, zone, record, "192.0.2.5", expected_version=0).status_code == 422


def test_default_and_batch_records_are_versioned(client, auth, zone):
    ns = client.get(_url(zone), params={"type": "NS"}, headers=auth).json()["items"][0]
    assert ns["version"] == 1
    r = client.put(f"{_url(zone)}/{ns['id']}", json={"name": "", "type": "NS", "ttl": 60, "values": ns["values"], "expected_version": 1}, headers=auth)
    assert r.status_code == 200 and r.json()["version"] == 2
    batch = client.post(_url(zone) + "/batch", json={"records": [{"name": "b", "type": "A", "values": ["192.0.2.1"]}]}, headers=auth)
    assert batch.json()["records"][0]["version"] == 1


def test_concurrent_write_between_read_and_commit_is_rejected(client, auth, zone, record):
    """Two sessions load version 1; the second commit must fail rather than overwrite."""
    first, second = SessionLocal(), SessionLocal()
    try:
        a = first.get(ResourceRecordSet, record["id"])
        b = second.get(ResourceRecordSet, record["id"])
        a.ttl = 111
        first.commit()
        b.ttl = 222
        with pytest.raises(Exception) as exc:
            second.commit()
        assert type(exc.value).__name__ == "StaleDataError"
    finally:
        first.close()
        second.close()


@pytest.mark.parametrize("kind", ["first_release", "pre_alembic"])
def test_upgrade_adds_version_to_an_existing_database(legacy_db, kind):
    url = legacy_db(kind)  # a file from before Alembic; first_release has no `version` column
    upgrade_database(url)
    upgrade_database(url)  # idempotent
    engine = create_engine(url)
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(resource_record_sets)"))]
        assert cols.count("version") == 1
        versions = dict(conn.execute(text("SELECT id, version FROM resource_record_sets")).all())
    engine.dispose()
    # Existing rows start at 1; a version the old migrate() already tracked is kept.
    assert versions == {"R1": 3 if kind == "pre_alembic" else 1, "R2": 1, "R3": 1}
