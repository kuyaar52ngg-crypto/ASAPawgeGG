from datetime import timedelta

from sqlalchemy import text

from app.jobs.maintenance import expire_pending_orders_impl, expire_reservations_impl, sweep_stuck_paid_orders_impl
from app.util import utcnow

from .factories import make_category, make_paid_order, make_product, make_stock, make_user
from .test_fulfill import q, scalar


async def pending_order(factory, *, age=timedelta(minutes=45), stock=2):
    async with factory() as s, s.begin():
        seller, buyer, cat = await make_user(s, "SELLER"), await make_user(s), await make_category(s)
        prod = await make_product(s, seller, cat)
        await make_stock(s, prod, [f"K{i}" for i in range(stock)])
        order = await make_paid_order(s, buyer, [{"product": prod}], status="PENDING", paid_ago=age)
        await s.execute(
            text(
                """INSERT INTO "Payment" (id, "orderId", "userId", provider, purpose, status, amount, "createdAt", "updatedAt")
                   VALUES ('pay1', :o, :u, 'SANDBOX', 'ORDER', 'PENDING', 100000, now(), now())"""
            ),
            {"o": order.id, "u": buyer.id},
        )
        await s.execute(text("UPDATE \"StockItem\" SET \"reservedUntil\" = :t WHERE status = 'RESERVED'"), {"t": utcnow() - timedelta(minutes=1)})
    return order


async def test_expired_pending_order_is_cancelled_and_stock_freed(factory):
    order = await pending_order(factory)
    res = await expire_reservations_impl(factory)
    assert res["cancelledOrders"] == 1
    o = (await q(factory, 'SELECT status, "cancelledAt" FROM "Order" WHERE id = :o', o=order.id))[0]
    assert o[0] == "CANCELLED" and o[1] is not None
    assert await scalar(factory, "SELECT COUNT(*) FROM \"StockItem\" WHERE status = 'AVAILABLE' AND \"orderItemId\" IS NULL") == 2
    assert await scalar(factory, 'SELECT status FROM "Payment" WHERE id = \'pay1\'') == "CANCELLED"
    again = await expire_reservations_impl(factory)
    assert again == {"cancelledOrders": 0, "releasedReservations": 0}


async def test_fresh_pending_order_is_kept(factory):
    order = await pending_order(factory, age=timedelta(minutes=5))
    async with factory() as s, s.begin():  # reservation still valid
        await s.execute(text("UPDATE \"StockItem\" SET \"reservedUntil\" = now() + interval '20 minutes' WHERE status = 'RESERVED'"))
    assert await expire_pending_orders_impl(factory) == 0
    res = await expire_reservations_impl(factory)
    assert res == {"cancelledOrders": 0, "releasedReservations": 0}
    assert await scalar(factory, 'SELECT status FROM "Order" WHERE id = :o', o=order.id) == "PENDING"


async def test_paid_orders_never_lose_their_reservation(factory):
    async with factory() as s, s.begin():
        seller, buyer, cat = await make_user(s, "SELLER"), await make_user(s), await make_category(s)
        prod = await make_product(s, seller, cat)
        await make_stock(s, prod, ["K1"])
        await make_paid_order(s, buyer, [{"product": prod}], status="PAID", paid_ago=timedelta(hours=2))
        await s.execute(text("UPDATE \"StockItem\" SET \"reservedUntil\" = now() - interval '1 hour' WHERE status = 'RESERVED'"))
    res = await expire_reservations_impl(factory)
    assert res["releasedReservations"] == 0
    assert await scalar(factory, "SELECT COUNT(*) FROM \"StockItem\" WHERE status = 'RESERVED'") == 1


async def test_orphan_expired_reservation_is_released(factory):
    async with factory() as s, s.begin():
        seller, cat = await make_user(s, "SELLER"), await make_category(s)
        prod = await make_product(s, seller, cat)
        (st,) = await make_stock(s, prod, ["K1"])
        await s.execute(text("UPDATE \"StockItem\" SET status = 'RESERVED', \"reservedUntil\" = now() - interval '1 minute' WHERE id = :i"), {"i": st.id})
    assert (await expire_reservations_impl(factory))["releasedReservations"] == 1


async def test_sweeper_fulfills_stuck_paid_orders(factory):
    async with factory() as s, s.begin():
        seller, buyer, cat = await make_user(s, "SELLER"), await make_user(s), await make_category(s)
        prod = await make_product(s, seller, cat)
        await make_stock(s, prod, ["K1", "K2"])
        stuck = await make_paid_order(s, buyer, [{"product": prod}], paid_ago=timedelta(minutes=10))
        fresh = await make_paid_order(s, buyer, [{"product": prod}], paid_ago=timedelta(seconds=5))
    assert await sweep_stuck_paid_orders_impl(factory) == 1
    assert await scalar(factory, 'SELECT status FROM "Order" WHERE id = :o', o=stuck.id) == "DELIVERED"
    assert await scalar(factory, 'SELECT status FROM "Order" WHERE id = :o', o=fresh.id) == "PAID"
    assert await sweep_stuck_paid_orders_impl(factory) == 0
