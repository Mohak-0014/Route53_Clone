import pytest

def test_create_zone_normalizes_and_adds_defaults(client, auth, zone):
    assert zone["name"] == "test.example"
    assert zone["id"].startswith("Z")
    assert zone["record_count"] == 2  # SOA + NS
    assert len(zone["name_servers"]) == 4
    assert zone["created_at"].endswith("Z")


def test_create_zone_validation(client, auth):
    for name in ("", "no_dots", "-bad.com", "a..com", "x" * 64 + ".com"):
        r = client.post("/api/hosted-zones", json={"name": name}, headers=auth)
        assert r.status_code == 422, name
        assert r.json()["code"] == "InvalidInput"


def test_private_zone_requires_vpc(client, auth):
    r = client.post("/api/hosted-zones", json={"name": "corp.local.net", "type": "private"}, headers=auth)
    assert r.status_code == 422
    r = client.post(
        "/api/hosted-zones",
        json={"name": "corp.local.net", "type": "private", "vpc_region": "us-east-1", "vpc_id": "vpc-0abc1234"},
        headers=auth,
    )
    assert r.status_code == 201
    assert r.json()["type"] == "private"


def test_duplicate_public_zone_name_allowed(client, auth, zone):
    # Route 53 allows several hosted zones with the same name, each with its own ID.
    r = client.post("/api/hosted-zones", json={"name": "test.example"}, headers=auth)
    assert r.status_code == 201
    assert r.json()["id"] != zone["id"]
    names = [z["name"] for z in client.get("/api/hosted-zones?search=test.example", headers=auth).json()["items"]]
    assert names == ["test.example", "test.example"]


def test_private_zone_same_name_same_vpc_conflicts(client, auth):
    body = {"name": "corp.internal.net", "type": "private", "vpc_region": "us-east-1", "vpc_id": "vpc-0abc1234"}
    assert client.post("/api/hosted-zones", json=body, headers=auth).status_code == 201
    r = client.post("/api/hosted-zones", json=body, headers=auth)
    assert r.status_code == 409 and r.json()["code"] == "ConflictingDomainExists"
    # A different VPC (or a public zone) with the same name is fine.
    other_vpc = {**body, "vpc_id": "vpc-0def5678"}
    assert client.post("/api/hosted-zones", json=other_vpc, headers=auth).status_code == 201
    assert client.post("/api/hosted-zones", json={"name": "corp.internal.net"}, headers=auth).status_code == 201


def test_zone_list_query_count_does_not_grow_with_zones(client, auth):
    from sqlalchemy import event

    from app.database import engine

    def count_list_queries() -> int:
        statements = []
        listener = lambda *args: statements.append(args[2])  # noqa: E731
        event.listen(engine, "before_cursor_execute", listener)
        try:
            client.get("/api/hosted-zones?page_size=100", headers=auth)
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        return len(statements)

    client.post("/api/hosted-zones", json={"name": "q1.example"}, headers=auth)
    few = count_list_queries()
    for i in range(10):
        client.post("/api/hosted-zones", json={"name": f"q{i + 2}.example"}, headers=auth)
    assert count_list_queries() == few
    items = client.get("/api/hosted-zones?search=q1", headers=auth).json()["items"]
    assert all(len(z["name_servers"]) == 4 for z in items)


def test_list_search_pagination(client, auth):
    for i in range(12):
        client.post("/api/hosted-zones", json={"name": f"site{i:02d}.com"}, headers=auth)
    client.post("/api/hosted-zones", json={"name": "other.org", "comment": "special"}, headers=auth)

    r = client.get("/api/hosted-zones?page=1&page_size=5", headers=auth).json()
    assert r["total"] == 13 and r["total_pages"] == 3 and len(r["items"]) == 5
    r = client.get("/api/hosted-zones?page=3&page_size=5", headers=auth).json()
    assert len(r["items"]) == 3

    r = client.get("/api/hosted-zones?search=site1", headers=auth).json()
    assert {z["name"] for z in r["items"]} == {"site10.com", "site11.com"}
    r = client.get("/api/hosted-zones?search=SPECIAL", headers=auth).json()  # by comment
    assert r["total"] == 1


def test_get_update_zone(client, auth, zone):
    r = client.put(f"/api/hosted-zones/{zone['id']}", json={"comment": "updated"}, headers=auth)
    assert r.status_code == 200 and r.json()["comment"] == "updated"
    assert client.get(f"/api/hosted-zones/{zone['id']}", headers=auth).json()["comment"] == "updated"


def test_missing_zone(client, auth):
    for method in ("get", "delete"):
        r = getattr(client, method)("/api/hosted-zones/ZNOPE", headers=auth)
        assert r.status_code == 404
        assert r.json()["code"] == "NoSuchHostedZone"
    r = client.put("/api/hosted-zones/ZNOPE", json={"comment": "x"}, headers=auth)
    assert r.status_code == 404


def test_delete_zone_requires_empty(client, auth, zone):
    zid = zone["id"]
    rec = client.post(
        f"/api/hosted-zones/{zid}/records", json={"name": "www", "type": "A", "values": ["192.0.2.1"]}, headers=auth
    ).json()
    r = client.delete(f"/api/hosted-zones/{zid}", headers=auth)
    assert r.status_code == 400 and r.json()["code"] == "HostedZoneNotEmpty"

    client.delete(f"/api/hosted-zones/{zid}/records/{rec['id']}", headers=auth)
    assert client.delete(f"/api/hosted-zones/{zid}", headers=auth).status_code == 204
    assert client.get(f"/api/hosted-zones/{zid}", headers=auth).status_code == 404


def test_export(client, auth, zone):
    zid = zone["id"]
    client.post(
        f"/api/hosted-zones/{zid}/records",
        json={"name": "", "type": "MX", "values": ["10 mail.test.example"]},
        headers=auth,
    )
    bind = client.get(f"/api/hosted-zones/{zid}/export?format=bind", headers=auth)
    assert bind.status_code == 200
    assert "test.example.\t300\tIN\tMX\t10 mail.test.example." in bind.text
    js = client.get(f"/api/hosted-zones/{zid}/export?format=json", headers=auth).json()
    assert js["HostedZone"]["Name"] == "test.example."
    assert any(r["Type"] == "MX" for r in js["ResourceRecordSets"])


@pytest.mark.parametrize(
    "body",
    [
        {"comment": "x", "name": "other.example"},
        {"comment": "x", "type": "private"},
        {"comment": "x", "vpc_id": "vpc-0a1b2c3d", "vpc_region": "us-east-1"},
        {"name": "other.example"},
    ],
)
def test_update_rejects_immutable_fields(client, auth, zone, body):
    r = client.put(f"/api/hosted-zones/{zone['id']}", json=body, headers=auth)
    assert r.status_code == 422
    err = r.json()
    assert err["code"] == "InvalidInput"
    assert err["message"].startswith("Only the description of a hosted zone can be changed.")
    for field in body.keys() - {"comment"}:
        assert field in err["message"]
    # Nothing changed.
    got = client.get(f"/api/hosted-zones/{zone['id']}", headers=auth).json()
    assert (got["name"], got["type"], got["comment"]) == (zone["name"], zone["type"], zone["comment"])
