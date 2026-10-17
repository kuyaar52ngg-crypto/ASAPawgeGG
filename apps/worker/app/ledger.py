"""Double-entry ledger for the worker — behavioural mirror of apps/web/src/server/ledger (docs/CONTRACTS.md §8).

The worker only posts what the contract assigns to it:
  * HOLD_RELEASE  (cron `release_holds`):   DEBIT SELLER_HOLD  · CREDIT SELLER_AVAILABLE
  * REFUND        (failed delivery, auto):  DEBIT SELLER_HOLD|AVAILABLE earning · DEBIT PLATFORM_FEE commission · CREDIT USER_BALANCE total
The PURCHASE/TOPUP postings are done by web at payment time (`markPaid`) and are never repeated here.
All posting + cached-balance updates must run inside the caller's transaction.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import and_, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .models import LedgerEntry
from .util import new_id, utcnow

OWNED_ACCOUNTS = frozenset({"USER_BALANCE", "SELLER_HOLD", "SELLER_AVAILABLE"})


class LedgerError(Exception):
    pass


class InsufficientFundsError(LedgerError):
    pass


@dataclass(frozen=True, slots=True)
class Line:
    account: str
    direction: str  # DEBIT | CREDIT
    amount: int  # kopecks, > 0
    owner_id: str | None = None


def totals(lines: list[Line]) -> tuple[int, int]:
    debit = sum(line.amount for line in lines if line.direction == "DEBIT")
    credit = sum(line.amount for line in lines if line.direction == "CREDIT")
    return debit, credit


def assert_balanced(lines: list[Line]) -> None:
    if len(lines) < 2:
        raise LedgerError("A posting needs at least two entries")
    for line in lines:
        if not isinstance(line.amount, int) or line.amount <= 0:
            raise LedgerError(f"Ledger amount must be a positive integer (got {line.amount!r})")
        if line.direction not in ("DEBIT", "CREDIT"):
            raise LedgerError(f"Bad direction {line.direction!r}")
        if line.account in OWNED_ACCOUNTS and not line.owner_id:
            raise LedgerError(f"Account {line.account} requires owner_id")
        if line.account not in OWNED_ACCOUNTS and line.owner_id:
            raise LedgerError(f"Account {line.account} must not have owner_id")
    debit, credit = totals(lines)
    if debit != credit:
        raise LedgerError(f"Unbalanced posting: debit {debit} != credit {credit}")


def natural_delta(line: Line) -> int:
    """Signed effect on the account's natural balance (EXTERNAL: DEBIT = +; every other account: CREDIT = +)."""
    plus_on_debit = line.account == "EXTERNAL"
    positive = (line.direction == "DEBIT") if plus_on_debit else (line.direction == "CREDIT")
    return line.amount if positive else -line.amount


def balance_of(lines: list[Line]) -> int:
    return sum(natural_delta(line) for line in lines)


@dataclass(slots=True)
class CacheDeltas:
    user_balance: dict[str, int]
    seller_hold: dict[str, int]
    seller_available: dict[str, int]


def cache_deltas(lines: list[Line]) -> CacheDeltas:
    out = CacheDeltas({}, {}, {})
    for line in lines:
        if not line.owner_id:
            continue
        bucket = {"USER_BALANCE": out.user_balance, "SELLER_HOLD": out.seller_hold, "SELLER_AVAILABLE": out.seller_available}.get(line.account)
        if bucket is not None:
            bucket[line.owner_id] = bucket.get(line.owner_id, 0) + natural_delta(line)
    for bucket in (out.user_balance, out.seller_hold, out.seller_available):
        for key in [k for k, v in bucket.items() if v == 0]:
            del bucket[key]
    return out


def _finalize(lines: list[Line]) -> list[Line]:
    non_zero = [line for line in lines if line.amount != 0]
    if not non_zero:
        return []
    assert_balanced(non_zero)
    return non_zero


# ───────────── posting builders ─────────────


def hold_release_lines(seller_id: str, seller_earning: int) -> list[Line]:
    return _finalize(
        [Line("SELLER_HOLD", "DEBIT", seller_earning, seller_id), Line("SELLER_AVAILABLE", "CREDIT", seller_earning, seller_id)]
    )


def refund_lines(*, buyer_id: str, seller_id: str, total: int, seller_earning: int, commission_amount: int, hold_released: bool) -> list[Line]:
    if seller_earning + commission_amount != total:
        raise LedgerError("sellerEarning + commissionAmount must equal item total")
    return _finalize(
        [
            Line("SELLER_AVAILABLE" if hold_released else "SELLER_HOLD", "DEBIT", seller_earning, seller_id),
            Line("PLATFORM_FEE", "DEBIT", commission_amount),
            Line("USER_BALANCE", "CREDIT", total, buyer_id),
        ]
    )


def topup_lines(buyer_id: str, amount: int) -> list[Line]:
    """Not posted by the worker (web does it at payment); kept for tests/tooling symmetry."""
    return _finalize([Line("EXTERNAL", "DEBIT", amount), Line("USER_BALANCE", "CREDIT", amount, buyer_id)])


def purchase_lines(*, buyer_id: str, seller_id: str, total: int, seller_earning: int, commission_amount: int) -> list[Line]:
    """Not posted by the worker (web does it at payment); kept for tests/tooling symmetry."""
    if seller_earning + commission_amount != total:
        raise LedgerError("sellerEarning + commissionAmount must equal item total")
    return _finalize(
        [
            Line("USER_BALANCE", "DEBIT", total, buyer_id),
            Line("SELLER_HOLD", "CREDIT", seller_earning, seller_id),
            Line("PLATFORM_FEE", "CREDIT", commission_amount),
        ]
    )


# ───────────── DB posting ─────────────


async def post_ledger(
    session: AsyncSession,
    *,
    kind: str,
    lines: list[Line],
    order_id: str | None = None,
    order_item_id: str | None = None,
    payment_id: str | None = None,
    memo: str | None = None,
) -> str | None:
    """Insert balanced entries AND update cached balances in the caller's transaction. Returns the txId (None for empty)."""
    if not lines:
        return None
    assert_balanced(lines)
    tx_id = str(uuid.uuid4())
    deltas = cache_deltas(lines)

    for user_id, delta in deltas.user_balance.items():
        if delta < 0:
            res = await session.execute(
                text('UPDATE "User" SET balance = balance - :d, "updatedAt" = :now WHERE id = :id AND balance >= :d'),
                {"d": -delta, "id": user_id, "now": utcnow()},
            )
            if res.rowcount != 1:
                raise InsufficientFundsError(f"USER_BALANCE of {user_id} would go negative")
        else:
            await session.execute(text('UPDATE "User" SET balance = balance + :d, "updatedAt" = :now WHERE id = :id'), {"d": delta, "id": user_id, "now": utcnow()})
    for seller_id, delta in deltas.seller_hold.items():
        await session.execute(
            text('UPDATE "SellerProfile" SET "holdBalance" = "holdBalance" + :d, "updatedAt" = :now WHERE "userId" = :id'),
            {"d": delta, "id": seller_id, "now": utcnow()},
        )
    for seller_id, delta in deltas.seller_available.items():
        await session.execute(
            text('UPDATE "SellerProfile" SET "availableBalance" = "availableBalance" + :d, "updatedAt" = :now WHERE "userId" = :id'),
            {"d": delta, "id": seller_id, "now": utcnow()},
        )

    now = utcnow()
    session.add_all(
        LedgerEntry(
            id=new_id(), txId=tx_id, kind=kind, account=line.account, ownerId=line.owner_id, direction=line.direction, amount=line.amount,
            orderId=order_id, orderItemId=order_item_id, paymentId=payment_id, payoutId=None, memo=memo, createdAt=now,
        )
        for line in lines
    )
    await session.flush()
    return tx_id


async def has_posting(session: AsyncSession, *, kind: str, order_item_id: str) -> bool:
    """Idempotency guard: was a posting of `kind` already made for this order item?"""
    row = (await session.execute(select(LedgerEntry.id).where(LedgerEntry.kind == kind, LedgerEntry.orderItemId == order_item_id).limit(1))).first()
    return row is not None


async def purchase_posted(session: AsyncSession, *, order_id: str, order_item_id: str) -> bool:
    """Did the PURCHASE posting (web `markPaid`) happen for this item? Tolerates legacy/seeded postings that carry only the orderId."""
    row = (
        await session.execute(
            select(LedgerEntry.id)
            .where(
                LedgerEntry.kind == "PURCHASE",
                or_(LedgerEntry.orderItemId == order_item_id, and_(LedgerEntry.orderItemId.is_(None), LedgerEntry.orderId == order_id)),
            )
            .limit(1)
        )
    ).first()
    return row is not None


async def unbalanced_transactions(session: AsyncSession) -> list[str]:
    rows = await session.execute(
        text('SELECT "txId" FROM "LedgerEntry" GROUP BY 1 HAVING SUM(CASE WHEN direction = \'DEBIT\' THEN amount ELSE -amount END) <> 0')
    )
    return [r[0] for r in rows]
