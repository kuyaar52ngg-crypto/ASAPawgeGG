import asyncio
from datetime import timedelta

from sqlalchemy import text

from app.crypto import encrypt_stock, parse_key
from app.jobs.fulfill import fulfill_order_impl
from app.ledger import unbalanced_transactions
from app.providers import CheckLoginResult, MockSteamProvider, ProviderError, TopupResult
from app.util import new_id

from .factories import KEY, make_category, make_paid_order, make_product, make_stock, make_user


async def q(factory, sql, **params):
    async with factory() as s:
        return (await s.execute(text(sql), params)).all()


async def scalar(factory, sql, **params):
    rows = await q(factory, sql, **params)
    return rows[0][0] if rows else None


async def setup_stock_order(factory, *, stock=2, qty=1, price=100_000):
    async with factory() as s, s.begin():
        seller, buyer, cat = await make_user(s, "SELLER"), await make_user(s), await make_category(s)
        prod = await make_product(s, seller, cat, price=price)
        await make_stock(s, prod, [f"KEY-{i}-ПРОБА" for i in range(stock)])
        order = await make_paid_order(s, buyer, [{"product": prod, "quantity": qty}])
        return seller, buyer, prod, order


async def test_auto_stock_delivery(factory):
    seller, buyer, prod, order = await setup_stock_order(factory, stock=3, qty=2)
    out = await fulfill_order_impl(factory, order.id)
    assert out.order_status == "DELIVERED" and out.delivered == 1 and out.retry_in is None

    item = (await q(factory, 'SELECT status, "deliveryData", "holdReleaseAt", "deliveredAt" FROM "OrderItem" WHERE "orderId" = :o', o=order.id))[0]
    assert item[0] == "DELIVERED" and item[1]["mode"] == "AUTO_STOCK" and item[1]["count"] == 2
    assert item[2] is not None and item[3] is not None
    # plaintext must never be copied into deliveryData / notifications
    assert "KEY-" not in str(item[1])

    sold = await q(factory, 'SELECT status, "orderItemId", "soldAt", "reservedUntil" FROM "StockItem" ORDER BY "createdAt"')
    assert [r[0] for r in sold] == ["SOLD", "SOLD", "AVAILABLE"]
    assert all(r[2] is not None and r[3] is None for r in sold[:2])
    o = (await q(factory, 'SELECT status, "deliveredAt" FROM "Order" WHERE id = :o', o=order.id))[0]
    assert o[0] == "DELIVERED" and o[1] is not None
    notes = await q(factory, 'SELECT type, "userId" FROM "Notification"')
    assert notes == [("ORDER_DELIVERED", buyer.id)]


async def test_fulfill_is_idempotent(factory):
    _, _, _, order = await setup_stock_order(factory, stock=2)
    first = await fulfill_order_impl(factory, order.id)
    snapshot = await q(factory, 'SELECT id, status, "soldAt" FROM "StockItem" ORDER BY id')
    second = await fulfill_order_impl(factory, order.id)
    third = await fulfill_order_impl(factory, order.id)
    assert first.order_status == "DELIVERED" and second.skipped == "status_DELIVERED" and third.skipped == "status_DELIVERED"
    assert await q(factory, 'SELECT id, status, "soldAt" FROM "StockItem" ORDER BY id') == snapshot
    assert await scalar(factory, 'SELECT COUNT(*) FROM "Notification"') == 1


async def test_concurrent_runs_deliver_once(factory):
    _, _, _, order = await setup_stock_order(factory, stock=5, qty=3)
    results = await asyncio.gather(*[fulfill_order_impl(factory, order.id) for _ in range(4)])
    assert sum(1 for r in results if not r.skipped) == 1
    assert await scalar(factory, "SELECT COUNT(*) FROM \"StockItem\" WHERE status = 'SOLD'") == 3
    assert await scalar(factory, 'SELECT COUNT(*) FROM "Notification"') == 1


async def test_skips_unpaid_and_missing(factory):
    async with factory() as s, s.begin():
        seller, buyer, cat = await make_user(s, "SELLER"), await make_user(s), await make_category(s)
        prod = await make_product(s, seller, cat)
        await make_stock(s, prod, ["A"])
        pending = await make_paid_order(s, buyer, [{"product": prod}], status="PENDING")
    assert (await fulfill_order_impl(factory, pending.id)).skipped == "status_PENDING"
    assert (await fulfill_order_impl(factory, "nope")).skipped == "not_found"
    assert await scalar(factory, "SELECT COUNT(*) FROM \"StockItem\" WHERE status = 'SOLD'") == 0


async def test_missing_stock_fails_and_auto_refunds_once(factory):
    seller, buyer, prod, order = await setup_stock_order(factory, stock=0)
    out = await fulfill_order_impl(factory, order.id)
    assert out.order_status == "REFUNDED" and out.refunded == 1

    assert await scalar(factory, 'SELECT balance FROM "User" WHERE id = :u', u=buyer.id) == 100_000
    sp = (await q(factory, 'SELECT "holdBalance", "availableBalance" FROM "SellerProfile" WHERE "userId" = :u', u=seller.id))[0]
    assert tuple(sp) == (0, 0)
    assert await scalar(factory, "SELECT status FROM \"OrderItem\" WHERE \"orderId\" = :o", o=order.id) == "REFUNDED"
    async with factory() as s:
        assert await unbalanced_transactions(s) == []
    refund_rows = await scalar(factory, "SELECT COUNT(*) FROM \"LedgerEntry\" WHERE kind = 'REFUND'")
    assert refund_rows == 3
    # buyer is told, and a re-run must not refund twice
    await fulfill_order_impl(factory, order.id)
    assert await scalar(factory, "SELECT COUNT(*) FROM \"LedgerEntry\" WHERE kind = 'REFUND'") == 3
    assert await scalar(factory, 'SELECT balance FROM "User" WHERE id = :u', u=buyer.id) == 100_000
    assert await scalar(factory, "SELECT COUNT(*) FROM \"Notification\" WHERE type = 'ORDER_FAILED'") == 1


async def test_refund_after_hold_released_debits_available(factory):
    """Refund ledger rule: DEBIT SELLER_AVAILABLE when the hold was already released."""
    from app.jobs.fulfill import _refund_failed_item  # noqa: PLC2701
    from app.ledger import hold_release_lines, post_ledger
    from app.models import Order, OrderItem
    from sqlalchemy import select

    seller, buyer, prod, order = await setup_stock_order(factory, stock=1)
    async with factory() as s, s.begin():
        item = (await s.execute(select(OrderItem).where(OrderItem.orderId == order.id))).scalar_one()
        await post_ledger(s, kind="HOLD_RELEASE", lines=hold_release_lines(seller.id, item.sellerEarning), order_item_id=item.id)
        item.holdReleased = True
        o = (await s.execute(select(Order).where(Order.id == order.id))).scalar_one()
        assert await _refund_failed_item(s, o, item, "test")
    sp = (await q(factory, 'SELECT "holdBalance", "availableBalance" FROM "SellerProfile" WHERE "userId" = :u', u=seller.id))[0]
    assert tuple(sp) == (0, 0)
    assert await scalar(factory, 'SELECT balance FROM "User" WHERE id = :u', u=buyer.id) == 100_000


async def test_partial_failure_delivers_one_refunds_other(factory):
    async with factory() as s, s.begin():
        seller, buyer, cat = await make_user(s, "SELLER"), await make_user(s), await make_category(s)
        have = await make_product(s, seller, cat, title="Have")
        gone = await make_product(s, seller, cat, title="Gone", price=50_000)
        await make_stock(s, have, ["K1"])
        order = await make_paid_order(s, buyer, [{"product": have}, {"product": gone}])
    out = await fulfill_order_impl(factory, order.id)
    assert out.order_status == "DELIVERED" and out.delivered == 1 and out.refunded == 1
    assert await scalar(factory, 'SELECT balance FROM "User" WHERE id = :u', u=buyer.id) == 50_000
    body = await scalar(factory, "SELECT body FROM \"Notification\" WHERE type = 'ORDER_DELIVERED'")
    assert "Gone" in body
    async with factory() as s:
        assert await unbalanced_transactions(s) == []


async def test_reservation_lost_tops_up_from_available_stock(factory):
    _, _, prod, order = await setup_stock_order(factory, stock=2)
    async with factory() as s, s.begin():  # the reservation disappeared (e.g. admin tool) — another key is still free
        await s.execute(text("UPDATE \"StockItem\" SET status = 'AVAILABLE', \"orderItemId\" = NULL, \"reservedUntil\" = NULL"))
    out = await fulfill_order_impl(factory, order.id)
    assert out.order_status == "DELIVERED"
    assert await scalar(factory, "SELECT COUNT(*) FROM \"StockItem\" WHERE status = 'SOLD' AND \"orderItemId\" IS NOT NULL") == 1


async def test_corrupt_stock_is_quarantined_and_replaced(factory):
    _, _, prod, order = await setup_stock_order(factory, stock=2)
    async with factory() as s, s.begin():
        first = (await s.execute(text('SELECT id FROM "StockItem" ORDER BY "createdAt" LIMIT 1'))).scalar_one()
        await s.execute(text('UPDATE "StockItem" SET "payloadEnc" = :p WHERE id = :i'), {"p": encrypt_stock("x", parse_key("a" * 64)), "i": first})  # wrong key
    out = await fulfill_order_impl(factory, order.id)
    assert out.order_status == "DELIVERED"
    rows = dict((await q(factory, 'SELECT id, "orderItemId" FROM "StockItem"')))
    assert rows[first] is None  # quarantined: SOLD but detached, never resold
    assert await scalar(factory, 'SELECT status FROM "StockItem" WHERE id = :i', i=first) == "SOLD"


async def test_missing_encryption_key_aborts_without_side_effects(factory, monkeypatch):
    import pytest

    from app.config import get_settings

    _, buyer, _, order = await setup_stock_order(factory, stock=1)
    monkeypatch.setattr(get_settings(), "stock_encryption_key", "")
    with pytest.raises(ValueError):
        await fulfill_order_impl(factory, order.id)
    assert await scalar(factory, 'SELECT status FROM "Order" WHERE id = :o', o=order.id) == "PAID"
    assert await scalar(factory, 'SELECT balance FROM "User" WHERE id = :u', u=buyer.id) == 0


async def test_manual_item_goes_processing_and_notifies_seller_once(factory):
    async with factory() as s, s.begin():
        seller, buyer, cat = await make_user(s, "SELLER"), await make_user(s), await make_category(s)
        prod = await make_product(s, seller, cat, mode="MANUAL", ptype="SERVICE")
        order = await make_paid_order(s, buyer, [{"product": prod, "meta": {"buyerInput": "my@nick"}}])
    out = await fulfill_order_impl(factory, order.id)
    assert out.order_status == "PROCESSING" and out.processing == 1
    await fulfill_order_impl(factory, order.id)
    notes = await q(factory, 'SELECT "userId", type, link FROM "Notification"')
    assert notes == [(seller.id, "ORDER_PAID", "/seller/orders")]
    assert await scalar(factory, 'SELECT status FROM "OrderItem" WHERE "orderId" = :o', o=order.id) == "PROCESSING"


# ───────────── AUTO_PROVIDER (Steam top-up) ─────────────


class ScriptedProvider:
    """Test double for the supplier: replays prepared results / exceptions."""

    name = "mock"

    def __init__(self, *script):
        self.script = list(script)
        self.calls: list[tuple] = []

    async def check_login(self, login):
        return CheckLoginResult(True, login)

    async def _next(self, kind, *args):
        self.calls.append((kind, *args))
        item = self.script.pop(0) if len(self.script) > 1 else self.script[0]
        if isinstance(item, Exception):
            raise item
        return item

    async def topup(self, login, amount_rub, ref):
        return await self._next("topup", login, amount_rub, ref)

    async def status(self, ref, tx_id=None):
        return await self._next("status", ref, tx_id)


async def setup_topup_order(factory, *, login="steamuser1", amount_kop=150_000):
    async with factory() as s, s.begin():
        seller, buyer, cat = await make_user(s, "SELLER"), await make_user(s), await make_category(s, "steam-topup", "Пополнение Steam")
        prod = await make_product(s, seller, cat, mode="AUTO_PROVIDER", ptype="TOPUP", title="Пополнение Steam", price=amount_kop)
        meta = {"amountKopecks": amount_kop}
        if login:
            meta["steamLogin"] = login
        order = await make_paid_order(s, buyer, [{"product": prod, "meta": meta}])
    return seller, buyer, order


async def test_steam_topup_completes_with_mock_provider(factory):
    _, buyer, order = await setup_topup_order(factory)
    out = await fulfill_order_impl(factory, order.id, provider=MockSteamProvider())
    assert out.order_status == "DELIVERED"
    dd = (await q(factory, 'SELECT "deliveryData" FROM "OrderItem" WHERE "orderId" = :o', o=order.id))[0][0]
    assert dd["provider"] == "mock" and dd["sandbox"] is True and dd["status"] == "completed"
    assert dd["amountRub"] == 1500 and dd["steamLogin"] == "steamuser1" and dd["txId"].startswith("mock_")
    assert await scalar(factory, 'SELECT "holdReleaseAt" IS NOT NULL FROM "OrderItem" WHERE "orderId" = :o', o=order.id)


async def test_steam_topup_rejected_login_refunds(factory):
    _, buyer, order = await setup_topup_order(factory, login="invalid_user")
    out = await fulfill_order_impl(factory, order.id, provider=MockSteamProvider())
    assert out.order_status == "REFUNDED"
    assert await scalar(factory, 'SELECT balance FROM "User" WHERE id = :u', u=buyer.id) == 150_000
    dd = (await q(factory, 'SELECT "deliveryData" FROM "OrderItem" WHERE "orderId" = :o', o=order.id))[0][0]
    assert dd["error"] and dd["provider"] == "mock"


async def test_steam_topup_missing_login_is_refunded_without_calling_supplier(factory):
    _, buyer, order = await setup_topup_order(factory, login=None)
    prov = ScriptedProvider(TopupResult("completed", "tx"))
    out = await fulfill_order_impl(factory, order.id, provider=prov)
    assert out.order_status == "REFUNDED" and prov.calls == []


async def test_transient_supplier_error_retries_then_succeeds(factory):
    _, _, order = await setup_topup_order(factory)
    prov = ScriptedProvider(ProviderError("supplier responded 503"), TopupResult("completed", "SUP-1"))
    first = await fulfill_order_impl(factory, order.id, provider=prov, attempt=1, max_attempts=4)
    assert first.retry_in == 15 and first.order_status == "PROCESSING"
    dd = (await q(factory, 'SELECT status, "deliveryData" FROM "OrderItem" WHERE "orderId" = :o', o=order.id))[0]
    assert dd[0] == "PROCESSING" and dd[1]["status"] == "retrying" and dd[1]["attempts"] == 1
    second = await fulfill_order_impl(factory, order.id, provider=prov, attempt=2, max_attempts=4)
    assert second.retry_in is None and second.order_status == "DELIVERED"
    assert await scalar(factory, "SELECT \"deliveryData\"->>'txId' FROM \"OrderItem\" WHERE \"orderId\" = :o", o=order.id) == "SUP-1"
    assert await scalar(factory, "SELECT COUNT(*) FROM \"LedgerEntry\" WHERE kind = 'REFUND'") == 0


async def test_supplier_down_for_all_attempts_fails_and_refunds(factory):
    _, buyer, order = await setup_topup_order(factory)
    prov = ScriptedProvider(ProviderError("supplier unreachable"))
    last = None
    for attempt in range(1, 4):
        last = await fulfill_order_impl(factory, order.id, provider=prov, attempt=attempt, max_attempts=3)
        assert (last.retry_in is not None) == (attempt < 3)
    assert last.order_status == "REFUNDED"
    assert await scalar(factory, 'SELECT balance FROM "User" WHERE id = :u', u=buyer.id) == 150_000
    async with factory() as s:
        assert await unbalanced_transactions(s) == []


async def test_pending_topup_is_polled_not_retopped_up(factory):
    _, _, order = await setup_topup_order(factory)
    prov = ScriptedProvider(TopupResult("pending", "SUP-9"))
    first = await fulfill_order_impl(factory, order.id, provider=prov, attempt=1, max_attempts=5)
    assert first.retry_in == 20 and first.order_status == "PROCESSING"
    prov.script = [TopupResult("completed", "SUP-9")]
    second = await fulfill_order_impl(factory, order.id, provider=prov, attempt=2, max_attempts=5)
    assert second.order_status == "DELIVERED"
    assert [c[0] for c in prov.calls] == ["topup", "status"]  # the money-moving call happened exactly once
    assert prov.calls[1][2] == "SUP-9"


async def test_pending_forever_stalls_without_refund_and_alerts_admin(factory):
    async with factory() as s, s.begin():
        await make_user(s, "ADMIN")
    _, buyer, order = await setup_topup_order(factory)
    prov = ScriptedProvider(TopupResult("pending", "SUP-X"))
    out = await fulfill_order_impl(factory, order.id, provider=prov, attempt=3, max_attempts=3)
    assert out.retry_in is None and out.order_status == "PROCESSING"
    assert await scalar(factory, 'SELECT balance FROM "User" WHERE id = :u', u=buyer.id) == 0  # supplier may still deliver: no auto-refund
    assert await scalar(factory, "SELECT COUNT(*) FROM \"Notification\" WHERE title LIKE 'Пополнение «зависло»%'") == 1


async def test_auto_refund_can_be_disabled_by_setting(factory):
    from app.settings_store import AUTO_REFUND_ON_FAILURE, set_setting

    async with factory() as s, s.begin():
        await set_setting(s, AUTO_REFUND_ON_FAILURE, False)
        await make_user(s, "ADMIN")
    _, buyer, order = await setup_topup_order(factory, login="nouser")
    out = await fulfill_order_impl(factory, order.id, provider=MockSteamProvider())
    assert out.order_status == "FAILED" and out.refunded == 0
    assert await scalar(factory, 'SELECT balance FROM "User" WHERE id = :u', u=buyer.id) == 0


async def test_new_id_shape():
    a, b = new_id(), new_id()
    assert a != b and a.startswith("c") and len(a) == 25
    assert KEY  # factories import sanity
