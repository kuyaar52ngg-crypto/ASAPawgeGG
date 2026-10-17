"""`aggregate_daily_metrics` — upsert one `DailyMetric` row per UTC day (definitions: docs/CONTRACTS.md §14)."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import SessionFactory, session_scope
from ..models import DailyMetric
from ..util import utcnow

log = logging.getLogger("worker.metrics")

INT_MAX = 2_147_483_647
EXCLUDED = "('PENDING','CANCELLED','FAILED','REFUNDED')"
FUNNEL_EVENTS = ("page_view", "view_item", "add_to_cart", "begin_checkout", "purchase")


def _i(v: Any) -> int:
    return min(int(v or 0), INT_MAX)


async def compute_day(session: AsyncSession, day: date) -> dict[str, Any]:
    start = datetime(day.year, day.month, day.day)
    end = start + timedelta(days=1)
    p = {"s": start, "e": end}

    paid = (
        await session.execute(
            text(f'SELECT COUNT(*), COALESCE(SUM(total), 0) FROM "Order" WHERE "paidAt" >= :s AND "paidAt" < :e AND status NOT IN {EXCLUDED}'), p
        )
    ).one()
    orders_paid, gmv = int(paid[0]), int(paid[1])

    revenue = (
        await session.execute(
            text(
                f"""SELECT COALESCE(SUM(oi."commissionAmount"), 0) FROM "Order" o JOIN "OrderItem" oi ON oi."orderId" = o.id
                    WHERE o."paidAt" >= :s AND o."paidAt" < :e AND o.status NOT IN {EXCLUDED} AND oi.status <> 'REFUNDED'"""
            ),
            p,
        )
    ).scalar_one()

    created = (await session.execute(text('SELECT COUNT(*) FROM "Order" WHERE "createdAt" >= :s AND "createdAt" < :e'), p)).scalar_one()
    new_users = (await session.execute(text('SELECT COUNT(*) FROM "User" WHERE "createdAt" >= :s AND "createdAt" < :e'), p)).scalar_one()
    sessions = (
        await session.execute(text('SELECT COUNT(DISTINCT "sessionId") FROM "AnalyticsEvent" WHERE "createdAt" >= :s AND "createdAt" < :e AND "sessionId" IS NOT NULL'), p)
    ).scalar_one()
    active = (
        await session.execute(
            text(
                """SELECT COUNT(*) FROM (
                     SELECT COALESCE("userId", "sessionId") AS k FROM "AnalyticsEvent"
                       WHERE "createdAt" >= :s AND "createdAt" < :e AND COALESCE("userId", "sessionId") IS NOT NULL
                     UNION
                     SELECT "buyerId" FROM "Order" WHERE "createdAt" >= :s AND "createdAt" < :e
                   ) t"""
            ),
            p,
        )
    ).scalar_one()
    refunds = (
        await session.execute(
            text(
                """SELECT COALESCE(SUM(oi.total), 0) FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
                   WHERE oi.status = 'REFUNDED' AND o."paidAt" >= :s AND o."paidAt" < :e"""
            ),
            p,
        )
    ).scalar_one()

    ev_rows = await session.execute(
        text('SELECT name, COUNT(*) FROM "AnalyticsEvent" WHERE "createdAt" >= :s AND "createdAt" < :e AND name = ANY(:names) GROUP BY name'),
        {**p, "names": list(FUNNEL_EVENTS)},
    )
    funnel = {name: int(c) for name, c in ev_rows}

    top_products = [
        {"productId": r[0], "title": r[1], "revenue": int(r[2]), "qty": int(r[3])}
        for r in await session.execute(
            text(
                f"""SELECT p.id, p.title, SUM(oi.total) AS revenue, SUM(oi.quantity) AS qty
                    FROM "Order" o JOIN "OrderItem" oi ON oi."orderId" = o.id JOIN "Product" p ON p.id = oi."productId"
                    WHERE o."paidAt" >= :s AND o."paidAt" < :e AND o.status NOT IN {EXCLUDED} AND oi.status <> 'REFUNDED'
                    GROUP BY p.id, p.title ORDER BY revenue DESC, p.id LIMIT 5"""
            ),
            p,
        )
    ]
    top_sellers = [
        {"sellerId": r[0], "shopName": r[1], "revenue": int(r[2]), "orders": int(r[3])}
        for r in await session.execute(
            text(
                f"""SELECT oi."sellerId", COALESCE(sp."shopName", u.name, u.email) AS shop, SUM(oi.total) AS revenue, COUNT(DISTINCT o.id) AS orders
                    FROM "Order" o JOIN "OrderItem" oi ON oi."orderId" = o.id JOIN "User" u ON u.id = oi."sellerId"
                    LEFT JOIN "SellerProfile" sp ON sp."userId" = u.id
                    WHERE o."paidAt" >= :s AND o."paidAt" < :e AND o.status NOT IN {EXCLUDED} AND oi.status <> 'REFUNDED'
                    GROUP BY oi."sellerId", shop ORDER BY revenue DESC, oi."sellerId" LIMIT 5"""
            ),
            p,
        )
    ]

    return {
        "date": day,
        "gmv": _i(gmv),
        "platformRevenue": _i(revenue),
        "ordersCreated": _i(created),
        "ordersPaid": _i(orders_paid),
        "newUsers": _i(new_users),
        "activeUsers": _i(active),
        "sessions": _i(sessions),
        "refunds": _i(refunds),
        "avgOrderValue": _i(round(gmv / orders_paid)) if orders_paid else 0,
        "data": {"funnel": funnel, "topProducts": top_products, "topSellers": top_sellers},
    }


async def upsert_day(session: AsyncSession, metrics: dict[str, Any]) -> None:
    now = utcnow()
    stmt = pg_insert(DailyMetric).values(**metrics, createdAt=now, updatedAt=now)
    update_cols = {k: stmt.excluded[k] for k in metrics if k != "date"}
    update_cols["updatedAt"] = now
    await session.execute(stmt.on_conflict_do_update(index_elements=[DailyMetric.date], set_=update_cols))


def parse_day(value: str | date) -> date:
    return value if isinstance(value, date) else date.fromisoformat(str(value)[:10])


async def aggregate_daily_metrics_impl(factory: SessionFactory, *, days: list[date] | None = None, today: date | None = None) -> list[str]:
    """Default: yesterday + today (UTC). Explicit `days` (from the `date` job arg) recompute those days only."""
    today = today or utcnow().date()
    targets = days or [today - timedelta(days=1), today]
    done: list[str] = []
    for day in targets:
        async with session_scope(factory) as s:
            await upsert_day(s, await compute_day(s, day))
        done.append(day.isoformat())
    return done
