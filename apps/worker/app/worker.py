"""arq worker entrypoint:  arq app.worker.WorkerSettings

Jobs receive the `args` dict sent by web (docs/CONTRACTS.md §10) as their single positional argument; cron jobs get none.
Business logic lives in `app.jobs.*` (pure `*_impl(factory, ...)` functions, unit-tested against a real PostgreSQL).
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any

from arq import Retry, func
from arq.connections import RedisSettings
from arq.cron import cron

from .config import get_settings
from .db import SessionFactory, dispose_engine, get_session_factory
from .job_names import (
    DisputeArgs,
    MetricsArgs,
    OrderArgs,
    ProductArgs,
    ReviewArgs,
)
from .jobs.ai_jobs import ai_dispute_suggestion_impl, ai_moderate_product_impl, ai_moderate_review_impl, ai_score_fraud_impl
from .jobs.fulfill import fulfill_order_impl
from .jobs.holds import release_holds_impl
from .jobs.maintenance import expire_pending_orders_impl, expire_reservations_impl, sweep_stuck_paid_orders_impl
from .jobs.metrics import aggregate_daily_metrics_impl, parse_day
from .jobs.misc import SendNotificationArgs, send_notification_impl
from .jobs.payments_sync import sync_pending_payments_impl

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("worker")


def _db(ctx: dict[str, Any]) -> SessionFactory:
    return ctx["db"]


async def startup(ctx: dict[str, Any]) -> None:
    ctx["db"] = get_session_factory()
    log.info("worker started (steam provider=%s, ai provider=%s)", get_settings().steam_topup_provider, get_settings().ai_provider)


async def shutdown(ctx: dict[str, Any]) -> None:
    await dispose_engine()


# ───────────────────────── queue-triggered jobs ─────────────────────────


async def fulfill_order(ctx: dict[str, Any], args: dict[str, Any] | None = None) -> dict[str, Any]:
    order_id = OrderArgs.model_validate(args or {}).orderId
    settings = get_settings()
    attempt = int(ctx.get("job_try", 1))
    out = await fulfill_order_impl(_db(ctx), order_id, redis=ctx.get("redis"), attempt=attempt, max_attempts=settings.fulfill_max_tries)
    if out.retry_in is not None:
        log.info("fulfill_order %s: supplier not done, retry in %ss (try %s)", order_id, out.retry_in, attempt)
        raise Retry(defer=out.retry_in)
    return out.as_dict()


async def ai_moderate_product(ctx: dict[str, Any], args: dict[str, Any] | None = None) -> dict[str, Any]:
    return await ai_moderate_product_impl(_db(ctx), ProductArgs.model_validate(args or {}).productId)


async def ai_moderate_review(ctx: dict[str, Any], args: dict[str, Any] | None = None) -> dict[str, Any]:
    return await ai_moderate_review_impl(_db(ctx), ReviewArgs.model_validate(args or {}).reviewId)


async def ai_score_fraud(ctx: dict[str, Any], args: dict[str, Any] | None = None) -> dict[str, Any]:
    return await ai_score_fraud_impl(_db(ctx), OrderArgs.model_validate(args or {}).orderId)


async def ai_dispute_suggestion(ctx: dict[str, Any], args: dict[str, Any] | None = None) -> dict[str, Any]:
    return await ai_dispute_suggestion_impl(_db(ctx), DisputeArgs.model_validate(args or {}).disputeId)


async def send_notification(ctx: dict[str, Any], args: dict[str, Any] | None = None) -> dict[str, Any]:
    return await send_notification_impl(_db(ctx), SendNotificationArgs.model_validate(args or {}))


# ───────────────────────── queue + cron jobs ─────────────────────────


async def release_holds(ctx: dict[str, Any], args: dict[str, Any] | None = None) -> dict[str, Any]:
    res = await release_holds_impl(_db(ctx))
    if res.released or res.errors:
        log.info("release_holds: %s", res.as_dict())
    return res.as_dict()


async def expire_reservations(ctx: dict[str, Any], args: dict[str, Any] | None = None) -> dict[str, Any]:
    return await expire_reservations_impl(_db(ctx))


async def expire_pending_orders(ctx: dict[str, Any], args: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"cancelledOrders": await expire_pending_orders_impl(_db(ctx))}


async def aggregate_daily_metrics(ctx: dict[str, Any], args: dict[str, Any] | None = None) -> dict[str, Any]:
    day = MetricsArgs.model_validate(args or {}).date
    days: list[date] | None = [parse_day(day)] if day else None
    return {"days": await aggregate_daily_metrics_impl(_db(ctx), days=days)}


async def sweep_stuck_paid_orders(ctx: dict[str, Any], args: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"fulfilled": await sweep_stuck_paid_orders_impl(_db(ctx), redis=ctx.get("redis"))}


async def sync_pending_payments(ctx: dict[str, Any], args: dict[str, Any] | None = None) -> dict[str, Any]:
    return await sync_pending_payments_impl(_db(ctx))


class WorkerSettings:
    functions = [
        func(fulfill_order, max_tries=get_settings().fulfill_max_tries, timeout=180),
        func(ai_moderate_product, max_tries=3, timeout=180),
        func(ai_moderate_review, max_tries=3, timeout=120),
        func(ai_score_fraud, max_tries=3, timeout=120),
        func(ai_score_fraud, name="ai_fraud_score_order", max_tries=3, timeout=120),
        func(ai_dispute_suggestion, max_tries=3, timeout=180),
        func(send_notification, max_tries=3),
        release_holds,
        expire_reservations,
        expire_pending_orders,
        aggregate_daily_metrics,
        sweep_stuck_paid_orders,
        sync_pending_payments,
    ]
    cron_jobs = [
        cron(release_holds, minute={0, 10, 20, 30, 40, 50}, timeout=300, max_tries=1),
        cron(expire_reservations, minute=set(range(2, 60, 5)), timeout=120, max_tries=1),
        cron(aggregate_daily_metrics, minute={5}, run_at_startup=True, timeout=300, max_tries=1),
        cron(sweep_stuck_paid_orders, minute=set(range(1, 60, 2)), timeout=300, max_tries=1),
        cron(sync_pending_payments, minute=set(range(3, 60, 5)), timeout=120, max_tries=1),
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    max_jobs = 20
    job_timeout = 120
    keep_result = 30
    health_check_interval = 30
