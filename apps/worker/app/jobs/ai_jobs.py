"""AI jobs: ai_moderate_product, ai_score_fraud (alias ai_fraud_score_order), ai_moderate_review, ai_dispute_suggestion.

Each job: load facts (short read tx) -> ask the provider chain / heuristic (`ai.router.run_json_task`, writes AiLog) -> apply
the verdict in one write tx under a row lock. All jobs are idempotent (re-running recomputes and overwrites the verdict).
Statuses are only changed where the contract says so; advisory outputs never touch money.
"""
from __future__ import annotations

import json
import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai import AiResult, LLMProvider, run_json_task
from ..ai import disputes as disputes_ai
from ..ai import fraud as fraud_ai
from ..ai import moderation as mod_ai
from ..ai import reviews as reviews_ai
from ..config import get_settings
from ..db import SessionFactory, session_scope
from ..models import Category, Dispute, DisputeMessage, Order, OrderItem, Product, Review
from ..notifications import notify, notify_admins, write_audit
from ..settings_store import AI_AUTO_PUBLISH, AI_AUTO_REJECT, get_int_setting
from ..util import utcnow

log = logging.getLogger("worker.ai")


def _meta(res: AiResult) -> dict[str, Any]:
    return {"provider": res.provider, "model": res.model, "mock": res.mock, "checkedAt": utcnow().isoformat()}


# ─────────────────────────── product moderation ───────────────────────────


async def ai_moderate_product_impl(factory: SessionFactory, product_id: str, *, chain: list[LLMProvider] | None = None) -> dict[str, Any]:
    async with factory() as s:
        row = (
            await s.execute(select(Product, Category).join(Category, Category.id == Product.categoryId).where(Product.id == product_id))
        ).first()
        if row is None:
            return {"ok": False, "error": "product_not_found"}
        p, cat = row
        cats = [(c.slug, c.name) for c in (await s.execute(select(Category).where(Category.isActive.is_(True)).order_by(Category.slug))).scalars()]
        facts = mod_ai.ProductFacts(
            title=p.title, description=p.description, short_description=p.shortDescription, price=p.price, type=p.type, category_name=cat.name,
            category_slug=cat.slug, tags=list(p.tags or []), image_count=len(p.images or []) + (1 if p.coverImage else 0), delivery_mode=p.deliveryMode,
        )
        threshold = await get_int_setting(s, AI_AUTO_PUBLISH, get_settings().ai_auto_publish_threshold)
        reject_below = await get_int_setting(s, AI_AUTO_REJECT, 20)

    slugs = {slug for slug, _ in cats}
    res = await run_json_task(
        factory,
        task="moderation",
        system=mod_ai.SYSTEM,
        user=mod_ai.product_prompt(facts, cats),
        normalize=lambda raw: mod_ai.normalize_moderation(raw, slugs),
        heuristic=lambda: mod_ai.heuristic_moderation(facts, cats),
        log_input={"productId": product_id, "title": facts.title, "type": facts.type, "price": facts.price, "descriptionLength": len(facts.description)},
        chain=chain,
    )
    v = mod_ai.apply_hard_rules(facts, res.data)  # an LLM (or an injected description) can never override the prohibited-content rules
    approved = v["verdict"] == "approve" and v["score"] >= threshold

    async with session_scope(factory) as s:
        prod = (await s.execute(select(Product).where(Product.id == product_id).with_for_update())).scalar_one()
        now = utcnow()
        decision = "recorded"
        values: dict[str, Any] = {
            "aiModeration": {**v, "approved": approved, "threshold": threshold, **_meta(res)},
            "updatedAt": now,
        }
        if prod.status == "PENDING_REVIEW":
            if approved:
                values.update(status="ACTIVE", publishedAt=prod.publishedAt or now, moderationNote=f"Одобрено AI (оценка {v['score']})")
                decision = "approved"
                await notify(s, prod.sellerId, type="PRODUCT_APPROVED", title="Товар опубликован", body=f"«{prod.title}» прошёл модерацию и доступен покупателям.", link="/seller/products")
            elif v["verdict"] == "reject" and v["score"] <= reject_below:
                note = "; ".join(v["reasons"]) or "Не прошёл автоматическую модерацию"
                values.update(status="REJECTED", moderationNote=note[:500])
                decision = "rejected"
                await notify(s, prod.sellerId, type="PRODUCT_REJECTED", title="Товар отклонён", body=f"«{prod.title}»: {note[:300]}", link="/seller/products")
            else:
                decision = "needs_review"
        await s.execute(update(Product).where(Product.id == product_id).values(**values))
        await write_audit(s, action="product.ai_moderation", entity_type="Product", entity_id=product_id, after={"decision": decision, "score": v["score"], "verdict": v["verdict"], "provider": res.provider, "mock": res.mock})
    return {"ok": True, "decision": decision, "score": v["score"], "verdict": v["verdict"], "suggestedCategory": v.get("suggested_category"), "provider": res.provider, "mock": res.mock}


# ─────────────────────────── fraud scoring ───────────────────────────


async def collect_fraud_features(s: AsyncSession, order_id: str) -> tuple[Order, fraud_ai.FraudFeatures] | None:
    order = (await s.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if order is None:
        return None
    u = (await s.execute(text('SELECT email, "createdAt" FROM "User" WHERE id = :id'), {"id": order.buyerId})).one()
    email, user_created = str(u[0]), u[1]
    age_h = max(0.0, (order.createdAt - user_created).total_seconds() / 3600)
    async def count(sql: str, params: dict[str, Any]) -> int:
        return int((await s.execute(text(sql), params)).scalar_one() or 0)

    prev = await count('SELECT COUNT(*) FROM "Order" WHERE "buyerId" = :b AND id <> :o AND "paidAt" IS NOT NULL', {"b": order.buyerId, "o": order.id})
    last_hour = await count('SELECT COUNT(*) FROM "Order" WHERE "buyerId" = :b AND "createdAt" > :t AND "createdAt" <= :c', {"b": order.buyerId, "t": order.createdAt - timedelta(hours=1), "c": order.createdAt})
    failed = await count(
        """SELECT COUNT(*) FROM "Payment" WHERE "userId" = :b AND status IN ('FAILED', 'CANCELLED', 'EXPIRED') AND "createdAt" > :t""",
        {"b": order.buyerId, "t": order.createdAt - timedelta(hours=24)},
    )
    bad = await count(
        """SELECT COUNT(*) FROM "Order" WHERE "buyerId" = :b AND id <> :o AND (status = 'REFUNDED' OR EXISTS (SELECT 1 FROM "Dispute" d WHERE d."orderId" = "Order".id))""",
        {"b": order.buyerId, "o": order.id},
    )
    same_ip = (
        await count('SELECT COUNT(DISTINCT "buyerId") FROM "Order" WHERE ip = :ip AND "createdAt" > :t', {"ip": order.ip, "t": order.createdAt - timedelta(hours=24)}) if order.ip else 0
    )
    types = [r[0] for r in await s.execute(text('SELECT DISTINCT p.type::text FROM "OrderItem" oi JOIN "Product" p ON p.id = oi."productId" WHERE oi."orderId" = :o'), {"o": order.id})]
    n_items = await count('SELECT COALESCE(SUM(quantity), 0) FROM "OrderItem" WHERE "orderId" = :o', {"o": order.id})
    via_balance = await count('SELECT COUNT(*) FROM "Payment" WHERE "orderId" = :o AND provider = \'BALANCE\'', {"o": order.id}) > 0
    domain = email.rsplit("@", 1)[-1].lower() if "@" in email else ""
    feats = fraud_ai.FraudFeatures(
        total=order.total, item_count=n_items, account_age_hours=round(age_h, 1), previous_orders=prev, orders_last_hour=last_hour, failed_payments_24h=failed,
        refunded_or_disputed=bad, accounts_on_ip_24h=same_ip, disposable_email=domain in fraud_ai.DISPOSABLE_DOMAINS,
        high_risk_items=any(t in fraud_ai.HIGH_RISK_TYPES for t in types), paid_with_balance=via_balance, promo_used=False,
    )
    return order, feats


async def ai_score_fraud_impl(factory: SessionFactory, order_id: str, *, chain: list[LLMProvider] | None = None) -> dict[str, Any]:
    async with factory() as s:
        got = await collect_fraud_features(s, order_id)
        if got is None:
            return {"ok": False, "error": "order_not_found"}
        order, feats = got
        promo = (await s.execute(text('SELECT "promoCodeId" IS NOT NULL FROM "Order" WHERE id = :o'), {"o": order_id})).scalar_one()
        feats.promo_used = bool(promo)
        prev_score = order.fraudScore
    rule = fraud_ai.heuristic_fraud(feats)
    res = await run_json_task(
        factory,
        task="fraud",
        system=fraud_ai.SYSTEM,
        user=fraud_ai.fraud_prompt(feats),
        normalize=fraud_ai.normalize_fraud,
        heuristic=lambda: rule,
        log_input={"orderId": order_id, "features": feats.as_dict()},
        chain=chain,
    )
    final = fraud_ai.blend(rule, None if res.mock else res.data)
    reasons = list(dict.fromkeys([*rule["reasons"], *res.data["reasons"]]))[:8]
    info = {"score": final, "risk": fraud_ai.risk_label(final), "reasons": reasons, "ruleScore": rule["score"], **_meta(res)}
    async with session_scope(factory) as s:
        await s.execute(
            text(
                """UPDATE "Order" SET "fraudScore" = :score, "updatedAt" = :now,
                   meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('fraud', CAST(:info AS jsonb)) WHERE id = :id"""
            ),
            {"score": final, "now": utcnow(), "id": order_id, "info": json.dumps(info)},
        )
        if final >= 70 and (prev_score is None or prev_score < 70):
            await write_audit(s, action="order.fraud_flag", entity_type="Order", entity_id=order_id, after={"score": final, "reasons": reasons})
            await notify_admins(s, title=f"Подозрительный заказ {order.number}", body=f"Фрод-оценка {final}/100: {'; '.join(reasons[:3])}", link=f"/admin/orders/{order_id}")
    return {"ok": True, "score": final, "risk": info["risk"], "provider": res.provider, "mock": res.mock}


# ─────────────────────────── review moderation ───────────────────────────


async def recompute_ratings(s: AsyncSession, product_id: str, seller_id: str) -> None:
    """Same maths as web `recomputeRatings`: PUBLISHED reviews only, rounded to one decimal."""
    now = utcnow()
    await s.execute(
        text(
            """UPDATE "Product" SET "ratingAvg" = COALESCE((SELECT ROUND(AVG(rating)::numeric, 1) FROM "Review" WHERE "productId" = :p AND status = 'PUBLISHED'), 0),
                 "ratingCount" = (SELECT COUNT(*) FROM "Review" WHERE "productId" = :p AND status = 'PUBLISHED'), "updatedAt" = :now WHERE id = :p"""
        ),
        {"p": product_id, "now": now},
    )
    await s.execute(
        text(
            """UPDATE "SellerProfile" SET rating = COALESCE((SELECT ROUND(AVG(rating)::numeric, 1) FROM "Review" WHERE "sellerId" = :u AND status = 'PUBLISHED'), 0),
                 "ratingCount" = (SELECT COUNT(*) FROM "Review" WHERE "sellerId" = :u AND status = 'PUBLISHED'), "updatedAt" = :now WHERE "userId" = :u"""
        ),
        {"u": seller_id, "now": now},
    )


async def ai_moderate_review_impl(factory: SessionFactory, review_id: str, *, chain: list[LLMProvider] | None = None) -> dict[str, Any]:
    async with factory() as s:
        row = (await s.execute(select(Review, Product.title).join(Product, Product.id == Review.productId).where(Review.id == review_id))).first()
        if row is None:
            return {"ok": False, "error": "review_not_found"}
        review, title = row
        text_, rating = review.text, review.rating
    res = await run_json_task(
        factory,
        task="review_moderation",
        system=reviews_ai.SYSTEM,
        user=reviews_ai.review_prompt(text_, rating, title),
        normalize=reviews_ai.normalize_review,
        heuristic=lambda: reviews_ai.heuristic_review(text_, rating),
        log_input={"reviewId": review_id, "rating": rating, "textLength": len(text_ or "")},
        chain=chain,
    )
    v = res.data
    hidden = False
    async with session_scope(factory) as s:
        rev = (await s.execute(select(Review).where(Review.id == review_id).with_for_update())).scalar_one()
        values: dict[str, Any] = {"aiFlags": {**v, **_meta(res)}}
        if v["action"] == "hide" and rev.status == "PUBLISHED":  # never overrides an admin's decision (HIDDEN stays, PENDING untouched)
            values["status"] = "HIDDEN"
            hidden = True
        await s.execute(update(Review).where(Review.id == review_id).values(**values))
        if hidden:
            await recompute_ratings(s, rev.productId, rev.sellerId)
            await notify(s, rev.buyerId, type="SYSTEM", title="Отзыв скрыт модерацией", body="Отзыв нарушает правила площадки: " + ("; ".join(v["reasons"]) or "см. правила"), link="/account/reviews")
            await write_audit(s, action="review.ai_hide", entity_type="Review", entity_id=review_id, after={"categories": v["categories"], "severity": v["severity"], "provider": res.provider, "mock": res.mock})
    return {"ok": True, "flagged": v["flagged"], "hidden": hidden, "categories": v["categories"], "provider": res.provider, "mock": res.mock}


# ─────────────────────────── dispute suggestion ───────────────────────────


async def ai_dispute_suggestion_impl(factory: SessionFactory, dispute_id: str, *, chain: list[LLMProvider] | None = None) -> dict[str, Any]:
    async with factory() as s:
        d = (await s.execute(select(Dispute).where(Dispute.id == dispute_id))).scalar_one_or_none()
        if d is None:
            return {"ok": False, "error": "dispute_not_found"}
        item = (await s.execute(select(OrderItem, Product.deliveryMode).join(Product, Product.id == OrderItem.productId).where(OrderItem.id == d.orderItemId))).first() if d.orderItemId else None
        if item is None:  # dispute on the whole order: use its first item
            item = (await s.execute(select(OrderItem, Product.deliveryMode).join(Product, Product.id == OrderItem.productId).where(OrderItem.orderId == d.orderId).order_by(OrderItem.createdAt).limit(1))).first()
        msgs = [(m.authorRole, m.body) for m in (await s.execute(select(DisputeMessage).where(DisputeMessage.disputeId == dispute_id).order_by(DisputeMessage.createdAt))).scalars()]
        stock_n = 0
        if item is not None:
            stock_n = int((await s.execute(text('SELECT COUNT(*) FROM "StockItem" WHERE "orderItemId" = :i AND status = \'SOLD\''), {"i": item[0].id})).scalar_one())
        recent = int((await s.execute(select(func.count()).select_from(Dispute).where(Dispute.buyerId == d.buyerId, Dispute.createdAt > utcnow() - timedelta(days=90)))).scalar_one())
        oi, mode = (item[0], item[1]) if item else (None, None)
        facts = disputes_ai.DisputeFacts(
            reason=d.reason, item_title=oi.title if oi else None, item_status=oi.status if oi else None, delivery_mode=mode,
            delivered=bool(oi and oi.status == "DELIVERED"), has_stock_attached=stock_n > 0 or bool(oi and isinstance(oi.deliveryData, dict) and oi.deliveryData.get("message")) or mode == "AUTO_PROVIDER",
            hours_since_delivery=round((utcnow() - oi.deliveredAt).total_seconds() / 3600, 1) if oi and oi.deliveredAt else None, total=oi.total if oi else None,
            messages=msgs, seller_replied=any(r == "SELLER" for r, _ in msgs), buyer_disputes_90d=recent,
        )
    res = await run_json_task(
        factory,
        task="dispute",
        system=disputes_ai.SYSTEM,
        user=disputes_ai.dispute_prompt(facts),
        normalize=disputes_ai.normalize_dispute,
        heuristic=lambda: disputes_ai.heuristic_dispute(facts),
        log_input={"disputeId": dispute_id, "messages": len(facts.messages), "itemStatus": facts.item_status},
        chain=chain,
    )
    stored = {**res.data, "provider": res.provider, "model": res.model, "mock": res.mock, "generatedAt": utcnow().isoformat()}
    async with session_scope(factory) as s:
        await s.execute(update(Dispute).where(Dispute.id == dispute_id).values(aiSuggestion=stored, updatedAt=utcnow()))
        await write_audit(s, action="dispute.ai_advice", entity_type="Dispute", entity_id=dispute_id, after={"recommendation": res.data["recommendation"], "provider": res.provider, "mock": res.mock})
    return {"ok": True, "recommendation": res.data["recommendation"], "confidence": res.data["confidence"], "provider": res.provider, "mock": res.mock}
