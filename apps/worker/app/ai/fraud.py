"""Order fraud scoring: features -> heuristic score (0-100) and the LLM prompt. The final score blends both when an LLM answers."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

SYSTEM = (
    "You are a fraud analyst for a digital-goods marketplace. Given anonymised features of a new order, estimate the probability "
    'that it is fraudulent (stolen card / chargeback / account takeover / resale abuse). Reply with ONE JSON object: {"score": '
    'integer 0-100, "risk": "low"|"medium"|"high", "reasons": [short Russian strings]}. Be conservative: new accounts and big '
    "baskets alone are not fraud."
)

DISPOSABLE_DOMAINS = frozenset(
    {"mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org", "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com", "throwawaymail.com", "maildrop.cc"}
)
HIGH_RISK_TYPES = frozenset({"GIFT_CARD", "TOPUP", "CURRENCY"})


@dataclass(slots=True)
class FraudFeatures:
    total: int
    item_count: int
    account_age_hours: float
    previous_orders: int
    orders_last_hour: int
    failed_payments_24h: int
    refunded_or_disputed: int
    accounts_on_ip_24h: int
    disposable_email: bool
    high_risk_items: bool
    paid_with_balance: bool
    promo_used: bool

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def heuristic_fraud(f: FraudFeatures) -> dict[str, Any]:
    score, reasons = 5, []

    def add(points: int, reason: str) -> None:
        nonlocal score
        score += points
        reasons.append(reason)

    if f.account_age_hours < 1:
        add(20, "Аккаунт создан менее часа назад")
    elif f.account_age_hours < 24:
        add(10, "Аккаунт младше суток")
    if f.previous_orders == 0 and f.total >= 500_000:
        add(20, "Первая покупка на крупную сумму")
    if f.total >= 1_500_000:
        add(15, "Очень крупный заказ")
    if f.orders_last_hour >= 5:
        add(25, "Много заказов за последний час")
    elif f.orders_last_hour >= 3:
        add(15, "Повышенная частота заказов")
    if f.failed_payments_24h >= 3:
        add(15, "Несколько неудачных платежей за сутки")
    if f.refunded_or_disputed >= 2:
        add(15, "Возвраты/споры в истории покупателя")
    if f.accounts_on_ip_24h >= 3:
        add(20, "С одного IP оформляют заказы несколько аккаунтов")
    if f.disposable_email:
        add(25, "Одноразовая почта")
    if f.high_risk_items and f.account_age_hours < 72:
        add(10, "Подарочные карты/пополнения на новом аккаунте")
    if f.item_count >= 5:
        add(5, "Много позиций в заказе")
    if f.previous_orders >= 3 and f.refunded_or_disputed == 0 and f.account_age_hours > 24 * 7:
        score -= 10
        reasons.append("Покупатель с чистой историей")
    score = max(0, min(100, score))
    return {"score": score, "risk": risk_label(score), "reasons": reasons[:6]}


def risk_label(score: int) -> str:
    return "high" if score >= 70 else "medium" if score >= 35 else "low"


def fraud_prompt(f: FraudFeatures) -> str:
    d = f.as_dict()
    d["total_rub"] = round(f.total / 100, 2)
    return "Order features (JSON):\n" + "\n".join(f"{k}: {v}" for k, v in d.items())


def normalize_fraud(raw: dict[str, Any]) -> dict[str, Any]:
    try:
        score = max(0, min(100, int(round(float(raw["score"])))))
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("score missing") from exc
    reasons_raw = raw.get("reasons") or []
    reasons = [str(r).strip()[:200] for r in (reasons_raw if isinstance(reasons_raw, list) else [reasons_raw]) if str(r).strip()][:6]
    return {"score": score, "risk": risk_label(score), "reasons": reasons}


def blend(heuristic: dict[str, Any], llm: dict[str, Any] | None) -> int:
    """Final score: 50/50 with the LLM when it answered; never below 70% of the rule-based score (rules catch hard signals)."""
    if llm is None:
        return int(heuristic["score"])
    mixed = round(0.5 * heuristic["score"] + 0.5 * llm["score"])
    return max(mixed, round(0.7 * heuristic["score"]))
