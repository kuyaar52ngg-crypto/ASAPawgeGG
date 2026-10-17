"""Housekeeping crons: expire_reservations, expire_pending_orders, sweep_stuck_paid_orders (docs/CONTRACTS.md §7, §10)."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import SessionFactory, session_scope
from ..models import Order
from ..util import utcnow
from .fulfill import fulfill_order_impl

log = logging.getLogger("worker.maintenance")


async def release_expired_reservations(session: AsyncSession, now: datetime | None = None) -> int:
    """Free RESERVED stock whose reservation expired and whose order is not paid (PENDING/CANCELLED/FAILED) or that has no order."""
    res = await session.execute(
        text(
            """
            UPDATE "StockItem" s SET status = 'AVAILABLE', "reservedUntil" = NULL, "orderItemId" = NULL
            WHERE s.status = 'RESERVED' AND s."reservedUntil" IS NOT NULL AND s."reservedUntil" < :now
              AND (s."orderItemId" IS NULL OR NOT EXISTS (
                SELECT 1 FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
                WHERE oi.id = s."orderItemId" AND o.status NOT IN ('PENDING', 'CANCELLED', 'FAILED')))
            """
        ),
        {"now": now or utcnow()},
    )
    return res.rowcount or 0


async def cancel_order_if_unpaid(session: AsyncSession, order_id: str, now: datetime) -> bool:
    """PENDING -> CANCELLED (compare-and-set under the Order row lock), frees stock, cancels open payments."""
    order = (await session.execute(select(Order).where(Order.id == order_id).with_for_update())).scalar_one_or_none()
    if order is None or order.status != "PENDING":
        return False
    res = await session.execute(
        text('UPDATE "Order" SET status = \'CANCELLED\', "cancelledAt" = :now, "updatedAt" = :now WHERE id = :id AND status = \'PENDING\''),
        {"id": order_id, "now": now},
    )
    if res.rowcount != 1:
        return False
    await session.execute(
        text(
            """
            UPDATE "StockItem" SET status = 'AVAILABLE', "reservedUntil" = NULL, "orderItemId" = NULL
            WHERE status = 'RESERVED' AND "orderItemId" IN (SELECT id FROM "OrderItem" WHERE "orderId" = :id)
            """
        ),
        {"id": order_id},
    )
    await session.execute(
        text(
            """UPDATE "Payment" SET status = 'CANCELLED', "updatedAt" = :now
               WHERE "orderId" = :id AND status IN ('CREATED', 'PENDING')"""
        ),
        {"id": order_id, "now": now},
    )
    return True


async def expire_pending_orders_impl(factory: SessionFactory, *, older_than_minutes: int | None = None, now: datetime | None = None, limit: int = 500) -> int:
    """Cancel PENDING orders older than the TTL (30 min). Returns the number cancelled."""
    now = now or utcnow()
    ttl = older_than_minutes if older_than_minutes is not None else get_settings().pending_order_ttl_minutes
    cutoff = now - timedelta(minutes=ttl)
    async with factory() as s:
        ids = [r[0] for r in await s.execute(select(Order.id).where(Order.status == "PENDING", Order.createdAt < cutoff).order_by(Order.createdAt).limit(limit))]
    cancelled = 0
    for order_id in ids:
        try:
            async with session_scope(factory) as s:
                if await cancel_order_if_unpaid(s, order_id, now):
                    cancelled += 1
        except Exception:  # noqa: BLE001
            log.exception("expire_pending_orders: order %s failed", order_id)
    return cancelled


async def expire_reservations_impl(factory: SessionFactory, *, now: datetime | None = None) -> dict[str, int]:
    """Cron (every 5 min): cancel unpaid orders past the TTL, then free every expired reservation."""
    now = now or utcnow()
    cancelled = await expire_pending_orders_impl(factory, now=now)
    async with session_scope(factory) as s:
        released = await release_expired_reservations(s, now)
    return {"cancelledOrders": cancelled, "releasedReservations": released}


async def sweep_stuck_paid_orders_impl(factory: SessionFactory, *, redis: Any | None = None, now: datetime | None = None, limit: int = 100) -> int:
    """Safety net for lost `fulfill_order` jobs: PAID orders older than the grace period (and PROCESSING orders with supplier items
    that no worker run has started yet) are fulfilled in-process. Idempotent; returns the number of orders handled."""
    now = now or utcnow()
    cutoff = now - timedelta(seconds=get_settings().stuck_paid_grace_seconds)
    async with factory() as s:
        rows = await s.execute(
            text(
                """
                SELECT o.id FROM "Order" o
                WHERE (o.status = 'PAID' AND o."paidAt" < :cutoff)
                   OR (o.status = 'PROCESSING' AND o."updatedAt" < :cutoff AND EXISTS (
                        SELECT 1 FROM "OrderItem" oi JOIN "Product" p ON p.id = oi."productId"
                        WHERE oi."orderId" = o.id AND p."deliveryMode" = 'AUTO_PROVIDER'
                          AND oi.status IN ('PENDING', 'PROCESSING') AND oi."deliveryData" IS NULL))
                ORDER BY o."paidAt" LIMIT :limit
                """
            ),
            {"cutoff": cutoff, "limit": limit},
        )
        ids = [r[0] for r in rows]
    handled = 0
    for order_id in ids:
        try:
            out = await fulfill_order_impl(factory, order_id, redis=redis)
            if not out.skipped:
                handled += 1
        except Exception:  # noqa: BLE001
            log.exception("sweep_stuck_paid_orders: order %s failed", order_id)
    return handled
