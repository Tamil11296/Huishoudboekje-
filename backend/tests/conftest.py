import os
import sys
from pathlib import Path

# Tests draaien tegen een nep-database in het geheugen, zonder Google of internet.
os.environ["USE_MONGOMOCK"] = "1"
os.environ["JWT_SECRET"] = "test-secret-" + "x" * 40
os.environ["GOOGLE_CLIENT_ID"] = "test-client"
os.environ["ALLOWED_EMAILS"] = "owner@example.com"
os.environ["COOKIE_SECURE"] = "false"
os.environ["STATIC_DIR"] = "/nonexistent"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import auth  # noqa: E402
import deps  # noqa: E402
import server  # noqa: E402


def fake_verify(credential: str) -> dict:
    # In tests is de "credential" gewoon het e-mailadres.
    return {"email": credential, "email_verified": True, "name": credential.split("@")[0], "sub": credential}


@pytest.fixture(autouse=True)
def _fresh_db(monkeypatch):
    monkeypatch.setattr(auth, "verify_google_credential", fake_verify)
    from mongomock_motor import AsyncMongoMockClient
    new = AsyncMongoMockClient()["test"]
    for mod in (deps, auth, server, __import__("storage")):
        monkeypatch.setattr(mod, "db", new, raising=False)
    yield


def login(email: str) -> TestClient:
    c = TestClient(server.app)
    r = c.post("/api/auth/google", json={"credential": email})
    assert r.status_code == 200, r.text
    return c


@pytest.fixture
def owner():
    c = login("owner@example.com")
    hid = c.post("/api/households", json={"name": "Thuis", "split_rule": "income"}).json()["household_id"]
    c.hid = hid
    return c
