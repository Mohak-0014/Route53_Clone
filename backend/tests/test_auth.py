def test_login_session_logout(client, auth):
    r = client.get("/api/auth/session", headers=auth)
    assert r.status_code == 200
    assert r.json()["user"]["username"] == "demo"

    assert client.post("/api/auth/logout", headers=auth).status_code == 204
    r = client.get("/api/auth/session", headers=auth)
    assert r.status_code == 401
    assert r.json()["code"] == "Unauthenticated"


def test_bad_credentials(client):
    for body in (
        {"account_id": "123456789012", "username": "demo", "password": "wrong"},
        {"account_id": "999999999999", "username": "demo", "password": "demo1234"},
        {"account_id": "123456789012", "username": "nobody", "password": "demo1234"},
    ):
        r = client.post("/api/auth/login", json=body)
        assert r.status_code == 401
        assert r.json()["code"] == "InvalidCredentials"


def test_login_validation(client):
    r = client.post("/api/auth/login", json={"username": "demo"})
    assert r.status_code == 422
    assert r.json()["code"] == "InvalidInput"


def test_protected_routes_require_token(client):
    assert client.get("/api/hosted-zones").status_code == 401
    r = client.get("/api/hosted-zones", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401
