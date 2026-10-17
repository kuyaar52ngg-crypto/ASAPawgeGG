from fastapi.testclient import TestClient

from app.main import app


def test_health():
    assert TestClient(app).get("/health").json() == {"status": "ok"}


def test_internal_requires_token():
    r = TestClient(app).post("/internal/jobs/fulfill_order", json={"args": {}})
    assert r.status_code == 401
