import json
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import text

from app.ai import ChatMessage, LLMError, LLMProvider, LLMResult, build_chain, extract_json_object
from app.ai import fraud as fraud_ai
from app.ai import moderation as mod_ai
from app.ai.providers import AnthropicProvider, OpenAICompatProvider
from app.config import Settings
from app.jobs.ai_jobs import ai_dispute_suggestion_impl, ai_moderate_product_impl, ai_moderate_review_impl, ai_score_fraud_impl
from app.util import new_id, utcnow

from .factories import make_category, make_paid_order, make_product, make_stock, make_user
from .test_fulfill import q, scalar

# ───────────── pure helpers ─────────────


def test_extract_json_object_variants():
    assert extract_json_object('{"a": 1}') == {"a": 1}
    assert extract_json_object('```json\n{"a": {"b": "}"}}\n```') == {"a": {"b": "}"}}
    assert extract_json_object('Вот результат: {"score": 90, "reasons": ["ok"]} Спасибо!')["score"] == 90
    with pytest.raises(LLMError):
        extract_json_object("no json here")


def settings(**kw):
    base = {"ai_provider": "", "openai_api_key": "", "anthropic_api_key": "", "openrouter_api_key": "", "ai_model": ""}
    return Settings.model_construct(**{**Settings().model_dump(), **base, **kw})


def test_chain_selection_and_fallback_order():
    assert build_chain(settings(), "mock", None) == []
    assert build_chain(settings(), "openai", None) == []  # no keys -> heuristics
    s = settings(openai_api_key="o", anthropic_api_key="a", openrouter_api_key="r")
    assert [p.name for p in build_chain(s, "anthropic", None)] == ["anthropic", "openai", "openrouter"]
    assert [p.name for p in build_chain(s, "", None)] == ["openai", "anthropic", "openrouter"]
    only_or = build_chain(settings(openrouter_api_key="r"), "openai", "meta/llama")
    assert [p.name for p in only_or] == ["openrouter"] and only_or[0].model == "openai/gpt-4o-mini"  # model override is for the preferred provider only
    pref = build_chain(s, "openrouter", "anthropic/claude-3.5-sonnet")
    assert pref[0].name == "openrouter" and pref[0].model == "anthropic/claude-3.5-sonnet" and pref[1].model == "gpt-4o-mini"
    assert pref[0].base_url == "https://openrouter.ai/api/v1"


async def test_openai_compatible_and_anthropic_wire_formats():
    seen: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen[str(req.url)] = (dict(req.headers), json.loads(req.content))
        if "anthropic" in req.url.host:
            return httpx.Response(200, json={"model": "claude-x", "content": [{"type": "text", "text": '{"ok": true}'}], "usage": {"input_tokens": 11, "output_tokens": 5}})
        return httpx.Response(200, json={"model": "gpt-x", "choices": [{"message": {"content": '{"ok": true}'}}], "usage": {"prompt_tokens": 7, "completion_tokens": 3}})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    msgs = [ChatMessage("system", "SYS"), ChatMessage("user", "hi")]
    r = await OpenAICompatProvider("openrouter", "K", "m/x", base_url="https://openrouter.ai/api/v1", client=client).chat(msgs, json_mode=True)
    assert (r.provider, r.tokens_in, r.tokens_out) == ("openrouter", 7, 3)
    h, body = seen["https://openrouter.ai/api/v1/chat/completions"]
    assert h["authorization"] == "Bearer K" and body["response_format"] == {"type": "json_object"} and body["messages"][0]["role"] == "system" and "x-title" in h
    a = await AnthropicProvider("AK", "claude-haiku-4-5", client=client).chat(msgs, json_mode=True)
    assert (a.provider, a.tokens_in) == ("anthropic", 11)
    h, body = seen["https://api.anthropic.com/v1/messages"]
    assert h["x-api-key"] == "AK" and "anthropic-version" in h and body["messages"] == [{"role": "user", "content": "hi"}] and "SYS" in body["system"]


async def test_provider_errors_are_llmerrors():
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(429, text="rate limited")))
    with pytest.raises(LLMError):
        await OpenAICompatProvider("openai", "K", "m", base_url="https://api.openai.com/v1", client=client).chat([ChatMessage("user", "x")])
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"choices": []})))
    with pytest.raises(LLMError):
        await OpenAICompatProvider("openai", "K", "m", base_url="https://api.openai.com/v1", client=client).chat([ChatMessage("user", "x")])


# ───────────── heuristics ─────────────

CATS = [("steam-keys", "Steam ключи"), ("podpiski", "Подписки"), ("giftcards", "Подарочные карты")]


def facts(**kw):
    base = dict(
        title="Cyberpunk 2077 — ключ Steam", description="Лицензионный ключ активации Steam для игры. Мгновенная выдача после оплаты, регион Россия и СНГ. " * 2,
        short_description="Ключ Steam", price=199_900, type="KEY", category_name="Steam ключи", category_slug="steam-keys", tags=["steam", "rpg"], image_count=1, delivery_mode="AUTO_STOCK",
    )
    return mod_ai.ProductFacts(**{**base, **kw})


def test_heuristic_approves_clean_listing():
    v = mod_ai.heuristic_moderation(facts(), CATS)
    assert v["verdict"] == "approve" and v["score"] >= 80 and v["reasons"] == []


@pytest.mark.parametrize(
    ("kw", "verdict"),
    [
        ({"description": "Продаю краденые аккаунты Steam, дёшево и быстро, пишите"}, "reject"),
        ({"description": "Ключ Steam. Пиши в телеграм @cheap_keys или https://t.me/cheap"}, "review"),
        ({"description": "ключ"}, "review"),
        ({"image_count": 0, "description": "Короткое описание"}, "review"),
    ],
)
def test_heuristic_flags_bad_listings(kw, verdict):
    v = mod_ai.heuristic_moderation(facts(**kw), CATS)
    assert v["verdict"] == verdict and v["reasons"]


def test_heuristic_suggests_better_category():
    v = mod_ai.heuristic_moderation(facts(title="Подарочные карты Steam пополнение", category_slug="podpiski", category_name="Подписки", tags=[], description="Подарочные карты для пополнения " * 5), CATS)
    assert v["suggested_category"] == "giftcards" and v["verdict"] == "review"


def test_fraud_heuristic_scales_with_risk():
    low = fraud_ai.FraudFeatures(total=100_000, item_count=1, account_age_hours=500, previous_orders=5, orders_last_hour=1, failed_payments_24h=0, refunded_or_disputed=0, accounts_on_ip_24h=1, disposable_email=False, high_risk_items=False, paid_with_balance=True, promo_used=False)
    high = fraud_ai.FraudFeatures(total=2_000_000, item_count=6, account_age_hours=0.2, previous_orders=0, orders_last_hour=6, failed_payments_24h=4, refunded_or_disputed=2, accounts_on_ip_24h=5, disposable_email=True, high_risk_items=True, paid_with_balance=False, promo_used=False)
    assert fraud_ai.heuristic_fraud(low)["risk"] == "low" and fraud_ai.heuristic_fraud(low)["score"] < 20
    h = fraud_ai.heuristic_fraud(high)
    assert h["risk"] == "high" and h["score"] == 100 and len(h["reasons"]) >= 4
    assert fraud_ai.blend({"score": 80}, {"score": 0}) == 56  # never below 70% of the rules
    assert fraud_ai.blend({"score": 40}, None) == 40


# ───────────── jobs (scripted LLM + heuristic fallback) ─────────────


class ScriptedLLM(LLMProvider):
    def __init__(self, *replies, name="openai"):
        self.name, self.model, self.replies, self.calls = name, "scripted-1", list(replies), 0

    async def chat(self, messages, *, json_mode=False, max_tokens=800, temperature=0.2):
        self.calls += 1
        reply = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        if isinstance(reply, Exception):
            raise reply
        return LLMResult(reply if isinstance(reply, str) else json.dumps(reply), self.name, self.model, 100, 20, 42)


async def pending_product(factory, **kw):
    async with factory() as s, s.begin():
        seller, cat = await make_user(s, "SELLER"), await make_category(s)
        prod = await make_product(s, seller, cat, status="PENDING_REVIEW", **kw)
        return seller, prod


async def test_moderation_auto_publishes_above_threshold(factory):
    seller, prod = await pending_product(factory)
    out = await ai_moderate_product_impl(factory, prod.id, chain=[ScriptedLLM({"score": 93, "verdict": "approve", "reasons": [], "suggested_category": None})])
    assert out["decision"] == "approved" and out["mock"] is False
    row = (await q(factory, 'SELECT status, "publishedAt", "aiModeration" FROM "Product" WHERE id = :i', i=prod.id))[0]
    assert row[0] == "ACTIVE" and row[1] is not None
    am = row[2]
    assert am["score"] == 93 and am["verdict"] == "approve" and am["approved"] is True and am["provider"] == "openai" and am["mock"] is False
    assert await scalar(factory, "SELECT COUNT(*) FROM \"Notification\" WHERE type = 'PRODUCT_APPROVED' AND \"userId\" = :u", u=seller.id) == 1
    log = (await q(factory, 'SELECT provider, model, task, ok, "tokensIn", "tokensOut" FROM "AiLog"'))[0]
    assert tuple(log) == ("openai", "scripted-1", "moderation", True, 100, 20)


async def test_moderation_below_threshold_stays_pending(factory):
    _, prod = await pending_product(factory)
    out = await ai_moderate_product_impl(factory, prod.id, chain=[ScriptedLLM({"score": 79, "verdict": "approve", "reasons": ["Описание краткое"]})])
    assert out["decision"] == "needs_review"
    assert await scalar(factory, 'SELECT status FROM "Product" WHERE id = :i', i=prod.id) == "PENDING_REVIEW"


async def test_threshold_comes_from_setting(factory):
    from app.settings_store import AI_AUTO_PUBLISH, set_setting

    async with factory() as s, s.begin():
        await set_setting(s, AI_AUTO_PUBLISH, 95)
    _, prod = await pending_product(factory)
    out = await ai_moderate_product_impl(factory, prod.id, chain=[ScriptedLLM({"score": 93, "verdict": "approve", "reasons": []})])
    assert out["decision"] == "needs_review"


async def test_moderation_rejects_clear_violations(factory):
    seller, prod = await pending_product(factory)
    out = await ai_moderate_product_impl(factory, prod.id, chain=[ScriptedLLM({"score": 4, "verdict": "reject", "reasons": ["Запрещённый товар"]})])
    assert out["decision"] == "rejected"
    row = (await q(factory, 'SELECT status, "moderationNote" FROM "Product" WHERE id = :i', i=prod.id))[0]
    assert row[0] == "REJECTED" and "Запрещённый" in row[1]
    assert await scalar(factory, "SELECT COUNT(*) FROM \"Notification\" WHERE type = 'PRODUCT_REJECTED'") == 1


async def test_moderation_falls_back_through_chain_then_heuristic(factory):
    _, prod = await pending_product(factory)
    broken = ScriptedLLM(LLMError("openai: HTTP 500"), name="openai")
    garbage = ScriptedLLM("sorry, I cannot do that", name="anthropic")
    out = await ai_moderate_product_impl(factory, prod.id, chain=[broken, garbage])
    assert out["mock"] is True and out["provider"] == "mock" and out["decision"] in {"approved", "needs_review", "rejected"}
    logs = await q(factory, 'SELECT provider, ok FROM "AiLog" ORDER BY "createdAt"')
    assert [tuple(r) for r in logs] == [("openai", False), ("anthropic", False), ("mock", True)]


async def test_moderation_second_provider_answers_when_first_fails(factory):
    _, prod = await pending_product(factory)
    chain = [ScriptedLLM(LLMError("boom"), name="openai"), ScriptedLLM({"score": 90, "verdict": "approve", "reasons": []}, name="anthropic")]
    out = await ai_moderate_product_impl(factory, prod.id, chain=chain)
    assert out["provider"] == "anthropic" and out["decision"] == "approved"


async def test_offline_heuristic_publishes_seed_like_product(factory):
    _, prod = await pending_product(factory)
    out = await ai_moderate_product_impl(factory, prod.id, chain=[])
    assert out["mock"] is True and out["decision"] == "approved"
    assert await scalar(factory, 'SELECT "aiModeration"->>\'mock\' FROM "Product" WHERE id = :i', i=prod.id) == "true"


async def test_moderation_never_changes_status_of_active_product(factory):
    async with factory() as s, s.begin():
        seller, cat = await make_user(s, "SELLER"), await make_category(s)
        prod = await make_product(s, seller, cat, status="ACTIVE")
    out = await ai_moderate_product_impl(factory, prod.id, chain=[ScriptedLLM({"score": 3, "verdict": "reject", "reasons": ["x"]})])
    assert out["decision"] == "recorded"
    assert await scalar(factory, 'SELECT status FROM "Product" WHERE id = :i', i=prod.id) == "ACTIVE"
    assert (await ai_moderate_product_impl(factory, "missing"))["error"] == "product_not_found"


async def test_fraud_score_written_and_admin_alerted_once(factory):
    now = utcnow()
    async with factory() as s, s.begin():
        await make_user(s, "ADMIN")
        seller, cat = await make_user(s, "SELLER"), await make_category(s)
        buyer = await make_user(s, email="x@mailinator.com", created_at=now - timedelta(minutes=10))
        prod = await make_product(s, seller, cat, ptype="GIFT_CARD", price=2_000_000)
        await make_stock(s, prod, ["G1"])
        order = await make_paid_order(s, buyer, [{"product": prod}], paid_ago=timedelta(minutes=1))
        await s.execute(text("UPDATE \"Order\" SET ip = '203.0.113.9' WHERE id = :o"), {"o": order.id})
    out = await ai_score_fraud_impl(factory, order.id, chain=[])
    assert out["mock"] is True and out["score"] >= 70 and out["risk"] == "high"
    row = (await q(factory, 'SELECT "fraudScore", meta FROM "Order" WHERE id = :o', o=order.id))[0]
    assert row[0] == out["score"] and row[1]["fraud"]["risk"] == "high" and row[1]["fraud"]["reasons"]
    await ai_score_fraud_impl(factory, order.id, chain=[])
    assert await scalar(factory, "SELECT COUNT(*) FROM \"Notification\" WHERE title LIKE 'Подозрительный заказ%'") == 1
    log_input = await scalar(factory, 'SELECT input::text FROM "AiLog" ORDER BY "createdAt" LIMIT 1')
    assert "mailinator" not in log_input and "203.0.113.9" not in log_input  # no PII in AiLog


async def test_fraud_llm_blend(factory):
    async with factory() as s, s.begin():
        seller, cat = await make_user(s, "SELLER"), await make_category(s)
        buyer = await make_user(s, created_at=utcnow() - timedelta(days=100))
        prod = await make_product(s, seller, cat)
        await make_stock(s, prod, ["G1"])
        order = await make_paid_order(s, buyer, [{"product": prod}])
    out = await ai_score_fraud_impl(factory, order.id, chain=[ScriptedLLM({"score": 30, "risk": "low", "reasons": ["Новый шаблон"]})])
    assert out["mock"] is False and out["provider"] == "openai" and 5 <= out["score"] <= 30
    assert (await ai_score_fraud_impl(factory, "missing", chain=[]))["error"] == "order_not_found"


async def make_review(factory, text_, rating=5):
    async with factory() as s, s.begin():
        seller, buyer, cat = await make_user(s, "SELLER"), await make_user(s), await make_category(s)
        prod = await make_product(s, seller, cat)
        await make_stock(s, prod, ["K"])
        order = await make_paid_order(s, buyer, [{"product": prod}])
        item_id = (await s.execute(text('SELECT id FROM "OrderItem" WHERE "orderId" = :o'), {"o": order.id})).scalar_one()
        rid = new_id()
        await s.execute(
            text(
                """INSERT INTO "Review" (id, "orderItemId", "productId", "sellerId", "buyerId", rating, text, status, "createdAt")
                   VALUES (:i, :oi, :p, :s, :b, :r, :t, 'PUBLISHED', now())"""
            ),
            {"i": rid, "oi": item_id, "p": prod.id, "s": seller.id, "b": buyer.id, "r": rating, "t": text_},
        )
        await s.execute(text('UPDATE "Product" SET "ratingAvg" = :r, "ratingCount" = 1 WHERE id = :p'), {"r": float(rating), "p": prod.id})
        await s.execute(text('UPDATE "SellerProfile" SET rating = :r, "ratingCount" = 1 WHERE "userId" = :s'), {"r": float(rating), "s": seller.id})
    return rid, prod, seller, buyer


async def test_review_with_contacts_is_hidden_and_ratings_recomputed(factory):
    rid, prod, seller, buyer = await make_review(factory, "Всё ок, пишите в телеграм @best_keys_shop дешевле!", 5)
    out = await ai_moderate_review_impl(factory, rid, chain=[])
    assert out["hidden"] is True and "contacts" in out["categories"]
    row = (await q(factory, 'SELECT status, "aiFlags" FROM "Review" WHERE id = :i', i=rid))[0]
    assert row[0] == "HIDDEN" and row[1]["flagged"] is True and row[1]["mock"] is True
    assert tuple((await q(factory, 'SELECT "ratingAvg", "ratingCount" FROM "Product" WHERE id = :i', i=prod.id))[0]) == (0, 0)
    assert tuple((await q(factory, 'SELECT rating, "ratingCount" FROM "SellerProfile" WHERE "userId" = :i', i=seller.id))[0]) == (0, 0)
    assert await scalar(factory, 'SELECT COUNT(*) FROM "Notification" WHERE "userId" = :u', u=buyer.id) == 1


async def test_honest_negative_review_is_kept(factory):
    rid, *_ = await make_review(factory, "Ключ не подошёл к моему региону, разочарован. Поддержка ответила через сутки.", 2)
    out = await ai_moderate_review_impl(factory, rid, chain=[])
    assert out["hidden"] is False and out["flagged"] is False
    assert await scalar(factory, 'SELECT status FROM "Review" WHERE id = :i', i=rid) == "PUBLISHED"


async def test_review_moderation_respects_admin_decision(factory):
    rid, *_ = await make_review(factory, "обычный отзыв")
    async with factory() as s, s.begin():
        await s.execute(text("UPDATE \"Review\" SET status = 'HIDDEN' WHERE id = :i"), {"i": rid})
    out = await ai_moderate_review_impl(factory, rid, chain=[ScriptedLLM({"flagged": True, "action": "hide", "severity": 0.9, "categories": ["spam"], "reasons": ["spam"]})])
    assert out["hidden"] is False  # already hidden: nothing to do, status stays
    assert (await ai_moderate_review_impl(factory, "missing", chain=[]))["error"] == "review_not_found"


async def test_dispute_suggestion_shape_matches_admin_reader(factory):
    async with factory() as s, s.begin():
        seller, buyer, cat = await make_user(s, "SELLER"), await make_user(s), await make_category(s)
        prod = await make_product(s, seller, cat)  # no stock: never delivered
        order = await make_paid_order(s, buyer, [{"product": prod}], status="DELIVERED")
        item_id = (await s.execute(text('SELECT id FROM "OrderItem" WHERE "orderId" = :o'), {"o": order.id})).scalar_one()
        await s.execute(
            text(
                """INSERT INTO "Dispute" (id, "orderId", "orderItemId", "buyerId", "sellerId", reason, status, "createdAt", "updatedAt")
                   VALUES ('dsp1', :o, :i, :b, :s, 'Ключ не пришёл', 'OPEN', now(), now())"""
            ),
            {"o": order.id, "i": item_id, "b": buyer.id, "s": seller.id},
        )
    out = await ai_dispute_suggestion_impl(factory, "dsp1", chain=[])
    assert out["recommendation"] == "refund" and out["mock"] is True
    adv = await scalar(factory, 'SELECT "aiSuggestion" FROM "Dispute" WHERE id = \'dsp1\'')
    assert set(adv) >= {"summary", "recommendation", "confidence", "provider", "model", "mock", "generatedAt"}
    assert 0 <= adv["confidence"] <= 1 and adv["recommendation"] in {"refund", "reject", "ask_more_info"}
    llm = await ai_dispute_suggestion_impl(factory, "dsp1", chain=[ScriptedLLM({"summary": "Покупатель прав.", "recommendation": "refund", "confidence": 0.9})])
    assert llm["mock"] is False and llm["recommendation"] == "refund"
    bad = await ai_dispute_suggestion_impl(factory, "dsp1", chain=[ScriptedLLM({"summary": "x", "recommendation": "maybe", "confidence": 2})])
    assert bad["mock"] is True  # invalid model output -> heuristic
    assert (await ai_dispute_suggestion_impl(factory, "nope", chain=[]))["error"] == "dispute_not_found"
