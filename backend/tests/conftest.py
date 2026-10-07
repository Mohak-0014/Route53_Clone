import os
import tempfile

import pytest

# Point the app at a throwaway database before any app module is imported.
_tmpdir = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmpdir}/test.db"
os.environ["SEED_DEMO_DATA"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import init_db  # noqa: E402


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=engine)
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
