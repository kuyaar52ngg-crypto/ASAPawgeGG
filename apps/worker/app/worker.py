"""arq worker entrypoint:  arq app.worker.WorkerSettings

Zone E (worker) owns this module and replaces the placeholder job bodies with real implementations
(fulfill_order, release_holds, ai_moderate_product, aggregate_daily_metrics, ...).
Jobs receive the `args` dict sent by web (see docs/CONTRACTS.md) as their single positional argument.
"""
from __future__ import annotations

import logging
from typing import Any

from arq.connections import RedisSettings
from arq.cron import cron

from .config import get_settings

log = logging.getLogger("worker")


def _placeholder(name: str):
    async def job(ctx: dict[str, Any], args: dict[str, Any] | None = None) -> dict[str, Any]:
        log.info("job %s received args=%s (placeholder implementation)", name, args)
        return {"job": name, "placeholder": True, "args": args or {}}

    job.__name__ = name
    job.__qualname__ = name
    return job


fulfill_order = _placeholder("fulfill_order")
release_holds = _placeholder("release_holds")
ai_moderate_product = _placeholder("ai_moderate_product")
ai_moderate_review = _placeholder("ai_moderate_review")
ai_score_fraud = _placeholder("ai_score_fraud")
aggregate_daily_metrics = _placeholder("aggregate_daily_metrics")
expire_reservations = _placeholder("expire_reservations")
expire_pending_orders = _placeholder("expire_pending_orders")
send_notification = _placeholder("send_notification")


class WorkerSettings:
    functions = [
        fulfill_order,
        release_holds,
        ai_moderate_product,
        ai_moderate_review,
        ai_score_fraud,
        aggregate_daily_metrics,
        expire_reservations,
        expire_pending_orders,
        send_notification,
    ]
    cron_jobs = [
        cron(release_holds, minute={0, 15, 30, 45}, run_at_startup=False),
        cron(expire_reservations, minute={5, 20, 35, 50}),
        cron(expire_pending_orders, minute={10, 40}),
        cron(aggregate_daily_metrics, hour={0}, minute={5}),
    ]
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    max_jobs = 20
    job_timeout = 120
    keep_result = 3600
