"""`sync_pending_payments` — safety net for lost payment webhooks.

Provider-specific polling (Platega / RollyPay `getStatus` -> `markPaid`) lives in the web app where the gateway adapters and the
ledger/`markPaid` pipeline are implemented (`server/payments/reconcile.ts`); duplicating that in Python would fork the money logic.
So this job (1) asks web to run its housekeeping endpoint over real HTTP (`POST {WEB_INTERNAL_URL}/api/payments/maintenance`,
Bearer WORKER_INTERNAL_TOKEN) and (2) cleans up payment rows that can never complete (their order is gone/cancelled, or they are
older than 24h). It never marks a payment PAID.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import text

from ..config import get_settings
from ..db import SessionFactory, session_scope
from ..util import utcnow

log = logging.getLogger("worker.payments")


async def call_web_maintenance(client: httpx.AsyncClient | None = None) -> dict[str, Any]:
    s = get_settings()
    if not s.worker_internal_token:
        return {"ok": False, "error": "WORKER_INTERNAL_TOKEN not set"}
    url = f"{s.web_internal_url.rstrip('/')}/api/payments/maintenance"
    try:
        if client is not None:
            res = await client.post(url, headers={"authorization": f"Bearer {s.worker_internal_token}"}, timeout=30)
        else:
            async with httpx.AsyncClient() as c:
                res = await c.post(url, headers={"authorization": f"Bearer {s.worker_internal_token}"}, timeout=30)
        if res.status_code != 200:
            return {"ok": False, "error": f"web responded {res.status_code}"}
        return {"ok": True, **(res.json().get("data") or {})}
    except (httpx.HTTPError, ValueError) as exc:
        return {"ok": False, "error": f"web unreachable: {exc.__class__.__name__}"}


async def sync_pending_payments_impl(factory: SessionFactory, *, now: datetime | None = None, client: httpx.AsyncClient | None = None) -> dict[str, Any]:
    now = now or utcnow()
    web = await call_web_maintenance(client)
    async with session_scope(factory) as s:
        # payments whose order was cancelled/failed/refunded can never be paid any more
        dead = await s.execute(
            text(
                """UPDATE "Payment" p SET status = 'CANCELLED', "updatedAt" = :now
                   FROM "Order" o WHERE p."orderId" = o.id AND p.status IN ('CREATED', 'PENDING')
                     AND o.status IN ('CANCELLED', 'FAILED', 'REFUNDED')"""
            ),
            {"now": now},
        )
        old = await s.execute(
            text(
                """UPDATE "Payment" SET status = 'EXPIRED', "updatedAt" = :now
                   WHERE status IN ('CREATED', 'PENDING') AND "createdAt" < :cutoff"""
            ),
            {"now": now, "cutoff": now - timedelta(hours=24)},
        )
    return {"web": web, "cancelledPayments": dead.rowcount or 0, "expiredPayments": old.rowcount or 0}
