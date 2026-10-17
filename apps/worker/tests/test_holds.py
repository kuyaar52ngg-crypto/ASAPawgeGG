from datetime import timedelta

from sqlalchemy import text

from app.jobs.fulfill import fulfill_order_impl
from app.jobs.holds import release_holds_impl
from app.ledger import unbalanced_transactions
from app.util import utcnow

from .factories import make_category, make_paid_order, make_product, make_stock, make_user
from .test_fulfill import q, scalar


async def delivered_order(factory, *, price=100_000, hold_ago=timedelta(minutes=1)):
    """DELIVERED order whose hold ended `hold_ago` ago (negative => still on hold)."""
    async with factory() as s, s.begin():
        seller, buyer, cat = await make_user(s, "SELLER"), await make_user(s), await make_category(s)
        prod = await make_product(s, seller, cat, price=price)
        await make_stock(s, prod, ["K1"])
        order = await make_paid_order(s, buyer, [{"product": prod}])
    await fulfill_order_impl(factory, order.id)
    async with factory() as s, s.begin():
        await s.execute(text('UPDATE "OrderItem" SET "holdReleaseAt" = :t WHERE "orderId" = :o'), {"t": utcnow() - hold_ago, "o": order.id})
    return seller, buyer, order


async def seller_balances(factory, seller):
    return tuple((await q(factory, 'SELECT "holdBalance", "availableBalance" FROM "SellerProfile" WHERE "userId" = :u', u=seller.id))[0])


async def test_release_moves_hold_to_available(factory):
    seller, _, order = await delivered_order(factory, price=100_000)
    assert await seller_balances(factory, seller) == (90_000, 0)
    res = await release_holds_impl(factory)
    assert res.released == 1 and res.amount == 90_000 and res.errors == 0
    assert await seller_balances(factory, seller) == (0, 90_000)
    assert await scalar(factory, 'SELECT "holdReleased" FROM "OrderItem" WHERE "orderId" = :o', o=order.id) is True
    async with factory() as s:
        assert await unbalanced_transactions(s) == []
    assert await scalar(factory, "SELECT COUNT(*) FROM \"Notification\" WHERE type = 'PAYOUT_UPDATE'") == 1


async def test_release_is_idempotent(factory):
    seller, _, _ = await delivered_order(factory)
    await release_holds_impl(factory)
    again = await release_holds_impl(factory)
    assert again.released == 0
    assert await seller_balances(factory, seller) == (0, 90_000)
    assert await scalar(factory, "SELECT COUNT(*) FROM \"LedgerEntry\" WHERE kind = 'HOLD_RELEASE'") == 2


async def test_not_released_before_hold_ends(factory):
    seller, _, _ = await delivered_order(factory, hold_ago=timedelta(days=-2))
    assert (await release_holds_impl(factory)).released == 0
    assert await seller_balances(factory, seller) == (90_000, 0)


async def test_flag_only_when_posting_already_exists(factory):
    """Crash between posting and flag (or a concurrent writer): re-run must set the flag, not post again."""
    seller, _, order = await delivered_order(factory)
    await release_holds_impl(factory)
    async with factory() as s, s.begin():
        await s.execute(text('UPDATE "OrderItem" SET "holdReleased" = false WHERE "orderId" = :o'), {"o": order.id})
    res = await release_holds_impl(factory)
    assert res.released == 0
    assert await scalar(factory, 'SELECT "holdReleased" FROM "OrderItem" WHERE "orderId" = :o', o=order.id) is True
    assert await seller_balances(factory, seller) == (0, 90_000)


async def test_disputed_and_refunded_orders_keep_their_hold(factory):
    seller, _, order = await delivered_order(factory)
    async with factory() as s, s.begin():
        await s.execute(text("UPDATE \"Order\" SET status = 'DISPUTED' WHERE id = :o"), {"o": order.id})
    assert (await release_holds_impl(factory)).released == 0
    async with factory() as s, s.begin():
        await s.execute(text("UPDATE \"Order\" SET status = 'DELIVERED' WHERE id = :o"), {"o": order.id})
    assert (await release_holds_impl(factory)).released == 1


async def test_active_dispute_on_item_blocks_release(factory):
    seller, buyer, order = await delivered_order(factory)
    async with factory() as s, s.begin():
        item_id = (await s.execute(text('SELECT id FROM "OrderItem" WHERE "orderId" = :o'), {"o": order.id})).scalar_one()
        await s.execute(
            text(
                """INSERT INTO "Dispute" (id, "orderId", "orderItemId", "buyerId", "sellerId", reason, status, "createdAt", "updatedAt")
                   VALUES ('d1', :o, :i, :b, :s, 'не работает', 'OPEN', now(), now())"""
            ),
            {"o": order.id, "i": item_id, "b": buyer.id, "s": seller.id},
        )
    assert (await release_holds_impl(factory)).released == 0
    async with factory() as s, s.begin():
        await s.execute(text("UPDATE \"Dispute\" SET status = 'RESOLVED_REJECTED'"))
    assert (await release_holds_impl(factory)).released == 1


async def test_item_without_purchase_posting_is_not_released(factory):
    seller, _, order = await delivered_order(factory)
    async with factory() as s, s.begin():
        await s.execute(text("DELETE FROM \"LedgerEntry\" WHERE kind = 'PURCHASE'"))
    res = await release_holds_impl(factory)
    assert res.released == 0 and res.skipped == 1


async def test_legacy_purchase_posting_without_item_id_still_releases(factory):
    """Seeded/legacy PURCHASE entries may carry only the orderId; the hold must still be releasable (and posted per item)."""
    seller, _, order = await delivered_order(factory)
    async with factory() as s, s.begin():
        await s.execute(text('UPDATE "LedgerEntry" SET "orderItemId" = NULL WHERE kind = \'PURCHASE\''))
    res = await release_holds_impl(factory)
    assert res.released == 1
    assert await seller_balances(factory, seller) == (0, 90_000)
    assert await scalar(factory, "SELECT COUNT(*) FROM \"LedgerEntry\" WHERE kind = 'HOLD_RELEASE' AND \"orderItemId\" IS NOT NULL") == 2
