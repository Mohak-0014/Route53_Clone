"""POST /api/hosted-zones/{id}/test-record — one test per resolution rule."""
import pytest

RECORDS = [
    ("www", "A", ["192.0.2.1", "192.0.2.2"]),
    ("alias", "CNAME", ["www.test.example"]),
    ("ext", "CNAME", ["target.example.net"]),
    ("dangling", "CNAME", ["nothere.test.example"]),
    ("loop1", "CNAME", ["loop2.test.example"]),
    ("loop2", "CNAME", ["loop1.test.example"]),
    ("sub", "NS", ["ns1.example.net", "ns2.example.net"]),
    ("host.sub", "A", ["192.0.2.50"]),
    ("*.apps", "A", ["192.0.2.9"]),
    ("deep.x.y", "A", ["192.0.2.77"]),
] + [(f"c{i}", "CNAME", [f"c{i + 1}.test.example"]) for i in range(12)]


@pytest.fixture()
def ask(client, auth, zone):
    for name, rtype, values in RECORDS:
        r = client.post(f"/api/hosted-zones/{zone['id']}/records", json={"name": name, "type": rtype, "values": values}, headers=auth)
        assert r.status_code == 201, r.text

    def _ask(name, rtype, expect=200):
        r = client.post(f"/api/hosted-zones/{zone['id']}/test-record", json={"record_name": name, "type": rtype}, headers=auth)
        assert r.status_code == expect, r.text
        return r.json()

    return _ask


def values(res, section="answers"):
    return [(a["name"], a["type"], a["value"]) for a in res[section]]


def test_rule1_name_outside_zone(ask):
    err = ask("www.other.net.", "A", expect=400)
    assert err["code"] == "InvalidInput" and "not in the hosted zone" in err["message"]
    assert ask("bad name!", "A", expect=400)["code"] == "InvalidInput"


def test_rule2_delegation(ask):
    for name in ("sub", "host.sub", "a.b.sub"):
        res = ask(name, "A")
        assert res["response_code"] == "NOERROR" and res["answers"] == []
        assert [a["value"] for a in res["authority"]] == ["ns1.example.net", "ns2.example.net"]
        assert any("Delegated to a subdomain" in n for n in res["notes"])
    # Asking for the NS record itself returns it as an answer.
    res = ask("sub", "NS")
    assert values(res) == [("sub.test.example", "NS", "ns1.example.net"), ("sub.test.example", "NS", "ns2.example.net")]


def test_rule3_exact_match(ask):
    res = ask("www", "A")
    assert res["response_code"] == "NOERROR" and res["protocol"] == "UDP"
    assert res["query_name"] == "www.test.example" and res["query_type"] == "A"
    assert values(res) == [("www.test.example", "A", "192.0.2.1"), ("www.test.example", "A", "192.0.2.2")]
    assert res["authority"] == [] and res["notes"] == []
    # FQDN, "@" and the apex
    assert ask("www.test.example.", "A")["answers"] and len(ask("@", "NS")["answers"]) == 4
    assert ask("", "SOA")["answers"][0]["type"] == "SOA"


def test_rule4_cname_chase(ask):
    res = ask("alias", "A")
    assert res["response_code"] == "NOERROR"
    assert values(res) == [
        ("alias.test.example", "CNAME", "www.test.example"),
        ("www.test.example", "A", "192.0.2.1"),
        ("www.test.example", "A", "192.0.2.2"),
    ]
    # Asking for the CNAME itself does not chase it.
    assert values(ask("alias", "CNAME")) == [("alias.test.example", "CNAME", "www.test.example")]


def test_rule4_cname_target_outside_zone(ask):
    res = ask("ext", "A")
    assert values(res) == [("ext.test.example", "CNAME", "target.example.net")]
    assert any("outside this hosted zone" in n for n in res["notes"])


def test_rule4_cname_dangling_target_is_nxdomain(ask):
    res = ask("dangling", "A")
    assert res["response_code"] == "NXDOMAIN" and len(res["answers"]) == 1
    assert res["authority"][0]["type"] == "SOA"


def test_rule4_cname_loop_and_hop_limit(ask):
    loop = ask("loop1", "A")
    assert [a["name"] for a in loop["answers"]] == ["loop1.test.example", "loop2.test.example"]
    assert any("loop" in n for n in loop["notes"])
    chain = ask("c0", "A")
    assert len(chain["answers"]) == 8 and any("8 CNAME hops" in n for n in chain["notes"])


def test_rule5_wildcard(ask):
    res = ask("anything.apps", "A")
    assert res["response_code"] == "NOERROR"
    assert values(res) == [("anything.apps.test.example", "A", "192.0.2.9")]  # queried name, not *.apps
    assert any("*.apps.test.example" in n for n in res["notes"])
    assert ask("two.levels.apps", "A")["answers"][0]["value"] == "192.0.2.9"
    # Wildcard exists but not for this type -> NODATA with SOA
    nodata = ask("anything.apps", "MX")
    assert nodata["response_code"] == "NOERROR" and nodata["answers"] == [] and nodata["authority"][0]["type"] == "SOA"


def test_rule6_nodata(ask):
    res = ask("www", "MX")
    assert res["response_code"] == "NOERROR" and res["answers"] == []
    assert res["authority"][0]["type"] == "SOA" and res["authority"][0]["name"] == "test.example"
    # An empty non-terminal (records only below it) also exists: NODATA, not NXDOMAIN.
    ent = ask("x.y", "A")
    assert ent["response_code"] == "NOERROR" and ent["answers"] == []


def test_rule7_nxdomain(ask):
    res = ask("missing", "A")
    assert res["response_code"] == "NXDOMAIN" and res["answers"] == []
    assert res["authority"][0]["type"] == "SOA"


def test_validation_and_auth(client, auth, zone):
    url = f"/api/hosted-zones/{zone['id']}/test-record"
    assert client.post(url, json={"record_name": "www", "type": "DNAME"}, headers=auth).status_code == 422
    assert client.post(url, json={"record_name": "www"}, headers=auth).status_code == 422
    assert client.post(url, json={"record_name": "www", "type": "A"}).status_code == 401
    assert client.post("/api/hosted-zones/ZNOPE/test-record", json={"type": "A"}, headers=auth).status_code == 404
