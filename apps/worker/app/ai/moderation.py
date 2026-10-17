"""Product moderation: prompt, output normalisation and the offline heuristic (used when no LLM is configured / reachable)."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

SYSTEM = (
    "You are a strict but fair content moderator of a Russian digital-goods marketplace (game keys, subscriptions, Steam wallet "
    "top-ups, gift cards, in-game currency). Review the seller's product listing. Reject: stolen/hacked/carded goods, cheats that "
    "violate ToS, drugs/weapons/adult content, scams, phishing, contact details or off-platform links in the text, misleading "
    "claims. Prefer 'review' (human check) over 'reject' when unsure. Reply with ONE JSON object: "
    '{"score": integer 0-100 (quality+safety), "verdict": "approve"|"review"|"reject", "reasons": [short Russian strings], '
    '"suggested_category": category slug from the provided list or null}. Use verdict "approve" only when the listing is clean, '
    "clear and in the right category."
)

# (regex, reason). Deliberately small, high-precision list.
PROHIBITED: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"краден|ворован|украден|угнан|слитые?\s+(?:аккаунт|карт)", re.I), "Товар из краденых/слитых источников"),
    (re.compile(r"кардинг|carding|\bcvv\b|дамп[ыа]?\s+карт", re.I), "Кардинг / платёжные данные"),
    (re.compile(r"взлом(?:анн|ан)|brute\s*force|брутфорс|фишинг|phishing", re.I), "Взломанные аккаунты / фишинг"),
    (re.compile(r"наркот|закладк|оружи[ея]\s+без|порно|18\+\s*контент", re.I), "Запрещённая категория"),
    (re.compile(r"накрутк[аи]\s+(?:подписчик|лайк)|казино|ставки\s+на\s+спорт", re.I), "Запрещённая услуга"),
]
CONTACTS = re.compile(r"(?:t\.me/|telegram|телеграм|whatsapp|ватсап|viber|вайбер|discord\.gg|https?://|www\.|@[a-z0-9_]{4,}|\+?\d[\d\s().\-]{9,}\d)", re.I)


@dataclass(slots=True)
class ProductFacts:
    title: str
    description: str
    short_description: str | None
    price: int
    type: str
    category_name: str | None
    category_slug: str | None
    tags: list[str]
    image_count: int
    delivery_mode: str


def product_prompt(f: ProductFacts, categories: list[tuple[str, str]]) -> str:
    cats = "\n".join(f"- {slug}: {name}" for slug, name in categories)
    return (
        f"Название: {f.title}\nТип: {f.type}\nВыдача: {f.delivery_mode}\nЦена: {f.price / 100:.2f} RUB\n"
        f"Категория продавца: {f.category_name} ({f.category_slug})\nТеги: {', '.join(f.tags) or '-'}\nКартинок: {f.image_count}\n"
        f"Краткое описание: {f.short_description or '-'}\nОписание:\n{f.description[:3000]}\n\nДоступные категории:\n{cats}"
    )


def _stems(text: str) -> set[str]:
    return {w[:5] for w in re.findall(r"[a-zа-яё0-9]{4,}", text.lower())}


def suggest_category(f: ProductFacts, categories: list[tuple[str, str]]) -> str | None:
    """Best matching category slug by stem overlap with title+tags; None if the seller's own category is as good."""
    hay = _stems(f"{f.title} {' '.join(f.tags)}") | _stems(f.description[:400])
    best: tuple[int, str] | None = None
    own = 0
    for slug, name in categories:
        score = len(hay & (_stems(name) | _stems(slug.replace("-", " "))))
        if slug == f.category_slug:
            own = score
        if score > (best[0] if best else 0):
            best = (score, slug)
    if best and best[1] != f.category_slug and best[0] > own and best[0] >= 2:
        return best[1]
    return None


def heuristic_moderation(f: ProductFacts, categories: list[tuple[str, str]]) -> dict[str, Any]:
    reasons: list[str] = []
    text = f"{f.title}\n{f.short_description or ''}\n{f.description}"
    for pattern, reason in PROHIBITED:
        if pattern.search(text):
            return {"score": 5, "verdict": "reject", "reasons": [reason], "suggested_category": None}

    score = 40
    desc_len = len(f.description.strip())
    if desc_len >= 60:
        score += 15
    else:
        reasons.append("Слишком короткое описание")
    if desc_len >= 200:
        score += 10
    if 8 <= len(f.title.strip()) <= 90:
        score += 8
    else:
        reasons.append("Название должно быть от 8 до 90 символов")
    letters = [c for c in f.title if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.7 and len(letters) > 8:
        score -= 10
        reasons.append("Название написано заглавными буквами")
    if re.search(r"([!?*#$])\1{2,}|(.)\2{5,}", text):
        score -= 15
        reasons.append("Спам-символы в тексте")
    if f.image_count > 0:
        score += 10
    else:
        reasons.append("Нет изображения товара")
    if f.price >= 1000:
        score += 5
    else:
        reasons.append("Подозрительно низкая цена")
    if len(f.tags) >= 2:
        score += 4
    if f.short_description:
        score += 3
    if CONTACTS.search(text):
        score -= 30
        reasons.append("Контакты или внешние ссылки в описании (сделки только через площадку)")

    suggestion = suggest_category(f, categories)
    if suggestion:
        score -= 5
        reasons.append("Возможно, выбрана неподходящая категория")
    score = max(0, min(100, score))
    verdict = "approve" if score >= 80 and not reasons else ("review" if score >= 25 else "reject")
    if verdict == "reject":
        reasons.append("Низкое качество карточки")
    return {"score": score, "verdict": verdict, "reasons": reasons[:6], "suggested_category": suggestion}


def normalize_moderation(raw: dict[str, Any], valid_slugs: set[str]) -> dict[str, Any]:
    try:
        score = int(round(float(raw["score"])))
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("score missing") from exc
    score = max(0, min(100, score))
    verdict = str(raw.get("verdict", "")).lower()
    if verdict not in ("approve", "review", "reject"):
        verdict = "approve" if score >= 80 else ("review" if score >= 25 else "reject")
    reasons_raw = raw.get("reasons") or []
    reasons = [str(r).strip()[:200] for r in (reasons_raw if isinstance(reasons_raw, list) else [reasons_raw]) if str(r).strip()][:6]
    sug = raw.get("suggested_category")
    sug = sug if isinstance(sug, str) and sug in valid_slugs else None
    return {"score": score, "verdict": verdict, "reasons": reasons, "suggested_category": sug}
