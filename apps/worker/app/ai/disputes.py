"""Dispute advice: prompt, normalisation, rule-based fallback. Output shape is what the admin panel reads:
{summary, recommendation: refund|reject|ask_more_info, confidence: 0-1}."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

SYSTEM = (
    "You assist the admin of a digital-goods marketplace in resolving buyer/seller disputes. Read the dispute and recommend: "
    '"refund" (buyer is right / goods not delivered or invalid), "reject" (claim unfounded, goods delivered and valid), or '
    '"ask_more_info" (evidence insufficient). Reply with ONE JSON object: {"summary": 1-3 sentences in Russian, '
    '"recommendation": "refund"|"reject"|"ask_more_info", "confidence": number 0-1}. You are advisory only.'
)

NOT_RECEIVED = re.compile(r"не\s+(?:пришл|получ|выдал|выдан|доставл)|нет\s+(?:ключа|кода|товара)|пустой", re.I)
NOT_WORKING = re.compile(r"не\s+(?:работает|активир|подход|принима)|уже\s+использован|invalid|already\s+used|неверн|ошибк", re.I)
CHANGED_MIND = re.compile(r"передумал|не\s+нужн|ошибся|случайно|купил\s+не\s+то", re.I)


@dataclass(slots=True)
class DisputeFacts:
    reason: str
    item_title: str | None
    item_status: str | None
    delivery_mode: str | None
    delivered: bool
    has_stock_attached: bool
    hours_since_delivery: float | None
    total: int | None
    messages: list[tuple[str, str]] = field(default_factory=list)  # (authorRole, body)
    seller_replied: bool = False
    buyer_disputes_90d: int = 0


def dispute_prompt(f: DisputeFacts) -> str:
    chat = "\n".join(f"[{role}] {body[:500]}" for role, body in f.messages[-12:]) or "(нет сообщений)"
    return (
        f"Товар: {f.item_title}\nРежим выдачи: {f.delivery_mode}\nСтатус позиции: {f.item_status}\nВыдан: {f.delivered}\n"
        f"К позиции привязан ключ/данные: {f.has_stock_attached}\nЧасов с момента выдачи: {f.hours_since_delivery}\n"
        f"Сумма: {(f.total or 0) / 100:.2f} RUB\nСпоров у покупателя за 90 дней: {f.buyer_disputes_90d}\n"
        f"Причина спора: {f.reason[:1500]}\n\nПереписка:\n{chat}"
    )


def heuristic_dispute(f: DisputeFacts) -> dict[str, Any]:
    text = f.reason + " " + " ".join(b for r, b in f.messages if r == "USER")
    if not f.delivered or (f.delivery_mode == "AUTO_STOCK" and not f.has_stock_attached):
        return {"summary": "Товар не был выдан автоматически (нет привязанных данных). Рекомендуется вернуть деньги покупателю.", "recommendation": "refund", "confidence": 0.85}
    if CHANGED_MIND.search(text) and not NOT_WORKING.search(text):
        return {"summary": "Покупатель пишет, что передумал или ошибся при выборе; товар выдан и не оспаривается по качеству. Для цифровых товаров возврат по этой причине не предусмотрен.", "recommendation": "reject", "confidence": 0.7}
    if NOT_RECEIVED.search(text) and f.delivered:
        return {"summary": "Покупатель сообщает, что не получил товар, но система зафиксировала выдачу. Попросите скриншот личного кабинета заказа и проверьте, что данные доступны.", "recommendation": "ask_more_info", "confidence": 0.6}
    if NOT_WORKING.search(text):
        conf = 0.55 if f.buyer_disputes_90d < 3 else 0.4
        return {"summary": "Покупатель сообщает, что ключ/данные не работают. Нужны скриншот ошибки и подтверждение региона/платформы; при подтверждении — замена или возврат.", "recommendation": "ask_more_info", "confidence": conf}
    return {"summary": "Недостаточно данных для решения. Запросите у покупателя подробности и подтверждающие скриншоты.", "recommendation": "ask_more_info", "confidence": 0.4}


def normalize_dispute(raw: dict[str, Any]) -> dict[str, Any]:
    rec = str(raw.get("recommendation", "")).lower()
    if rec not in ("refund", "reject", "ask_more_info"):
        raise ValueError("bad recommendation")
    summary = str(raw.get("summary", "")).strip()
    if len(summary) < 3:
        raise ValueError("summary missing")
    try:
        conf = max(0.0, min(1.0, float(raw.get("confidence", 0.5))))
    except (TypeError, ValueError) as exc:
        raise ValueError("bad confidence") from exc
    return {"summary": summary[:1200], "recommendation": rec, "confidence": round(conf, 2)}
