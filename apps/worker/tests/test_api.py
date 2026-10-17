from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.main import app, get_pool

AUTH = {"Authorization": "Bearer test-token"}


class FakePool:
    def __init__(self):
        self.jobs: list[tuple] = []
        self.dupe = False

    async def enqueue_job(self, name, *args, **kw):
        self.jobs.append((name, args, kw))
        return None if self.dupe else SimpleNamespace(job_id=kw.get("_job_id") or f"job-{len(self.jobs)}")


@pytest.fixture
def client():
    pool = FakePool()
    app.dependency_overrides[get_pool] = lambda: pool
    c = TestClient(app)
    c.pool = pool  # type: ignore[attr-defined]
    yield c
    app.dependency_overrides.clear()


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_internal_requires_token(client):
    assert client.post("/internal/jobs/fulfill_order", json={"args": {}}).status_code == 401
    assert client.post("/internal/jobs/fulfill_order", json={"args": {"orderId": "o1"}}, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.post("/internal/steam/check-login", json={"login": "abc"}).status_code == 401
    assert client.pool.jobs == []


def test_enqueue_with_bearer_and_x_internal_token(client):
    r = client.post("/internal/jobs/fulfill_order", json={"args": {"orderId": "o1"}}, headers=AUTH)
    assert r.status_code == 202 and r.json()["ok"] is True and r.json()["jobId"] == "fulfill_order:o1"
    r = client.post("/internal/jobs/ai_moderate_product", json={"args": {"productId": "p1"}}, headers={"X-Internal-Token": "test-token"})
    assert r.status_code == 202
    name, args, kw = client.pool.jobs[0]
    assert (name, args, kw["_job_id"]) == ("fulfill_order", ({"orderId": "o1"},), "fulfill_order:o1")


def test_delay_is_passed_as_defer(client):
    client.post("/internal/jobs/release_holds", json={"args": {}, "delaySeconds": 30}, headers=AUTH)
    assert client.pool.jobs[0][2]["_defer_by"] == timedelta(seconds=30)


def test_duplicate_fulfill_is_reported_not_errored(client):
    client.pool.dupe = True
    r = client.post("/internal/jobs/fulfill_order", json={"args": {"orderId": "o1"}}, headers=AUTH)
    assert r.status_code == 202 and r.json()["duplicate"] is True


def test_unknown_job_404_and_bad_args_422(client):
    assert client.post("/internal/jobs/hack_the_planet", json={"args": {}}, headers=AUTH).status_code == 404
    assert client.post("/internal/jobs/fulfill_order", json={"args": {}}, headers=AUTH).status_code == 422
    assert client.post("/internal/jobs/send_notification", json={"args": {"userId": "u", "type": "NOPE", "title": "x"}}, headers=AUTH).status_code == 422
    assert client.post("/internal/jobs/aggregate_daily_metrics", json={"args": {"date": "yesterday"}}, headers=AUTH).status_code == 422
    assert client.pool.jobs == []


def test_every_contract_job_is_accepted(client):
    contract = {
        "fulfill_order": {"orderId": "o"}, "release_holds": {}, "expire_reservations": {}, "expire_pending_orders": {}, "ai_moderate_product": {"productId": "p"},
        "ai_moderate_review": {"reviewId": "r"}, "ai_score_fraud": {"orderId": "o"}, "aggregate_daily_metrics": {"date": "2026-10-16"},
        "send_notification": {"userId": "u", "type": "SYSTEM", "title": "t"}, "ai_dispute_suggestion": {"disputeId": "d"}, "ai_fraud_score_order": {"orderId": "o"},
    }
    for name, args in contract.items():
        name = name.strip()
        assert client.post(f"/internal/jobs/{name}", json={"args": args}, headers=AUTH).status_code == 202, name


def test_steam_check_login_endpoint(client):
    ok = client.post("/internal/steam/check-login", json={"login": "gamer_01"}, headers=AUTH).json()
    assert ok["ok"] is True and ok["source"] == "mock"
    bad = client.post("/internal/steam/check-login", json={"login": "nouser1"}, headers=AUTH).json()
    assert bad["ok"] is False and bad["reason"]


def test_worker_registry_matches_api_jobs():
    """Every job the API accepts must be registered in arq (and vice versa), otherwise jobs would be queued and never run."""
    from app.job_names import JOB_NAMES
    from app.worker import WorkerSettings

    registered = {f.name for f in WorkerSettings.functions if hasattr(f, "name")} | {f.__name__ for f in WorkerSettings.functions if not hasattr(f, "name")}
    assert JOB_NAMES - registered == set()
    assert {"fulfill_order", "release_holds", "expire_reservations", "aggregate_daily_metrics"} <= {c.name.split(":")[-1] for c in WorkerSettings.cron_jobs} | registered
