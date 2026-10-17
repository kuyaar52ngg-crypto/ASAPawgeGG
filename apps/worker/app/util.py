"""Small shared helpers: UTC clock (naive, matching Prisma `timestamp(3)`), cuid-like ids, JSON-safe truncation."""
from __future__ import annotations

import secrets
import time
from datetime import UTC, datetime, timedelta
from typing import Any

_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"


def utcnow() -> datetime:
    """Naive UTC `now` — Prisma stores `DateTime` as `timestamp(3) without time zone` in UTC."""
    return datetime.now(UTC).replace(tzinfo=None)


def utc_day_start(d: datetime | None = None) -> datetime:
    d = d or utcnow()
    return d.replace(hour=0, minute=0, second=0, microsecond=0)


def add_days(d: datetime, days: float) -> datetime:
    return d + timedelta(days=days)


def _b36(n: int, width: int) -> str:
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = _ALPHABET[r] + out
    return out.rjust(width, "0")[-width:]


def new_id() -> str:
    """cuid-like primary key (`c` + time + random, 25 chars) — Prisma generates ids client-side, the DB has no default."""
    return "c" + _b36(int(time.time() * 1000), 8) + "".join(secrets.choice(_ALPHABET) for _ in range(16))


def clip(value: Any, limit: int = 2000) -> Any:
    """Truncate long strings (recursively) before they are written to AiLog/AuditLog JSON."""
    if isinstance(value, str):
        return value if len(value) <= limit else value[:limit] + "…"
    if isinstance(value, dict):
        return {k: clip(v, limit) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clip(v, limit) for v in value[:50]]
    return value
