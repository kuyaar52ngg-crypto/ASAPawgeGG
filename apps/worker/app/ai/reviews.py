"""Review moderation: prompt, normalisation, offline heuristic."""
from __future__ import annotations

import re
from typing import Any

SYSTEM = (
    "You moderate buyer reviews on a Russian digital-goods marketplace. Flag: profanity/insults, hate speech, spam/advertising, "
    "contact details or links, personal data (phones, cards, emails), threats, content unrelated to the purchase. Honest negative "
    'reviews are allowed. Reply with ONE JSON object: {"flagged": bool, "action": "keep"|"hide", "categories": [subset of '
    '"toxic","spam","contacts","personal_data","off_topic"], "severity": number 0-1, "reasons": [short Russian strings]}. '
    'Use action "hide" only for clear violations (severity >= 0.7).'
)

PROFANITY = re.compile(r"(?:ху[йеёяи]|пизд|ебан|ебат|еб[ёе]т|\bбля(?:д|ть)|мудак|пидор|пидр|сучар|\bсука\b|гондон|залуп|шлюх)", re.I)
THREAT = re.compile(r"(?:убь[юё]|найд[ёе]м\s+и|прист[р]ел|сожгу|подам\s+в\s+суд\s+на\s+вас\s+всех)", re.I)
CONTACTS = re.compile(r"(?:t\.me/|telegram|телеграм|whatsapp|ватсап|viber|https?://|www\.|@[a-z0-9_]{4,}|\+?\d[\d\s().\-]{9,}\d)", re.I)
CARD = re.compile(r"\b(?:\d[ -]?){15,18}\d\b")
SPAM = re.compile(r"(?:заработ(?:ок|ай)|переходи|подписывайся|скидк[аи]\s+по\s+промокод|дешевле\s+у\s+нас|купи\s+у\s+меня)", re.I)


def heuristic_review(text: str | None, rating: int) -> dict[str, Any]:
    body = (text or "").strip()
    cats: list[str] = []
    reasons: list[str] = []
    severity = 0.0
    if PROFANITY.search(body):
        cats.append("toxic")
        reasons.append("Нецензурная лексика или оскорбления")
        severity = max(severity, 0.8)
    if THREAT.search(body):
        cats.append("toxic")
        reasons.append("Угрозы")
        severity = max(severity, 0.9)
    if CARD.search(body):
        cats.append("personal_data")
        reasons.append("Похоже на номер банковской карты")
        severity = max(severity, 0.9)
    if CONTACTS.search(body):
        cats.append("contacts")
        reasons.append("Контакты или внешние ссылки")
        severity = max(severity, 0.75)
    if SPAM.search(body) or re.search(r"(.)\1{9,}", body):
        cats.append("spam")
        reasons.append("Реклама или спам")
        severity = max(severity, 0.75)
    letters = [c for c in body if c.isalpha()]
    if len(letters) > 25 and sum(c.isupper() for c in letters) / len(letters) > 0.85:
        cats.append("spam")
        reasons.append("Текст написан заглавными буквами")
        severity = max(severity, 0.4)
    flagged = bool(cats)
    cats = list(dict.fromkeys(cats))
    return {"flagged": flagged, "action": "hide" if severity >= 0.7 else "keep", "categories": cats, "severity": round(severity, 2), "reasons": reasons[:5]}


_ALLOWED = {"toxic", "spam", "contacts", "personal_data", "off_topic"}


def normalize_review(raw: dict[str, Any]) -> dict[str, Any]:
    try:
        severity = max(0.0, min(1.0, float(raw.get("severity", 0.0))))
    except (TypeError, ValueError) as exc:
        raise ValueError("bad severity") from exc
    cats_raw = raw.get("categories") or []
    cats = [c for c in (cats_raw if isinstance(cats_raw, list) else [cats_raw]) if c in _ALLOWED]
    flagged = bool(raw.get("flagged", False)) or bool(cats)
    action = "hide" if str(raw.get("action", "keep")).lower() == "hide" and severity >= 0.7 else "keep"
    reasons_raw = raw.get("reasons") or []
    reasons = [str(r).strip()[:200] for r in (reasons_raw if isinstance(reasons_raw, list) else [reasons_raw]) if str(r).strip()][:5]
    return {"flagged": flagged, "action": action, "categories": cats, "severity": round(severity, 2), "reasons": reasons}


def review_prompt(text: str | None, rating: int, product_title: str) -> str:
    return f"Товар: {product_title}\nОценка: {rating}/5\nТекст отзыва:\n{(text or '(без текста)')[:2000]}"
