"""SQLAlchemy 2 models mapped onto the EXISTING Prisma tables (docs/CONTRACTS.md §10).

Prisma creates quoted PascalCase tables with camelCase columns, native PostgreSQL enums and no DB-side defaults for
`id` (cuid, generated client-side) or `updatedAt` — so every INSERT from here must supply `id` (use `util.new_id()`)
and every table with `updatedAt` needs it set explicitly. Only the columns the worker needs are mapped; the schema is
never created from these models (Prisma migrations own DDL).
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, ENUM, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def pg_enum(name: str, *values: str) -> ENUM:
    return ENUM(*values, name=name, create_type=False)


OrderStatus = pg_enum("OrderStatus", "PENDING", "PAID", "PROCESSING", "DELIVERED", "DISPUTED", "REFUNDED", "CANCELLED", "FAILED")
OrderItemStatus = pg_enum("OrderItemStatus", "PENDING", "PROCESSING", "DELIVERED", "FAILED", "REFUNDED")
StockStatus = pg_enum("StockStatus", "AVAILABLE", "RESERVED", "SOLD")
DeliveryMode = pg_enum("DeliveryMode", "AUTO_STOCK", "AUTO_PROVIDER", "MANUAL")
ProductStatus = pg_enum("ProductStatus", "DRAFT", "PENDING_REVIEW", "ACTIVE", "REJECTED", "ARCHIVED")
ProductType = pg_enum("ProductType", "KEY", "ACCOUNT", "SUBSCRIPTION", "TOPUP", "GIFT_CARD", "CURRENCY", "SERVICE")
Role = pg_enum("Role", "USER", "SELLER", "ADMIN")
SellerStatus = pg_enum("SellerStatus", "PENDING", "VERIFIED", "REJECTED", "SUSPENDED")
PaymentProvider = pg_enum("PaymentProvider", "PLATEGA", "ROLLYPAY", "BALANCE", "SANDBOX")
PaymentPurpose = pg_enum("PaymentPurpose", "ORDER", "BALANCE_TOPUP")
PaymentStatus = pg_enum("PaymentStatus", "CREATED", "PENDING", "PAID", "FAILED", "CANCELLED", "EXPIRED", "REFUNDED")
LedgerAccountType = pg_enum("LedgerAccountType", "USER_BALANCE", "SELLER_HOLD", "SELLER_AVAILABLE", "PLATFORM_FEE", "EXTERNAL")
LedgerDirection = pg_enum("LedgerDirection", "DEBIT", "CREDIT")
LedgerKind = pg_enum("LedgerKind", "TOPUP", "PURCHASE", "HOLD_RELEASE", "PAYOUT", "PAYOUT_REVERSAL", "REFUND", "ADJUSTMENT")
ReviewStatus = pg_enum("ReviewStatus", "PENDING", "PUBLISHED", "HIDDEN")
DisputeStatus = pg_enum("DisputeStatus", "OPEN", "SELLER_REPLIED", "ESCALATED", "RESOLVED_REFUND", "RESOLVED_REJECTED", "CLOSED")
NotificationType = pg_enum(
    "NotificationType", "ORDER_PAID", "ORDER_DELIVERED", "ORDER_FAILED", "PRODUCT_APPROVED", "PRODUCT_REJECTED", "PAYOUT_UPDATE", "DISPUTE_UPDATE", "REVIEW_NEW", "SYSTEM"
)

Json = JSONB(none_as_null=True)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "User"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String)
    name: Mapped[str | None] = mapped_column(String)
    role: Mapped[str] = mapped_column(Role)
    balance: Mapped[int] = mapped_column(Integer, default=0)
    banned: Mapped[bool] = mapped_column(Boolean, default=False)
    createdAt: Mapped[datetime] = mapped_column(DateTime)
    updatedAt: Mapped[datetime] = mapped_column(DateTime)


class SellerProfile(Base):
    __tablename__ = "SellerProfile"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    userId: Mapped[str] = mapped_column(String)
    shopName: Mapped[str] = mapped_column(String)
    slug: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(SellerStatus)
    rating: Mapped[float] = mapped_column(Float, default=0)
    ratingCount: Mapped[int] = mapped_column(Integer, default=0)
    holdBalance: Mapped[int] = mapped_column(Integer, default=0)
    availableBalance: Mapped[int] = mapped_column(Integer, default=0)
    updatedAt: Mapped[datetime] = mapped_column(DateTime)


class Category(Base):
    __tablename__ = "Category"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    parentId: Mapped[str | None] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    slug: Mapped[str] = mapped_column(String)
    isActive: Mapped[bool] = mapped_column(Boolean, default=True)
    updatedAt: Mapped[datetime | None] = mapped_column(DateTime)


class Product(Base):
    __tablename__ = "Product"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    sellerId: Mapped[str] = mapped_column(String)
    categoryId: Mapped[str] = mapped_column(String, ForeignKey("Category.id"))
    title: Mapped[str] = mapped_column(String)
    slug: Mapped[str] = mapped_column(String)
    shortDescription: Mapped[str | None] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(ProductType)
    deliveryMode: Mapped[str] = mapped_column(DeliveryMode)
    status: Mapped[str] = mapped_column(ProductStatus)
    price: Mapped[int] = mapped_column(Integer)
    coverImage: Mapped[str | None] = mapped_column(String)
    images: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    attributes: Mapped[Any | None] = mapped_column(Json)
    salesCount: Mapped[int] = mapped_column(Integer, default=0)
    ratingAvg: Mapped[float] = mapped_column(Float, default=0)
    ratingCount: Mapped[int] = mapped_column(Integer, default=0)
    moderationNote: Mapped[str | None] = mapped_column(String)
    aiModeration: Mapped[Any | None] = mapped_column(Json)
    publishedAt: Mapped[datetime | None] = mapped_column(DateTime)
    createdAt: Mapped[datetime] = mapped_column(DateTime)
    updatedAt: Mapped[datetime] = mapped_column(DateTime)

    category: Mapped[Category] = relationship(lazy="raise")


class ProductVariant(Base):
    __tablename__ = "ProductVariant"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    productId: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    price: Mapped[int] = mapped_column(Integer)
    attributes: Mapped[Any | None] = mapped_column(Json)
    providerSku: Mapped[str | None] = mapped_column(String)


class StockItem(Base):
    __tablename__ = "StockItem"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    productId: Mapped[str] = mapped_column(String)
    variantId: Mapped[str | None] = mapped_column(String)
    payloadEnc: Mapped[str] = mapped_column(Text)
    fingerprint: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(StockStatus)
    reservedUntil: Mapped[datetime | None] = mapped_column(DateTime)
    orderItemId: Mapped[str | None] = mapped_column(String)
    soldAt: Mapped[datetime | None] = mapped_column(DateTime)
    createdAt: Mapped[datetime] = mapped_column(DateTime)


class Order(Base):
    __tablename__ = "Order"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    number: Mapped[str] = mapped_column(String)
    buyerId: Mapped[str] = mapped_column(String)
    email: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(OrderStatus)
    subtotal: Mapped[int] = mapped_column(Integer)
    discount: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer)
    fraudScore: Mapped[int | None] = mapped_column(Integer)
    ip: Mapped[str | None] = mapped_column(String)
    meta: Mapped[Any | None] = mapped_column(Json)
    paidAt: Mapped[datetime | None] = mapped_column(DateTime)
    deliveredAt: Mapped[datetime | None] = mapped_column(DateTime)
    cancelledAt: Mapped[datetime | None] = mapped_column(DateTime)
    createdAt: Mapped[datetime] = mapped_column(DateTime)
    updatedAt: Mapped[datetime] = mapped_column(DateTime)

    items: Mapped[list[OrderItem]] = relationship(back_populates="order", lazy="raise", order_by="OrderItem.createdAt, OrderItem.id")


class OrderItem(Base):
    __tablename__ = "OrderItem"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    orderId: Mapped[str] = mapped_column(String, ForeignKey("Order.id"))
    productId: Mapped[str] = mapped_column(String, ForeignKey("Product.id"))
    variantId: Mapped[str | None] = mapped_column(String, ForeignKey("ProductVariant.id"))
    sellerId: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    variantTitle: Mapped[str | None] = mapped_column(String)
    unitPrice: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    total: Mapped[int] = mapped_column(Integer)
    commissionBps: Mapped[int] = mapped_column(Integer)
    commissionAmount: Mapped[int] = mapped_column(Integer)
    sellerEarning: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(OrderItemStatus)
    meta: Mapped[Any | None] = mapped_column(Json)
    deliveryData: Mapped[Any | None] = mapped_column(Json)
    deliveredAt: Mapped[datetime | None] = mapped_column(DateTime)
    holdReleaseAt: Mapped[datetime | None] = mapped_column(DateTime)
    holdReleased: Mapped[bool] = mapped_column(Boolean, default=False)
    createdAt: Mapped[datetime] = mapped_column(DateTime)

    order: Mapped[Order] = relationship(back_populates="items", lazy="raise")
    product: Mapped[Product] = relationship(lazy="raise")
    variant: Mapped[ProductVariant | None] = relationship(lazy="raise")


class Payment(Base):
    __tablename__ = "Payment"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    orderId: Mapped[str | None] = mapped_column(String)
    userId: Mapped[str] = mapped_column(String)
    provider: Mapped[str] = mapped_column(PaymentProvider)
    purpose: Mapped[str] = mapped_column(PaymentPurpose)
    externalId: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(PaymentStatus)
    amount: Mapped[int] = mapped_column(Integer)
    method: Mapped[str | None] = mapped_column(String)
    raw: Mapped[Any | None] = mapped_column(Json)
    paidAt: Mapped[datetime | None] = mapped_column(DateTime)
    createdAt: Mapped[datetime] = mapped_column(DateTime)
    updatedAt: Mapped[datetime] = mapped_column(DateTime)


class LedgerEntry(Base):
    __tablename__ = "LedgerEntry"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    txId: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(LedgerKind)
    account: Mapped[str] = mapped_column(LedgerAccountType)
    ownerId: Mapped[str | None] = mapped_column(String)
    direction: Mapped[str] = mapped_column(LedgerDirection)
    amount: Mapped[int] = mapped_column(Integer)
    orderId: Mapped[str | None] = mapped_column(String)
    orderItemId: Mapped[str | None] = mapped_column(String)
    paymentId: Mapped[str | None] = mapped_column(String)
    payoutId: Mapped[str | None] = mapped_column(String)
    memo: Mapped[str | None] = mapped_column(String)
    createdAt: Mapped[datetime] = mapped_column(DateTime)


class Review(Base):
    __tablename__ = "Review"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    orderItemId: Mapped[str] = mapped_column(String)
    productId: Mapped[str] = mapped_column(String)
    sellerId: Mapped[str] = mapped_column(String)
    buyerId: Mapped[str] = mapped_column(String)
    rating: Mapped[int] = mapped_column(Integer)
    text: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(ReviewStatus)
    aiFlags: Mapped[Any | None] = mapped_column(Json)
    createdAt: Mapped[datetime] = mapped_column(DateTime)


class Dispute(Base):
    __tablename__ = "Dispute"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    orderId: Mapped[str] = mapped_column(String)
    orderItemId: Mapped[str | None] = mapped_column(String)
    buyerId: Mapped[str] = mapped_column(String)
    sellerId: Mapped[str] = mapped_column(String)
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(DisputeStatus)
    aiSuggestion: Mapped[Any | None] = mapped_column(Json)
    resolution: Mapped[str | None] = mapped_column(String)
    resolvedById: Mapped[str | None] = mapped_column(String)
    resolvedAt: Mapped[datetime | None] = mapped_column(DateTime)
    createdAt: Mapped[datetime] = mapped_column(DateTime)
    updatedAt: Mapped[datetime] = mapped_column(DateTime)


class DisputeMessage(Base):
    __tablename__ = "DisputeMessage"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    disputeId: Mapped[str] = mapped_column(String)
    authorId: Mapped[str | None] = mapped_column(String)
    authorRole: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(Text)
    attachments: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    createdAt: Mapped[datetime] = mapped_column(DateTime)


class Notification(Base):
    __tablename__ = "Notification"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    userId: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(NotificationType)
    title: Mapped[str] = mapped_column(String)
    body: Mapped[str | None] = mapped_column(String)
    link: Mapped[str | None] = mapped_column(String)
    data: Mapped[Any | None] = mapped_column(Json)
    readAt: Mapped[datetime | None] = mapped_column(DateTime)
    createdAt: Mapped[datetime] = mapped_column(DateTime)


class AiLog(Base):
    __tablename__ = "AiLog"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    userId: Mapped[str | None] = mapped_column(String)
    provider: Mapped[str] = mapped_column(String)
    model: Mapped[str] = mapped_column(String)
    task: Mapped[str] = mapped_column(String)
    input: Mapped[Any | None] = mapped_column(Json)
    output: Mapped[Any | None] = mapped_column(Json)
    tokensIn: Mapped[int] = mapped_column(Integer, default=0)
    tokensOut: Mapped[int] = mapped_column(Integer, default=0)
    latencyMs: Mapped[int] = mapped_column(Integer, default=0)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    error: Mapped[str | None] = mapped_column(String)
    createdAt: Mapped[datetime] = mapped_column(DateTime)


class AuditLog(Base):
    __tablename__ = "AuditLog"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    actorId: Mapped[str | None] = mapped_column(String)
    action: Mapped[str] = mapped_column(String)
    entityType: Mapped[str] = mapped_column(String)
    entityId: Mapped[str | None] = mapped_column(String)
    before: Mapped[Any | None] = mapped_column(Json)
    after: Mapped[Any | None] = mapped_column(Json)
    ip: Mapped[str | None] = mapped_column(String)
    createdAt: Mapped[datetime] = mapped_column(DateTime)


class AnalyticsEvent(Base):
    __tablename__ = "AnalyticsEvent"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    userId: Mapped[str | None] = mapped_column(String)
    sessionId: Mapped[str | None] = mapped_column(String)
    properties: Mapped[Any | None] = mapped_column(Json)
    createdAt: Mapped[datetime] = mapped_column(DateTime)


class DailyMetric(Base):
    __tablename__ = "DailyMetric"
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    gmv: Mapped[int] = mapped_column(Integer, default=0)
    platformRevenue: Mapped[int] = mapped_column(Integer, default=0)
    ordersCreated: Mapped[int] = mapped_column(Integer, default=0)
    ordersPaid: Mapped[int] = mapped_column(Integer, default=0)
    newUsers: Mapped[int] = mapped_column(Integer, default=0)
    activeUsers: Mapped[int] = mapped_column(Integer, default=0)
    sessions: Mapped[int] = mapped_column(Integer, default=0)
    refunds: Mapped[int] = mapped_column(Integer, default=0)
    avgOrderValue: Mapped[int] = mapped_column(Integer, default=0)
    data: Mapped[Any | None] = mapped_column(Json)
    createdAt: Mapped[datetime] = mapped_column(DateTime)
    updatedAt: Mapped[datetime] = mapped_column(DateTime)


class Setting(Base):
    __tablename__ = "Setting"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[Any] = mapped_column(JSONB)
    updatedById: Mapped[str | None] = mapped_column(String)
    updatedAt: Mapped[datetime] = mapped_column(DateTime)
