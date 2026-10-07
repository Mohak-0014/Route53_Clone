"""Change tracking: one change row per record action, PENDING → INSYNC status, zone history."""
import pytest
from sqlalchemy import func, select

from app.config import settings
from app.database import SessionLocal
from app.models import Change
from app.schemas.record import RecordCreate
from app.services import record_service


def _url(zone):
    return f"/api/hosted-zones/{zone['id']}/records"


def _history(client, auth, zone, **params):
    r = client.get(f"/api/hosted-zones/{zone['id']}/changes", params=params, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


def test_each_action_writes_one_change(client, auth, zone):
    r = client.post(_url(zone), json={"name": "www", "type": "A", "values": ["192.0.2.1"]}, headers=auth)
    assert r.status_code == 201
    created = r.json()
    assert created["change"]["id"].startswith("C") and len(created["change"]["id"]) == 21

    upd = client.put(f"{_url(zone)}/{created['id']}", json={"name": "www", "type": "A", "values": ["192.0.2.2"]}, headers=auth).json()
    batch = client.post(_url(zone) + "/batch", json={"records": [
        {"name": "b1", "type": "A", "values": ["192.0.2.3"]},
        {"name": "b2", "type": "A", "values": ["192.0.2.4"]},
    ]}, headers=auth).json()
    imp = client.post(_url(zone) + "/import", json={"zone_file": "i1 IN A 192.0.2.5\ni2 IN TXT \"x\"\n"}, headers=auth).json()
    bulk = client.post(_url(zone) + "/bulk-delete", json={"record_ids": [r["id"] for r in batch["records"]]}, headers=auth).json()
    dele = client.delete(f"{_url(zone)}/{created['id']}", headers=auth).json()

    history = _history(client, auth, zone, page_size=20)["items"]
    got = [(c["action"], c["target"], c["record_type"], c["submitted_by"]) for c in history]
    assert got == [  # newest first
        ("DELETE", "www.test.example A", "A", "demo"),
        ("DELETE", "2 records", "A", "demo"),
        ("IMPORT", "2 records", None, "demo"),
        ("CREATE", "2 records", "A", "demo"),
        ("UPSERT", "www.test.example A", "A", "demo"),
        ("CREATE", "www.test.example A", "A", "demo"),
    ]
    returned = [dele["change"], bulk["change"], imp["change"], batch["change"], upd["change"], created["change"]]
    assert [c["id"] for c in history] == [c["id"] for c in returned]


def test_status_goes_from_pending_to_insync(client, auth, zone, monkeypatch):
    monkeypatch.setattr(settings, "propagation_seconds", 3600)
    change = client.post(_url(zone), json={"name": "www", "type": "A", "values": ["192.0.2.1"]}, headers=auth).json()["change"]
    assert change["status"] == "PENDING" and change["submitted_at"].endswith("Z")
    got = client.get(f"/api/changes/{change['id']}", headers=auth).json()
    assert got["status"] == "PENDING" and got["action"] == "CREATE" and got["hosted_zone_id"] == zone["id"]

    monkeypatch.setattr(settings, "propagation_seconds", 0)
    assert client.get(f"/api/changes/{change['id']}", headers=auth).json()["status"] == "INSYNC"
    assert _history(client, auth, zone)["items"][0]["status"] == "INSYNC"


def test_get_unknown_change_is_404(client, auth):
    r = client.get("/api/changes/CNOPE", headers=auth)
    assert r.status_code == 404 and r.json()["code"] == "NoSuchChange"


def test_history_is_paginated_and_scoped_to_the_zone(client, auth, zone):
    other = client.post("/api/hosted-zones", json={"name": "other.example"}, headers=auth).json()
    for i in range(7):
        client.post(_url(zone), json={"name": f"r{i}", "type": "A", "values": ["192.0.2.1"]}, headers=auth)
    client.post(_url(other), json={"name": "x", "type": "A", "values": ["192.0.2.1"]}, headers=auth)

    p1 = _history(client, auth, zone, page=1, page_size=5)
    p2 = _history(client, auth, zone, page=2, page_size=5)
    assert (p1["total"], p1["total_pages"], len(p1["items"]), len(p2["items"])) == (7, 2, 5, 2)
    targets = [c["target"] for c in p1["items"] + p2["items"]]
    assert targets == [f"r{i}.test.example A" for i in range(6, -1, -1)]
    assert _history(client, auth, other)["total"] == 1
    assert client.get("/api/hosted-zones/ZNOPE/changes", headers=auth).status_code == 404


def test_changes_are_deleted_with_the_zone(client, auth, zone):
    rec = client.post(_url(zone), json={"name": "www", "type": "A", "values": ["192.0.2.1"]}, headers=auth).json()
    client.delete(f"{_url(zone)}/{rec['id']}", headers=auth)
    assert _history(client, auth, zone)["total"] == 2
    assert client.delete(f"/api/hosted-zones/{zone['id']}", headers=auth).status_code == 204
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Change).where(Change.hosted_zone_id == zone["id"])) == 0
    assert client.get(f"/api/changes/{rec['change']['id']}", headers=auth).status_code == 404


def test_no_op_actions_and_failed_batches_record_no_change(client, auth, zone):
    ns = client.get(_url(zone), params={"type": "NS"}, headers=auth).json()["items"][0]
    bulk = client.post(_url(zone) + "/bulk-delete", json={"record_ids": [ns["id"]]}, headers=auth).json()
    assert bulk["deleted"] == 0 and bulk["change"] is None
    imp = client.post(_url(zone) + "/import", json={"zone_file": "; nothing but a comment\n"}, headers=auth).json()
    assert imp["created"] == 0 and imp["change"] is None
    failed = client.post(_url(zone) + "/batch", json={"records": [
        {"name": "ok", "type": "A", "values": ["192.0.2.1"]},
        {"name": "bad", "type": "A", "values": ["not-an-ip"]},
    ]}, headers=auth)
    assert failed.status_code == 400
    assert _history(client, auth, zone)["total"] == 0


def test_seed_style_calls_without_actor_record_no_change(client, auth, zone):
    with SessionLocal() as db:
        out, change = record_service.create_record(db, zone["id"], RecordCreate(name="seeded", type="A", values=["192.0.2.1"]))
        assert out.name == "seeded.test.example" and change is None
    assert _history(client, auth, zone)["total"] == 0


@pytest.mark.parametrize("path", ["/api/changes/C123", "/api/hosted-zones/Z1/changes"])
def test_change_endpoints_require_auth(client, path):
    assert client.get(path).status_code == 401
