"""`fulfill_order` — deliver a PAID order (docs/CONTRACTS.md §7, §10, §20-B).

Concurrency model: the Order row is locked `FOR UPDATE` while state is read/changed (the web in-process fallback
`fulfillOrderInline` does the same, so both can run safely at the same time and each skips items that are no longer
PENDING/PROCESSING). The slow supplier call for AUTO_PROVIDER items happens OUTSIDE the DB transaction, guarded by a Redis lock
per item and an idempotency `ref` (= OrderItem.id) on the supplier side.

Phases
  1. (tx) lock order, deliver AUTO_STOCK items, mark MANUAL items PROCESSING (+notify seller), mark AUTO_PROVIDER items PROCESSING
  2. (no tx) call the supplier for AUTO_PROVIDER items (start or poll)
  3. (tx) lock order again, apply supplier results; failures -> item FAILED -> auto-refund (REFUND ledger posting to buyer balance)
  Finally derive the order status from its items (state machine in `state.py`) and notify the buyer.

The ledger PURCHASE posting is done by web at payment time and is NOT repeated here; a refund is only posted when that PURCHASE
exists for the item and no REFUND was posted before (idempotent).
"""
from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload
from sqlalchemy.orm.attributes import set_committed_value

from ..config import get_settings
from ..crypto import decrypt_stock, parse_key
from ..db import SessionFactory, session_scope
from ..ledger import has_posting, post_ledger, purchase_posted, refund_lines
from ..models import Order, OrderItem, StockItem
from ..notifications import notify, notify_admins, write_audit
from ..providers import ProviderError, TopupProvider, TopupResult, get_topup_provider
from ..settings_store import AUTO_REFUND_ON_FAILURE, HOLD_DAYS, get_int_setting, get_setting
from ..state import assert_transition, derive_order_status
from ..util import utcnow
from .locks import redis_lock

log = logging.getLogger("worker.fulfill")

#: delay before the next attempt after a transient supplier error / a still-pending top-up (seconds, by attempt number)
RETRY_DELAYS = (15, 60, 300, 900, 1800)
PENDING_POLL_DELAYS = (20, 60, 180, 600, 1800)


def _delay(table: tuple[int, ...], attempt: int) -> float:
    return float(table[min(max(attempt, 1), len(table)) - 1])


@dataclass
class FulfillOutcome:
    order_id: str
    order_status: str | None = None
    skipped: str | None = None
    delivered: int = 0
    processing: int = 0
    failed: int = 0
    refunded: int = 0
    retry_in: float | None = None
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["orderId"] = d.pop("order_id")
        return d


@dataclass
class _ProviderTask:
    item_id: str
    login: str | None
    amount_rub: float | None
    existing_tx_id: str | None
    started: bool


class _ItemFailed(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


# ───────────────────────────── helpers ─────────────────────────────


async def _lock_order(session: AsyncSession, order_id: str) -> Order | None:
    return (await session.execute(select(Order).where(Order.id == order_id).with_for_update())).scalar_one_or_none()


async def _load_items(session: AsyncSession, order_id: str) -> list[OrderItem]:
    q = (
        select(OrderItem)
        .where(OrderItem.orderId == order_id)
        .options(joinedload(OrderItem.product), joinedload(OrderItem.variant))
        .order_by(OrderItem.createdAt, OrderItem.id)
    )
    return list((await session.execute(q)).scalars().unique())


def _merge_delivery(item: OrderItem, **data: Any) -> dict[str, Any]:
    cur = dict(item.deliveryData) if isinstance(item.deliveryData, dict) else {}
    cur.update(data)
    return cur


async def _hold_days(session: AsyncSession) -> int:
    return await get_int_setting(session, HOLD_DAYS, get_settings().hold_days)


def _provider_inputs(item: OrderItem) -> tuple[str | None, float | None]:
    """Steam login + RUB amount to credit: custom amount in meta (kopecks) or the variant's `amountRub` x quantity."""
    meta = item.meta if isinstance(item.meta, dict) else {}
    login = meta.get("steamLogin")
    login = login.strip() if isinstance(login, str) and login.strip() else None
    amount: float | None = None
    kop = meta.get("amountKopecks")
    if isinstance(kop, (int, float)) and kop > 0:
        amount = kop / 100
    else:
        attrs = item.variant.attributes if item.variant is not None and isinstance(item.variant.attributes, dict) else {}
        rub = attrs.get("amountRub")
        if isinstance(rub, (int, float)) and rub > 0:
            amount = float(rub) * max(item.quantity, 1)
    if amount is not None and float(amount).is_integer():
        amount = int(amount)
    return login, amount


# ───────────────────────────── AUTO_STOCK ─────────────────────────────


async def _deliver_stock(session: AsyncSession, item: OrderItem, now: datetime, hold_days: int) -> int:
    """Attach `quantity` decryptable StockItems to the order item and mark them SOLD. Raises `_ItemFailed` when stock is missing."""
    key = parse_key(get_settings().stock_encryption_key)  # config error -> propagates, tx rolls back, arq retries

    sold = (
        await session.execute(select(StockItem.id).where(StockItem.orderItemId == item.id, StockItem.status == "SOLD"))
    ).all()
    need = item.quantity - len(sold)
    good: list[StockItem] = []
    quarantined = 0

    if need > 0:
        reserved = list(
            (
                await session.execute(
                    select(StockItem)
                    .where(StockItem.orderItemId == item.id, StockItem.status == "RESERVED")
                    .order_by(StockItem.createdAt, StockItem.id)
                    .with_for_update()
                )
            ).scalars()
        )
        candidates = reserved
        for _ in range(5):  # reserved first, then top up from AVAILABLE (SKIP LOCKED) if some were missing/corrupt
            for st in candidates:
                try:
                    decrypt_stock(st.payloadEnc, key)  # integrity check only; plaintext is never stored/logged
                except Exception:  # noqa: BLE001
                    st.status, st.soldAt, st.reservedUntil, st.orderItemId = "SOLD", now, None, None  # quarantine: never resold
                    quarantined += 1
                    continue
                good.append(st)
            if len(good) >= need:
                break
            candidates = list(
                (
                    await session.execute(
                        select(StockItem)
                        .where(
                            StockItem.productId == item.productId,
                            StockItem.variantId.is_not_distinct_from(item.variantId),
                            StockItem.status == "AVAILABLE",
                        )
                        .order_by(StockItem.createdAt, StockItem.id)
                        .limit(need - len(good))
                        .with_for_update(skip_locked=True)
                    )
                ).scalars()
            )
            if not candidates:
                break
        if len(good) < need:
            for st in good:  # give back what we held; the item fails as a whole
                st.status, st.reservedUntil, st.orderItemId = "AVAILABLE", None, None
            raise _ItemFailed("stock_missing")
        for st in good[:need]:
            st.status, st.soldAt, st.reservedUntil, st.orderItemId = "SOLD", now, None, item.id
        for st in good[need:]:
            st.status, st.reservedUntil, st.orderItemId = "AVAILABLE", None, None

    item.status = "DELIVERED"
    item.deliveredAt = now
    item.holdReleaseAt = now + timedelta(days=hold_days)
    item.deliveryData = _merge_delivery(item, mode="AUTO_STOCK", count=item.quantity, **({"quarantined": quarantined} if quarantined else {}))
    return item.quantity


# ───────────────────────────── failure / refund ─────────────────────────────


async def _refund_failed_item(session: AsyncSession, order: Order, item: OrderItem, reason: str) -> bool:
    """Auto-refund a failed item to the buyer's site balance (REFUND posting). Idempotent. Returns True when the item is now REFUNDED."""
    if await has_posting(session, kind="REFUND", order_item_id=item.id):
        item.status = "REFUNDED"
        return True
    if not await purchase_posted(session, order_id=order.id, order_item_id=item.id):
        # money never moved through the ledger for this item (should not happen) — do not invent a refund
        await write_audit(session, action="order.auto_refund_skipped", entity_type="OrderItem", entity_id=item.id, after={"reason": "no PURCHASE posting"})
        await notify_admins(session, title=f"Нет проводки покупки по заказу {order.number}", body=f"Позиция «{item.title}» не выдана, но возврат невозможен.", link=f"/admin/orders/{order.id}")
        return False
    lines = refund_lines(
        buyer_id=order.buyerId, seller_id=item.sellerId, total=item.total, seller_earning=item.sellerEarning,
        commission_amount=item.commissionAmount, hold_released=bool(item.holdReleased),
    )
    await post_ledger(session, kind="REFUND", lines=lines, order_id=order.id, order_item_id=item.id, memo=f"Авто-возврат: {item.title} ({reason})"[:200])
    item.status = "REFUNDED"
    await session.execute(
        update(StockItem).where(StockItem.orderItemId == item.id, StockItem.status == "RESERVED").values(status="AVAILABLE", reservedUntil=None, orderItemId=None)
    )
    await write_audit(session, action="order.auto_refund", entity_type="OrderItem", entity_id=item.id, after={"orderId": order.id, "amount": item.total, "reason": reason})
    return True


async def _fail_item(session: AsyncSession, order: Order, item: OrderItem, reason: str, out: FulfillOutcome, **extra: Any) -> None:
    item.status = "FAILED"
    item.deliveryData = _merge_delivery(item, error=reason, failedAt=utcnow().isoformat(), **extra)
    out.failed += 1
    auto = bool(await get_setting(session, AUTO_REFUND_ON_FAILURE, True))
    if auto and await _refund_failed_item(session, order, item, reason):
        out.refunded += 1
        out.failed -= 1
        out.notes.append(f"refunded:{item.id}")
    else:
        await notify_admins(session, title=f"Не удалась выдача по заказу {order.number}", body=f"«{item.title}»: {reason}", link=f"/admin/orders/{order.id}", type="SYSTEM")


# ───────────────────────────── order finalisation ─────────────────────────────


async def _finalize_order(session: AsyncSession, order: Order, items: list[OrderItem], now: datetime, out: FulfillOutcome, refunded_titles: list[str]) -> None:
    statuses = [i.status for i in items]
    nxt = derive_order_status(order.status, statuses)
    if nxt and nxt != order.status:
        assert_transition(order.status, nxt)
        values: dict[str, Any] = {"status": nxt, "updatedAt": now}
        if nxt == "DELIVERED":
            values["deliveredAt"] = now
        res = await session.execute(update(Order).where(Order.id == order.id, Order.status == order.status).values(**values))
        if res.rowcount != 1:
            raise RuntimeError(f"Order {order.id} changed concurrently (expected {order.status})")
        prev = order.status
        set_committed_value(order, "status", nxt)  # already written by the UPDATE above; do not flush it a second time
        out.notes.append(f"order:{prev}->{nxt}")
        link = f"/account/orders/{order.id}"
        if nxt == "DELIVERED":
            body = "Ключи и данные доступны в личном кабинете."
            if refunded_titles:
                body += f" Не выданные позиции возвращены на баланс: {', '.join(refunded_titles)}."
            await notify(session, order.buyerId, type="ORDER_DELIVERED", title=f"Заказ {order.number} выдан", body=body, link=link)
        elif nxt == "REFUNDED":
            await notify(session, order.buyerId, type="ORDER_FAILED", title=f"Заказ {order.number} не выдан — деньги возвращены", body="Оплата вернулась на ваш баланс на сайте.", link=link)
        elif nxt == "FAILED":
            await notify(session, order.buyerId, type="ORDER_FAILED", title=f"Не удалось выдать заказ {order.number}", body="Мы уже разбираемся — поддержка свяжется с вами или вернёт деньги.", link=link)
    elif refunded_titles and order.status in ("DELIVERED", "PROCESSING"):
        await notify(session, order.buyerId, type="ORDER_FAILED", title=f"Часть заказа {order.number} возвращена", body=f"Возвращено на баланс: {', '.join(refunded_titles)}.", link=f"/account/orders/{order.id}")
    out.order_status = order.status
    out.delivered = sum(1 for s in statuses if s == "DELIVERED")
    out.processing = sum(1 for s in statuses if s in ("PENDING", "PROCESSING"))
    out.failed = sum(1 for s in statuses if s == "FAILED")
    out.refunded = sum(1 for s in statuses if s == "REFUNDED")


# ───────────────────────────── main entry ─────────────────────────────


async def fulfill_order_impl(
    factory: SessionFactory,
    order_id: str,
    *,
    provider: TopupProvider | None = None,
    redis: Any | None = None,
    attempt: int = 1,
    max_attempts: int | None = None,
) -> FulfillOutcome:
    """Idempotent order fulfilment. Safe to call repeatedly and concurrently (web inline fallback, cron sweeper, arq retries)."""
    settings = get_settings()
    max_attempts = max_attempts or settings.fulfill_max_tries
    out = FulfillOutcome(order_id=order_id)

    # ── phase 1: stock + manual + mark provider items PROCESSING ──
    provider_tasks: list[_ProviderTask] = []
    async with session_scope(factory) as s:
        order = await _lock_order(s, order_id)
        if order is None:
            out.skipped = "not_found"
            return out
        out.order_status = order.status
        if order.status not in ("PAID", "PROCESSING"):
            out.skipped = f"status_{order.status}"
            items = await _load_items(s, order_id)
            out.delivered = sum(1 for i in items if i.status == "DELIVERED")
            return out
        items = await _load_items(s, order_id)
        now = utcnow()
        hold_days = await _hold_days(s)
        refunded_titles: list[str] = []
        for item in items:
            if item.status not in ("PENDING", "PROCESSING"):
                continue
            mode = item.product.deliveryMode
            if mode == "AUTO_STOCK":
                try:
                    await _deliver_stock(s, item, now, hold_days)
                except _ItemFailed as exc:
                    await _fail_item(s, order, item, exc.reason, out, mode=mode)
                    if item.status == "REFUNDED":
                        refunded_titles.append(item.title)
            elif mode == "AUTO_PROVIDER":
                dd = item.deliveryData if isinstance(item.deliveryData, dict) else {}
                login, amount = _provider_inputs(item)
                provider_tasks.append(_ProviderTask(item.id, login, amount, dd.get("txId"), bool(dd.get("attempts"))))
                if item.status == "PENDING":
                    item.status = "PROCESSING"
            else:  # MANUAL: the seller delivers from /seller/orders
                if item.status == "PENDING":
                    item.status = "PROCESSING"
                    await notify(s, item.sellerId, type="ORDER_PAID", title=f"Заказ {order.number} ждёт выдачи", body=f"Покупатель оплатил «{item.title}» — выдайте товар.", link="/seller/orders")
        await s.flush()
        # with supplier items in flight the order moves to PROCESSING here; final statuses are applied in phase 3
        await _finalize_order(s, order, items, now, out, refunded_titles)
        if not provider_tasks:
            return out

    # ── phase 2: supplier calls (outside any DB transaction) ──
    prov = provider or get_topup_provider()
    results: dict[str, TopupResult | ProviderError | _ItemFailed | None] = {}
    for task in provider_tasks:
        if not task.login or not task.amount_rub:
            results[task.item_id] = _ItemFailed("invalid_input")  # nothing to retry: buyer data missing
            continue
        async with redis_lock(redis, f"lock:fulfill:provider:{task.item_id}") as got:
            if not got:
                results[task.item_id] = None  # another worker is on it
                continue
            try:
                if task.existing_tx_id:
                    results[task.item_id] = await prov.status(task.item_id, task.existing_tx_id)
                else:
                    results[task.item_id] = await prov.topup(task.login, task.amount_rub, task.item_id)
            except ProviderError as exc:
                results[task.item_id] = exc
            except Exception as exc:  # noqa: BLE001 - never lose the order because of an adapter bug
                log.exception("supplier adapter crashed for item %s", task.item_id)
                results[task.item_id] = ProviderError(f"adapter error: {exc.__class__.__name__}")

    # ── phase 3: apply results ──
    out2 = FulfillOutcome(order_id=order_id)
    async with session_scope(factory) as s:
        order = await _lock_order(s, order_id)
        assert order is not None
        items = await _load_items(s, order_id)
        by_id = {i.id: i for i in items}
        now = utcnow()
        hold_days = await _hold_days(s)
        refunded_titles = []
        retry_in: float | None = None
        for task in provider_tasks:
            item = by_id[task.item_id]
            if item.status != "PROCESSING":
                continue  # someone else finished it meanwhile
            res = results.get(task.item_id)
            base = {"provider": prov.name, "sandbox": prov.name == "mock", "steamLogin": task.login, "amountRub": task.amount_rub}
            if res is None:
                retry_in = min(retry_in or 1e9, 10.0)
            elif isinstance(res, _ItemFailed):
                await _fail_item(s, order, item, res.reason, out2, **base)
            elif isinstance(res, ProviderError):
                if attempt >= max_attempts:
                    await _fail_item(s, order, item, f"provider_unavailable: {res}", out2, **base, attempts=attempt)
                else:
                    item.deliveryData = _merge_delivery(item, **base, status="retrying", attempts=attempt, lastError=str(res)[:200])
                    retry_in = min(retry_in or 1e9, _delay(RETRY_DELAYS, attempt))
            elif res.status == "completed":
                item.status, item.deliveredAt = "DELIVERED", now
                item.holdReleaseAt = now + timedelta(days=hold_days)
                item.deliveryData = _merge_delivery(item, **base, status="completed", txId=res.tx_id, attempts=attempt, **({"message": res.message} if res.message else {}))
            elif res.status == "failed":
                await _fail_item(s, order, item, res.message or "provider_failed", out2, **base, txId=res.tx_id or None, attempts=attempt)
            else:  # pending at the supplier
                dd = _merge_delivery(item, **base, status="pending", txId=res.tx_id or None, attempts=attempt)
                if attempt >= max_attempts:
                    if not dd.get("stalled"):
                        dd["stalled"] = True
                        await write_audit(s, action="order.provider_pending_timeout", entity_type="OrderItem", entity_id=item.id, after={"txId": res.tx_id, "attempts": attempt})
                        await notify_admins(s, title=f"Пополнение «зависло» у поставщика: {order.number}", body=f"tx {res.tx_id}: проверьте статус у поставщика.", link=f"/admin/orders/{order.id}")
                else:
                    retry_in = min(retry_in or 1e9, _delay(PENDING_POLL_DELAYS, attempt))
                item.deliveryData = dd
            if item.status == "REFUNDED":
                refunded_titles.append(item.title)
        await s.flush()
        await _finalize_order(s, order, items, now, out2, refunded_titles)
        out2.retry_in = retry_in if retry_in and retry_in < 1e9 else None
        out2.notes = out.notes + out2.notes
        return out2
