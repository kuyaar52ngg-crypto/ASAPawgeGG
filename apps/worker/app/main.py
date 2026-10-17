"""FastAPI entrypoint of the worker (docs/CONTRACTS.md §10).

  GET  /health                           liveness
  GET  /health/deep                      DB + Redis reachability (token-protected)
  POST /internal/jobs/{name}             enqueue an arq job.  Auth: `Authorization: Bearer $WORKER_INTERNAL_TOKEN` (or `X-Internal-Token`)
                                         body {"args": {...}, "delaySeconds": 0}  ->  202 {"ok": true, "jobId": "..."}
  POST /internal/steam/check-login       {"login": "..."} -> supplier login check for the Steam calculator (same auth)

The queue consumer is a separate process:  arq app.worker.WorkerSettings
"""
from __future__ import annotations

import hmac
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import Any

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import text

from .config import get_settings
from .db import dispose_engine, get_engine
from .job_names import JOB_ARGS, JOB_NAMES
from .providers import ProviderError, get_topup_provider

__all__ = ["JOB_NAMES", "app"]

_pool: ArqRedis | None = None


async def get_pool() -> ArqRedis:
    global _pool
    if _pool is None:
        _pool = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
    return _pool


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None
    await dispose_engine()


app = FastAPI(title="ASAPawge worker", version="1.0.0", lifespan=lifespan)


def require_token(authorization: str | None = Header(default=None), x_internal_token: str | None = Header(default=None)) -> None:
    expected = get_settings().worker_internal_token
    supplied = (x_internal_token or (authorization or "").removeprefix("Bearer ")).strip()
    if not expected or not hmac.compare_digest(supplied.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="invalid token")


class JobRequest(BaseModel):
    args: dict[str, Any] = Field(default_factory=dict)
    delaySeconds: float | None = Field(default=None, ge=0, le=7 * 86400)


class CheckLoginRequest(BaseModel):
    login: str = Field(min_length=1, max_length=128)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/deep", dependencies=[Depends(require_token)])
async def health_deep(pool: ArqRedis = Depends(get_pool)) -> dict[str, Any]:
    async with get_engine().connect() as conn:
        await conn.execute(text("SELECT 1"))
    await pool.ping()
    return {"status": "ok", "db": "ok", "redis": "ok", "steamProvider": get_topup_provider().name}


@app.post("/internal/jobs/{name}", dependencies=[Depends(require_token)], status_code=202)
async def enqueue(name: str, body: JobRequest, pool: ArqRedis = Depends(get_pool)) -> dict[str, Any]:
    schema = JOB_ARGS.get(name)
    if schema is None:
        raise HTTPException(status_code=404, detail=f"unknown job {name}")
    try:
        schema.model_validate(body.args)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_url=False, include_context=False, include_input=False)) from exc
    kwargs: dict[str, Any] = {}
    if body.delaySeconds:
        kwargs["_defer_by"] = timedelta(seconds=body.delaySeconds)
    if name == "fulfill_order":  # collapse duplicate triggers (webhook retry + sweep) for the same order while one is queued/running
        kwargs["_job_id"] = f"fulfill_order:{body.args['orderId']}"
    job = await pool.enqueue_job(name, body.args, **kwargs)
    return {"ok": True, "jobId": job.job_id if job else kwargs.get("_job_id"), "duplicate": job is None}


@app.post("/internal/steam/check-login", dependencies=[Depends(require_token)])
async def steam_check_login(body: CheckLoginRequest) -> dict[str, Any]:
    provider = get_topup_provider()
    try:
        res = await provider.check_login(body.login.strip())
    except ProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"ok": res.ok, "displayName": res.display_name, "reason": res.reason, "source": res.source}
