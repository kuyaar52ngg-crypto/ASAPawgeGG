"""Read/write the `Setting` table (JSON values), same keys as `SETTING_KEYS` in @asap/shared."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Setting
from .util import utcnow

COMMISSION_DEFAULT_BPS = "commission.defaultBps"
HOLD_DAYS = "commission.holdDays"
AI_PROVIDER = "ai.provider"
AI_MODEL = "ai.model"
AI_AUTO_PUBLISH = "ai.autoPublishThreshold"
AUTO_REFUND_ON_FAILURE = "worker.autoRefundOnFailure"
AI_AUTO_REJECT = "ai.autoRejectThreshold"


async def get_setting(session: AsyncSession, key: str, default: Any = None) -> Any:
    row = (await session.execute(select(Setting.value).where(Setting.key == key))).first()
    if row is None or row[0] is None:
        return default
    return row[0]


async def get_int_setting(session: AsyncSession, key: str, default: int) -> int:
    value = await get_setting(session, key, default)
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


async def set_setting(session: AsyncSession, key: str, value: Any, actor_id: str | None = None) -> None:
    stmt = pg_insert(Setting).values(key=key, value=value, updatedById=actor_id, updatedAt=utcnow())
    stmt = stmt.on_conflict_do_update(index_elements=[Setting.key], set_={"value": stmt.excluded.value, "updatedById": actor_id, "updatedAt": utcnow()})
    await session.execute(stmt)
