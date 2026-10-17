"""`release_holds` — SELLER_HOLD -> SELLER_AVAILABLE once an item's hold period is over (docs/CONTRACTS.md §8, kind HOLD_RELEASE).

Eligible item: status DELIVERED, holdReleased = false, holdReleaseAt <= now, order not DISPUTED/REFUNDED and no active dispute on
the item. One transaction per item (a bad row never blocks the others), `FOR UPDATE SKIP LOCKED`, and an idempotency guard: if a
HOLD_RELEASE posting already exists for the item only the flag is set — the ledger is never posted twice.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from ..db import SessionFactory, session_scope
from ..ledger import has_posting, hold_release_lines, post_ledger, purchase_posted
from ..models import Order, OrderItem
from ..notifications import notify
from ..util import utcnow

log = logging.getLogger("worker.holds")

_ACTIVE_DISPUTE = "('OPEN','SELLER_REPLIED','ESCALATED')"


@dataclass
class HoldReleaseResult:
    released: int = 0
    skipped: int = 0
    errors: int = 0
    amount: int = 0
    per_seller: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def as_dict(self) -> dict:
        return {"released": self.released, "skipped": self.skipped, "errors": self.errors, "amount": self.amount}


async def _candidates(session: AsyncSession, now: datetime, limit: int) -> list[str]:
    rows = await session.execute(
        text(
            f"""
            SELECT oi.id FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
            WHERE oi.status = 'DELIVERED' AND oi."holdReleased" = false AND oi."holdReleaseAt" <= :now
              AND o.status NOT IN ('DISPUTED', 'REFUNDED')
              AND NOT EXISTS (
                SELECT 1 FROM "Dispute" d
                WHERE d."orderId" = o.id AND (d."orderItemId" IS NULL OR d."orderItemId" = oi.id) AND d.status IN {_ACTIVE_DISPUTE}
              )
            ORDER BY oi."holdReleaseAt", oi.id
            LIMIT :limit
            """
        ),
        {"now": now, "limit": limit},
    )
    return [r[0] for r in rows]


async def _release_one(session: AsyncSession, item_id: str, now: datetime, res: HoldReleaseResult) -> None:
    item = (
        await session.execute(
            select(OrderItem).where(OrderItem.id == item_id).options(joinedload(OrderItem.order)).with_for_update(skip_locked=True, of=OrderItem)
        )
    ).scalar_one_or_none()
    if item is None:  # locked by someone else (refund, dispute...) — next run
        res.skipped += 1
        return
    order: Order = item.order
    if item.status != "DELIVERED" or item.holdReleased or item.holdReleaseAt is None or item.holdReleaseAt > now or order.status in ("DISPUTED", "REFUNDED"):
        res.skipped += 1
        return
    if await has_posting(session, kind="HOLD_RELEASE", order_item_id=item.id):
        item.holdReleased = True  # posting exists already (idempotent re-run / crash between steps)
        res.skipped += 1
        return
    if not await purchase_posted(session, order_id=item.orderId, order_item_id=item.id):
        log.warning("item %s has no PURCHASE posting; hold cannot be released", item.id)
        res.skipped += 1
        return
    lines = hold_release_lines(item.sellerId, item.sellerEarning)
    await post_ledger(session, kind="HOLD_RELEASE", lines=lines, order_id=item.orderId, order_item_id=item.id, memo=f"Холд снят: {item.title}"[:200])
    item.holdReleased = True
    res.released += 1
    res.amount += item.sellerEarning
    res.per_seller[item.sellerId] += item.sellerEarning


async def release_holds_impl(factory: SessionFactory, *, now: datetime | None = None, batch: int = 500) -> HoldReleaseResult:
    now = now or utcnow()
    res = HoldReleaseResult()
    async with factory() as s:
        ids = await _candidates(s, now, batch)
    for item_id in ids:
        try:
            async with session_scope(factory) as s:
                await _release_one(s, item_id, now, res)
        except Exception:  # noqa: BLE001
            res.errors += 1
            log.exception("release_holds: item %s failed", item_id)
    if res.per_seller:
        async with session_scope(factory) as s:
            for seller_id, amount in res.per_seller.items():
                await notify(s, seller_id, type="PAYOUT_UPDATE", title="Средства доступны к выводу", body=f"Снят холд: {amount / 100:.2f} ₽ перешло в доступный баланс.", link="/seller/payouts")
    return res
