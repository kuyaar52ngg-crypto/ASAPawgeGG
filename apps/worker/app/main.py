"""FastAPI entrypoint of the worker.

Zone E (worker) owns this app. Foundation provides only the contract skeleton:
  GET  /health
  POST /internal/jobs/{name}   Authorization: Bearer $WORKER_INTERNAL_TOKEN   body {"args": {...}, "delaySeconds": 0}
See docs/CONTRACTS.md ("Web <-> worker contract").
"""
from __future__ import annotations

import hmac
from typing import Any

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .config import get_settings

JOB_NAMES = {
    "fulfill_order",
    "release_holds",
    "ai_moderate_product",
    "ai_moderate_review",
    "ai_score_fraud",
    "aggregate_daily_metrics",
    "expire_reservations",
    "expire_pending_orders",
    "send_notification",
}

app = FastAPI(title="ASAPawge worker", version="0.1.0")
_pool: ArqRedis | None = None


async def get_pool() -> ArqRedis:
    global _pool
    if _pool is None:
        _pool = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
    return _pool


def require_token(authorization: str | None = Header(default=None)) -> None:
    expected = get_settings().worker_internal_token
    supplied = (authorization or "").removeprefix("Bearer ").strip()
    if not expected or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="invalid token")


class JobRequest(BaseModel):
    args: dict[str, Any] = Field(default_factory=dict)
    delaySeconds: float | None = None


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/internal/jobs/{name}", dependencies=[Depends(require_token)], status_code=202)
async def enqueue(name: str, body: JobRequest, pool: ArqRedis = Depends(get_pool)) -> dict[str, Any]:
    if name not in JOB_NAMES:
        raise HTTPException(status_code=404, detail=f"unknown job {name}")
    from datetime import timedelta

    job = await pool.enqueue_job(name, body.args, _defer_by=timedelta(seconds=body.delaySeconds) if body.delaySeconds else None)
    return {"ok": True, "jobId": job.job_id if job else None}
