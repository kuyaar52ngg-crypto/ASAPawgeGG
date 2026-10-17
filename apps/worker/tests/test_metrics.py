from datetime import datetime, timedelta

from sqlalchemy import text

from app.jobs.fulfill import fulfill_order_impl
from app.jobs.metrics import aggregate_daily_metrics_impl, compute_day
from app.util import new_id, utcnow

from .factories import make_category, make_paid_order, make_product, make_stock, make_user
from .test_fulfill import q, scalar


async def test_daily_metrics_match_contract_definitions(factory):
    now = utcnow()
    async with factory() as s, s.begin():
        seller, buyer, cat = await make_user(s, "SELLER"), await make_user(s, created_at=now), await make_category(s)
        prod = await make_product(s, seller, cat, price=100_000)
        await make_stock(s, prod, ["a", "b", "c"])
        paid1 = await make_paid_order(s, buyer, [{"product": prod}], paid_ago=timedelta(minutes=2))
        paid2 = await make_paid_order(s, buyer, [{"product": prod, "quantity": 2}], paid_ago=timedelta(minutes=1))
        await make_paid_order(s, buyer, [{"product": prod}], status="PENDING", paid_ago=timedelta(minutes=1))
        await s.execute(
            text(
                """INSERT INTO "AnalyticsEvent" (id, name, "userId", "sessionId", "createdAt") VALUES
                   (:a, 'page_view', NULL, 's1', :t), (:b, 'page_view', NULL, 's2', :t), (:c, 'purchase', :u, 's1', :t)"""
            ),
            {"a": new_id(), "b": new_id(), "c": new_id(), "t": now, "u": buyer.id},
        )
    for oid in (paid1.id, paid2.id):
        await fulfill_order_impl(factory, oid)
    async with factory() as s:
        m = await compute_day(s, now.date())
    assert m["ordersPaid"] == 2 and m["gmv"] == 300_000 and m["platformRevenue"] == 30_000
    assert m["ordersCreated"] == 3 and m["avgOrderValue"] == 150_000
    assert m["sessions"] == 2 and m["newUsers"] >= 2
    assert m["activeUsers"] == 3  # anonymous sessions s1, s2 + the buyer (user id), deduplicated by key
    assert m["data"]["funnel"] == {"page_view": 2, "purchase": 1}
    assert m["data"]["topProducts"][0]["qty"] == 3 and m["data"]["topSellers"][0]["revenue"] == 300_000


async def test_aggregate_upserts_without_duplicates(factory):
    first = await aggregate_daily_metrics_impl(factory)
    second = await aggregate_daily_metrics_impl(factory)
    assert first == second and len(first) == 2
    assert await scalar(factory, 'SELECT COUNT(*) FROM "DailyMetric"') == 2


async def test_refunds_counted_on_paid_day_and_gmv_excludes_refunded(factory):
    now = utcnow()
    async with factory() as s, s.begin():
        seller, buyer, cat = await make_user(s, "SELLER"), await make_user(s), await make_category(s)
        prod = await make_product(s, seller, cat, price=100_000)  # no stock -> auto refund
        order = await make_paid_order(s, buyer, [{"product": prod}])
    await fulfill_order_impl(factory, order.id)
    async with factory() as s:
        m = await compute_day(s, now.date())
    assert m["gmv"] == 0 and m["ordersPaid"] == 0 and m["refunds"] == 100_000


async def test_explicit_day(factory):
    day = (utcnow() - timedelta(days=40)).date()
    assert await aggregate_daily_metrics_impl(factory, days=[day]) == [day.isoformat()]
    assert await scalar(factory, 'SELECT "ordersPaid" FROM "DailyMetric" WHERE date = :d', d=day) == 0
    assert isinstance(datetime.now(), datetime)
