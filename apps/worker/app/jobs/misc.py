"""`send_notification` job: create an in-app Notification (email delivery can be added behind this later)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import select

from ..db import SessionFactory, session_scope
from ..models import User
from ..notifications import notify

NotificationTypeName = Literal[
    "ORDER_PAID", "ORDER_DELIVERED", "ORDER_FAILED", "PRODUCT_APPROVED", "PRODUCT_REJECTED", "PAYOUT_UPDATE", "DISPUTE_UPDATE", "REVIEW_NEW", "SYSTEM"
]


class SendNotificationArgs(BaseModel):
    userId: str = Field(min_length=1, max_length=64)
    type: NotificationTypeName = "SYSTEM"
    title: str = Field(min_length=1, max_length=200)
    body: str | None = Field(default=None, max_length=2000)
    link: str | None = Field(default=None, max_length=500)


async def send_notification_impl(factory: SessionFactory, args: SendNotificationArgs) -> dict:
    async with session_scope(factory) as s:
        if (await s.execute(select(User.id).where(User.id == args.userId))).first() is None:
            return {"ok": False, "error": "user_not_found"}
        nid = await notify(s, args.userId, type=args.type, title=args.title, body=args.body, link=args.link)
    return {"ok": True, "notificationId": nid}
