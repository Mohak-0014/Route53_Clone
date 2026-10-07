"""Mocked IAM roles: the read-only user can read everything but every write is AccessDenied."""
import pytest
from sqlalchemy import create_engine, text

from app.config import settings
from app.database import Base, engine
from app.seed import init_db, migrate

ACCOUNT = "123456789012"


def _login(client, username, password):
    r = client.post("/api/auth/login", json={"account_id": ACCOUNT, "username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture()
def viewer(client):
    return {"Authorization": f"Bearer {_login(client, 'viewer', 'viewer1234')['token']}"}


@pytest.fixture()
def record(client, auth, zone):
    r = client.post(f"/api/hosted-zones/{zone['id']}/records", json={"name": "www", "type": "A", "values": ["192.0.2.1"]}, headers=auth)
    assert r.status_code == 201
    return r.json()


def test_session_includes_role(client):
    assert _login(client, "demo", "demo1234")["user"]["role"] == "admin"
    viewer = _login(client, "viewer", "viewer1234")
    assert viewer["user"] == {"username": "viewer", "account_id": ACCOUNT, "role": "read_only"}
    me = client.get("/api/auth/session", headers={"Authorization": f"Bearer {viewer['token']}"}).json()
    assert me["user"]["role"] == "read_only"


def _writes(zone_id, record_id):
    z, rec = f"/api/hosted-zones/{zone_id}", f"/api/hosted-zones/{zone_id}/records"
    a_record = {"name": "new", "type": "A", "values": ["192.0.2.9"]}
    return [
        ("post", "/api/hosted-zones", {"name": "viewer-made.example"}, "CreateHostedZone", "*"),
        ("put", z, {"comment": "changed"}, "UpdateHostedZoneComment", zone_id),
        ("delete", z, None, "DeleteHostedZone", zone_id),
        ("post", rec, a_record, "ChangeResourceRecordSets", zone_id),
        ("post", f"{rec}/batch", {"records": [a_record]}, "ChangeResourceRecordSets", zone_id),
        ("post", f"{rec}/bulk-delete", {"record_ids": [record_id]}, "ChangeResourceRecordSets", zone_id),
        ("post", f"{rec}/import", {"zone_file": "x IN A 192.0.2.7\n"}, "ChangeResourceRecordSets", zone_id),
        ("put", f"{rec}/{record_id}", {"name": "www", "type": "A", "values": ["192.0.2.2"]}, "ChangeResourceRecordSets", zone_id),
        ("delete", f"{rec}/{record_id}", None, "ChangeResourceRecordSets", zone_id),
    ]


def test_viewer_gets_access_denied_on_every_write(client, auth, viewer, zone, record):
    before_zones = client.get("/api/hosted-zones", headers=auth).json()["total"]
    before_records = client.get(f"/api/hosted-zones/{zone['id']}/records", headers=auth).json()["total"]
    for method, url, body, action, resource in _writes(zone["id"], record["id"]):
        kwargs = {"headers": viewer} | ({"json": body} if body is not None else {})
        r = getattr(client, method)(url, **kwargs)
        assert r.status_code == 403, (method, url, r.text)
        assert r.json() == {
            "code": "AccessDenied",
            "message": f"User: arn:aws:iam::{ACCOUNT}:user/viewer is not authorized to perform: "
            f"route53:{action} on resource: arn:aws:route53:::hostedzone/{resource}",
        }
    # Nothing changed.
    assert client.get("/api/hosted-zones", headers=auth).json()["total"] == before_zones
    assert client.get(f"/api/hosted-zones/{zone['id']}/records", headers=auth).json()["total"] == before_records
    assert client.get(f"/api/hosted-zones/{zone['id']}", headers=auth).json()["comment"] == zone["comment"]
    assert client.get(f"/api/hosted-zones/{zone['id']}/changes", headers=auth).json()["total"] == 1  # only the admin's create


def test_viewer_can_read_search_export_and_test(client, viewer, zone, record):
    zid = zone["id"]
    ok = [
        client.get("/api/hosted-zones", params={"search": "test"}, headers=viewer),
        client.get(f"/api/hosted-zones/{zid}", headers=viewer),
        client.get(f"/api/hosted-zones/{zid}/records", params={"search": "www"}, headers=viewer),
        client.get(f"/api/hosted-zones/{zid}/records/{record['id']}", headers=viewer),
        client.get(f"/api/hosted-zones/{zid}/export", params={"format": "bind"}, headers=viewer),
        client.get(f"/api/hosted-zones/{zid}/export", params={"format": "json"}, headers=viewer),
        client.post(f"/api/hosted-zones/{zid}/test-record", json={"record_name": "www", "type": "A"}, headers=viewer),
        client.get(f"/api/hosted-zones/{zid}/changes", headers=viewer),
        client.get(f"/api/changes/{record['change']['id']}", headers=viewer),
    ]
    assert [r.status_code for r in ok] == [200] * len(ok)


def test_viewer_password_comes_from_settings(client, monkeypatch):
    monkeypatch.setattr(settings, "viewer_password", "s3cret-view")
    Base.metadata.drop_all(bind=engine)
    init_db()
    assert client.post("/api/auth/login", json={"account_id": ACCOUNT, "username": "viewer", "password": "viewer1234"}).status_code == 401
    assert _login(client, "viewer", "s3cret-view")["user"]["role"] == "read_only"


def test_migration_adds_role_to_existing_users(tmp_path):
    old = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with old.begin() as conn:  # the users table before roles existed
        conn.execute(text(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, account_id VARCHAR(12) NOT NULL, "
            "username VARCHAR(64) NOT NULL UNIQUE, password_hash VARCHAR(256) NOT NULL, created_at DATETIME NOT NULL)"
        ))
        conn.execute(text("INSERT INTO users VALUES (1, '123456789012', 'demo', 'x', '2026-01-01')"))
    migrate(old)
    migrate(old)  # idempotent
    with old.connect() as conn:
        assert conn.execute(text("SELECT role FROM users WHERE username = 'demo'")).scalar() == "admin"
    old.dispose()
