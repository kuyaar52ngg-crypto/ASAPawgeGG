"""Row builders for DB tests (mirror what web writes at checkout / payment time)."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto import encrypt_stock, parse_key, stock_fingerprint
from app.ledger import post_ledger, purchase_lines, topup_lines
from app.models import Category, Order, OrderItem, Product, ProductVariant, SellerProfile, StockItem, User
from app.util import new_id, utcnow

KEY = parse_key("ZGV2LW9ubHktc3RvY2sta2V5LTMyLWJ5dGVzLWxvbiE=")


async def make_user(s: AsyncSession, role: str = "USER", email: str | None = None, balance: int = 0, created_at: datetime | None = None) -> User:
    now = created_at or utcnow()
    u = User(id=new_id(), email=email or f"{new_id()}@example.com", name="T", role=role, balance=balance, banned=False, createdAt=now, updatedAt=now)
    s.add(u)
    await s.flush()
    if role in ("SELLER", "ADMIN"):
        s.add(SellerProfile(id=new_id(), userId=u.id, shopName=f"Shop {u.id[-4:]}", slug=f"shop-{u.id}", status="VERIFIED", rating=0, ratingCount=0, holdBalance=0, availableBalance=0, updatedAt=now))
    await s.flush()
    return u


async def make_category(s: AsyncSession, slug: str = "steam-keys", name: str = "Steam ключи") -> Category:
    c = Category(id=new_id(), name=name, slug=slug, isActive=True, updatedAt=utcnow())
    s.add(c)
    await s.flush()
    return c


async def make_product(
    s: AsyncSession, seller: User, category: Category, *, mode: str = "AUTO_STOCK", ptype: str = "KEY", status: str = "ACTIVE", price: int = 100_000,
    title: str = "Test Game Key", description: str = "Лицензионный ключ активации для Steam. Мгновенная выдача после оплаты. Регион: Россия и СНГ. Инструкция по активации в заказе.",
    images: list[str] | None = None, tags: list[str] | None = None,
) -> Product:
    now = utcnow()
    p = Product(
        id=new_id(), sellerId=seller.id, categoryId=category.id, title=title, slug=f"p-{new_id()}", shortDescription="Ключ Steam", description=description, type=ptype,
        deliveryMode=mode, status=status, price=price, coverImage=None, images=images if images is not None else ["https://picsum.photos/seed/x/600/400"], tags=tags or ["steam", "key"],
        attributes=None, salesCount=0, ratingAvg=0, ratingCount=0, createdAt=now, updatedAt=now,
    )
    s.add(p)
    await s.flush()
    return p


async def make_stock(s: AsyncSession, product: Product, plaintexts: list[str], *, variant: ProductVariant | None = None, key: bytes = KEY) -> list[StockItem]:
    out = []
    for i, pt in enumerate(plaintexts):
        st = StockItem(
            id=new_id(), productId=product.id, variantId=variant.id if variant else None, payloadEnc=encrypt_stock(pt, key), fingerprint=stock_fingerprint(pt) + str(i),
            status="AVAILABLE", createdAt=utcnow() + timedelta(milliseconds=i),
        )
        s.add(st)
        out.append(st)
    await s.flush()
    return out


async def make_paid_order(
    s: AsyncSession, buyer: User, lines: list[dict[str, Any]], *, status: str = "PAID", paid_ago: timedelta = timedelta(minutes=5), commission_bps: int = 1000, post_purchase: bool = True,
) -> Order:
    """lines: [{product, quantity?, variant?, meta?}] — creates Order+OrderItems, reserves stock (AUTO_STOCK), funds the buyer through the
    ledger (TOPUP) and posts PURCHASE per item exactly like web `markPaid`."""
    now = utcnow()
    order = Order(
        id=new_id(), number=f"AG-T-{new_id()[-6:].upper()}", buyerId=buyer.id, email=buyer.email, status=status, subtotal=0, discount=0, total=0, createdAt=now - paid_ago,
        updatedAt=now - paid_ago, paidAt=now - paid_ago if status != "PENDING" else None, meta=None,
    )
    s.add(order)
    await s.flush()
    total = 0
    items = []
    for ln in lines:
        prod: Product = ln["product"]
        qty = ln.get("quantity", 1)
        unit = ln.get("unit_price", prod.price)
        t = unit * qty
        fee = (t * commission_bps + 5000) // 10000
        item = OrderItem(
            id=new_id(), orderId=order.id, productId=prod.id, variantId=ln["variant"].id if ln.get("variant") else None, sellerId=prod.sellerId, title=prod.title,
            variantTitle=None, unitPrice=unit, quantity=qty, total=t, commissionBps=commission_bps, commissionAmount=fee, sellerEarning=t - fee, status="PENDING",
            meta=ln.get("meta"), deliveryData=None, holdReleased=False, createdAt=now - paid_ago + timedelta(milliseconds=len(items)),
        )
        s.add(item)
        await s.flush()
        items.append(item)
        total += t
        if prod.deliveryMode == "AUTO_STOCK":
            rows = (
                await s.execute(
                    text(
                        'SELECT id FROM "StockItem" WHERE "productId" = :p AND status = \'AVAILABLE\' AND "variantId" IS NOT DISTINCT FROM :v ORDER BY "createdAt", id LIMIT :n FOR UPDATE SKIP LOCKED'
                    ),
                    {"p": prod.id, "v": item.variantId, "n": qty},
                )
            ).all()
            if rows:
                await s.execute(text('UPDATE "StockItem" SET status = \'RESERVED\', "orderItemId" = :i WHERE id = ANY(:ids)'), {"i": item.id, "ids": [r[0] for r in rows]})
    order.subtotal = order.total = total
    await s.flush()
    if post_purchase and status != "PENDING":
        await post_ledger(s, kind="TOPUP", lines=topup_lines(buyer.id, total), order_id=order.id)
        for item in items:
            await post_ledger(
                s,
                kind="PURCHASE",
                lines=purchase_lines(buyer_id=buyer.id, seller_id=item.sellerId, total=item.total, seller_earning=item.sellerEarning, commission_amount=item.commissionAmount),
                order_id=order.id,
                order_item_id=item.id,
            )
    await s.flush()
    return order
