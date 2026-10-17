"""In-app notifications + audit trail writers (tables `Notification`, `AuditLog`)."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import AuditLog, Notification, User
from .util import new_id, utcnow


async def notify(
    session: AsyncSession,
    user_id: str,
    *,
    type: str = "SYSTEM",
    title: str,
    body: str | None = None,
    link: str | None = None,
    data: dict[str, Any] | None = None,
) -> str:
    nid = new_id()
    session.add(Notification(id=nid, userId=user_id, type=type, title=title, body=body, link=link, data=data, createdAt=utcnow()))
    return nid


async def admin_ids(session: AsyncSession) -> list[str]:
    rows = await session.execute(select(User.id).where(User.role == "ADMIN", User.banned.is_(False)))
    return [r[0] for r in rows]


async def notify_admins(session: AsyncSession, *, title: str, body: str | None = None, link: str | None = None, type: str = "SYSTEM") -> int:
    ids = await admin_ids(session)
    for uid in ids:
        await notify(session, uid, type=type, title=title, body=body, link=link)
    return len(ids)


async def write_audit(
    session: AsyncSession,
    *,
    action: str,
    entity_type: str,
    entity_id: str | None,
    actor_id: str | None = None,
    before: Any = None,
    after: Any = None,
) -> None:
    """Worker actions are written with actorId NULL (system)."""
    session.add(AuditLog(id=new_id(), actorId=actor_id, action=action, entityType=entity_type, entityId=entity_id, before=before, after=after, createdAt=utcnow()))
