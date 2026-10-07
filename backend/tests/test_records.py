import pytest

VALID = [
    ("A", ["192.0.2.1", "192.0.2.2"]),
    ("AAAA", ["2001:db8::1"]),
    ("CNAME", ["target.example.net"]),
    ("TXT", ['"v=spf1 -all"']),
    ("MX", ["10 mail.example.net", "20 mail2.example.net"]),
    ("NS", ["ns1.example.net"]),
    ("PTR", ["host.example.net"]),
    ("SRV", ["1 10 5269 xmpp.example.net"]),
    ("CAA", ['0 issue "amazon.com"']),
]

INVALID = [
    ("A", ["999.1.1.1"]),
    ("A", ["2001:db8::1"]),
    ("AAAA", ["192.0.2.1"]),
    ("CNAME", ["a.example.net", "b.example.net"]),
    ("CNAME", ["bad_host!"]),
    ("MX", ["mail.example.net"]),
    ("MX", ["99999 mail.example.net"]),
    ("SRV", ["1 10 mail.example.net"]),
    ("CAA", ["0 issue amazon.com"]),
    ("CAA", ['0 badtag "x"']),
    ("TXT", ['"' + "x" * 300 + '"']),
]


def _url(zone):
    return f"/api/hosted-zones/{zone['id']}/records"


@pytest.mark.parametrize("rtype,values", VALID)
def test_create_each_type(client, auth, zone, rtype, values):
    r = client.post(_url(zone), json={"name": f"r-{rtype.lower()}", "type": rtype, "ttl": 120, "values": values}, headers=auth)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == f"r-{rtype.lower()}.test.example"
    assert body["type"] == rtype and body["ttl"] == 120 and len(body["values"]) == len(values)


@pytest.mark.parametrize("rtype,values", INVALID)
def test_invalid_values(client, auth, zone, rtype, values):
    r = client.post(_url(zone), json={"name": "bad", "type": rtype, "values": values}, headers=auth)
    assert r.status_code == 400, r.text
    assert r.json()["code"] == "InvalidChangeBatch"


def test_schema_validation(client, auth, zone):
    assert client.post(_url(zone), json={"name": "x", "type": "SOA", "values": ["x"]}, headers=auth).status_code == 422
    assert client.post(_url(zone), json={"name": "x", "type": "A", "values": []}, headers=auth).status_code == 422
    assert client.post(_url(zone), json={"name": "x", "type": "A", "values": ["1.1.1.1"], "ttl": -1}, headers=auth).status_code == 422
    assert client.post(_url(zone), json={"type": "A"}, headers=auth).status_code == 422


def test_txt_auto_quoted(client, auth, zone):
    r = client.post(_url(zone), json={"name": "t", "type": "TXT", "values": ["hello world"]}, headers=auth)
    assert r.json()["values"] == ['"hello world"']


def test_apex_and_fqdn_names(client, auth, zone):
    r = client.post(_url(zone), json={"name": "@", "type": "A", "values": ["192.0.2.1"]}, headers=auth)
    assert r.json()["name"] == "test.example"
    r = client.post(_url(zone), json={"name": "Deep.Sub.test.example.", "type": "A", "values": ["192.0.2.1"]}, headers=auth)
    assert r.json()["name"] == "deep.sub.test.example"
    r = client.post(_url(zone), json={"name": "*", "type": "A", "values": ["192.0.2.1"]}, headers=auth)
    assert r.json()["name"] == "*.test.example"


def test_conflicts(client, auth, zone):
    client.post(_url(zone), json={"name": "www", "type": "A", "values": ["192.0.2.1"]}, headers=auth)
    r = client.post(_url(zone), json={"name": "www", "type": "A", "values": ["192.0.2.2"]}, headers=auth)
    assert r.status_code == 409 and r.json()["code"] == "RecordAlreadyExists"
    r = client.post(_url(zone), json={"name": "www", "type": "CNAME", "values": ["x.example.net"]}, headers=auth)
    assert r.status_code == 409 and r.json()["code"] == "CNAMEConflict"
    r = client.post(_url(zone), json={"name": "", "type": "CNAME", "values": ["x.example.net"]}, headers=auth)
    assert r.status_code == 400  # CNAME at apex


def test_list_search_filter_paginate(client, auth, zone):
    for i in range(15):
        client.post(_url(zone), json={"name": f"host{i:02d}", "type": "A", "values": [f"10.0.0.{i}"]}, headers=auth)
    client.post(_url(zone), json={"name": "mail", "type": "MX", "values": ["10 mx.example.net"]}, headers=auth)

    r = client.get(_url(zone) + "?page_size=10", headers=auth).json()
    assert r["total"] == 18 and r["total_pages"] == 2
    assert [x["type"] for x in r["items"][:2]] == ["NS", "SOA"]  # apex defaults first
    assert r["items"][0]["is_default"] is True

    r = client.get(_url(zone) + "?type=MX", headers=auth).json()
    assert r["total"] == 1
    r = client.get(_url(zone) + "?type=A,MX", headers=auth).json()
    assert r["total"] == 16
    r = client.get(_url(zone) + "?search=host1", headers=auth).json()
    assert r["total"] == 5
    r = client.get(_url(zone) + "?search=10.0.0.7", headers=auth).json()  # by value
    assert r["total"] == 1


def test_update_and_delete(client, auth, zone):
    rec = client.post(_url(zone), json={"name": "app", "type": "A", "values": ["192.0.2.1"]}, headers=auth).json()
    r = client.put(
        f"{_url(zone)}/{rec['id']}",
        json={"name": "app", "type": "A", "ttl": 60, "values": ["192.0.2.9", "192.0.2.10"]},
        headers=auth,
    )
    assert r.status_code == 200 and r.json()["ttl"] == 60 and len(r.json()["values"]) == 2
    got = client.get(f"{_url(zone)}/{rec['id']}", headers=auth).json()
    assert got["values"] == ["192.0.2.9", "192.0.2.10"]

    d = client.delete(f"{_url(zone)}/{rec['id']}", headers=auth)
    assert d.status_code == 200 and d.json()["change"]["id"].startswith("C")
    assert client.get(f"{_url(zone)}/{rec['id']}", headers=auth).status_code == 404


def test_default_records_protected(client, auth, zone):
    items = client.get(_url(zone), headers=auth).json()["items"]
    ns = next(i for i in items if i["type"] == "NS")
    r = client.delete(f"{_url(zone)}/{ns['id']}", headers=auth)
    assert r.status_code == 400
    # TTL / values editable, type not
    r = client.put(f"{_url(zone)}/{ns['id']}", json={"name": "", "type": "NS", "ttl": 3600, "values": ns["values"]}, headers=auth)
    assert r.status_code == 200 and r.json()["ttl"] == 3600
    r = client.put(f"{_url(zone)}/{ns['id']}", json={"name": "", "type": "A", "values": ["1.1.1.1"]}, headers=auth)
    assert r.status_code == 400


def test_record_in_other_zone_not_found(client, auth, zone):
    other = client.post("/api/hosted-zones", json={"name": "other.example"}, headers=auth).json()
    rec = client.post(_url(zone), json={"name": "a", "type": "A", "values": ["192.0.2.1"]}, headers=auth).json()
    assert client.get(f"/api/hosted-zones/{other['id']}/records/{rec['id']}", headers=auth).status_code == 404


def test_bulk_delete(client, auth, zone):
    ids = [
        client.post(_url(zone), json={"name": f"b{i}", "type": "A", "values": ["192.0.2.1"]}, headers=auth).json()["id"]
        for i in range(3)
    ]
    ns_id = client.get(_url(zone) + "?type=NS", headers=auth).json()["items"][0]["id"]
    r = client.post(_url(zone) + "/bulk-delete", json={"record_ids": ids + [ns_id]}, headers=auth).json()
    assert (r["deleted"], r["skipped"]) == (3, 1) and r["change"]["status"] in ("PENDING", "INSYNC")


def test_import_bind(client, auth, zone):
    zone_file = """
$ORIGIN test.example.
$TTL 3600
@       IN SOA ns1.test.example. admin.test.example. (
            2024010101 7200 900 1209600 86400 )
@       IN NS   ns1.other.net.
@       IN A    192.0.2.1
        IN A    192.0.2.2
www  300 IN CNAME test.example.
@       IN MX   10 mail
mail    IN A    192.0.2.3
@       IN TXT  "v=spf1 include:_spf.google.com ~all" ; comment
_sip._tcp IN SRV 10 5 5060 sip.test.example.
bad     IN A    not-an-ip
"""
    r = client.post(_url(zone) + "/import", json={"zone_file": zone_file}, headers=auth).json()
    assert r["created"] == 6, r
    assert any("not-an-ip" in e for e in r["errors"])
    recs = client.get(_url(zone) + "?page_size=50", headers=auth).json()["items"]
    apex_a = next(x for x in recs if x["type"] == "A" and x["name"] == "test.example")
    assert apex_a["values"] == ["192.0.2.1", "192.0.2.2"] and apex_a["ttl"] == 3600
    mx = next(x for x in recs if x["type"] == "MX")
    assert mx["values"] == ["10 mail.test.example"]
    # Importing again skips existing record sets
    r = client.post(_url(zone) + "/import", json={"zone_file": zone_file}, headers=auth).json()
    assert r["created"] == 0 and r["skipped"] == 6


def test_search_treats_like_wildcards_literally(client, auth, zone):
    client.post(_url(zone), json={"name": "_dmarc", "type": "TXT", "values": ['"v=DMARC1"']}, headers=auth)
    client.post(_url(zone), json={"name": "www", "type": "A", "values": ["192.0.2.1"]}, headers=auth)
    names = lambda q: [x["name"] for x in client.get(_url(zone), params={"search": q}, headers=auth).json()["items"]]
    assert names("_") == ["_dmarc.test.example"]
    assert names("%") == []


def test_default_record_invalid_name_is_400(client, auth, zone):
    ns = client.get(_url(zone), params={"type": "NS"}, headers=auth).json()["items"][0]
    r = client.put(f"{_url(zone)}/{ns['id']}", json={"name": "bad name!", "type": "NS", "values": ns["values"]}, headers=auth)
    assert r.status_code == 400 and r.json()["code"] == "InvalidChangeBatch"


def test_batch_create_is_atomic(client, auth, zone):
    url = _url(zone) + "/batch"
    ok = [
        {"name": "w1", "type": "A", "values": ["192.0.2.1"]},
        {"name": "w1", "type": "AAAA", "values": ["2001:db8::1"]},
        {"name": "", "type": "MX", "values": ["10 mail.test.example"]},
    ]
    r = client.post(url, json={"records": ok}, headers=auth)
    assert r.status_code == 201, r.text
    assert [x["name"] for x in r.json()["records"]] == ["w1.test.example", "w1.test.example", "test.example"]

    before = client.get(_url(zone), headers=auth).json()["total"]
    bad = [
        {"name": "w2", "type": "A", "values": ["192.0.2.2"]},
        {"name": "w3", "type": "A", "values": ["not-an-ip"]},
    ]
    r = client.post(url, json={"records": bad}, headers=auth)
    assert r.status_code == 400 and r.json()["message"].startswith("Record 2:")
    assert client.get(_url(zone), headers=auth).json()["total"] == before  # nothing from the batch was kept


def test_batch_create_checks_conflicts_within_batch(client, auth, zone):
    url = _url(zone) + "/batch"
    dup = [{"name": "x", "type": "A", "values": ["192.0.2.1"]}, {"name": "x", "type": "A", "values": ["192.0.2.2"]}]
    r = client.post(url, json={"records": dup}, headers=auth)
    assert r.status_code == 409 and r.json()["code"] == "RecordAlreadyExists"
    cname = [{"name": "y", "type": "A", "values": ["192.0.2.1"]}, {"name": "y", "type": "CNAME", "values": ["t.example.net"]}]
    r = client.post(url, json={"records": cname}, headers=auth)
    assert r.status_code == 409 and r.json()["code"] == "CNAMEConflict"
    assert client.post(url, json={"records": []}, headers=auth).status_code == 422


def test_value_search_ignores_json_encoding(client, auth, zone):
    client.post(_url(zone), json={"name": "t", "type": "TXT", "values": ['"hello world"']}, headers=auth)
    client.post(_url(zone), json={"name": "a", "type": "A", "values": ["192.0.2.1", "192.0.2.2"]}, headers=auth)
    names = lambda q: sorted(x["name"] for x in client.get(_url(zone), params={"search": q}, headers=auth).json()["items"])
    assert names('"hello') == ["t.test.example"]  # a literal quote finds the quoted TXT value
    assert names("192.0.2.2") == ["a.test.example"]  # any value of a multi-value record
    assert names('", "') == []  # JSON list separators are not searchable text
    assert names("[") == []
