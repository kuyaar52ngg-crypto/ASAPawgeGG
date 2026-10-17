"""Single source of truth for job names + their argument schemas (shared by the HTTP enqueue endpoint and the arq worker).

Names follow docs/CONTRACTS.md §10 / `JOB_NAMES` in @asap/shared. Two additions of zone E: `ai_dispute_suggestion`,
`sync_pending_payments`, `sweep_stuck_paid_orders`; aliases are accepted for the task-brief spellings
(`ai_fraud_score_order` == `ai_score_fraud`).
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from .jobs.misc import SendNotificationArgs


class _Args(BaseModel):
    model_config = ConfigDict(extra="ignore")


class OrderArgs(_Args):
    orderId: str = Field(min_length=1, max_length=64)


class ProductArgs(_Args):
    productId: str = Field(min_length=1, max_length=64)


class ReviewArgs(_Args):
    reviewId: str = Field(min_length=1, max_length=64)


class DisputeArgs(_Args):
    disputeId: str = Field(min_length=1, max_length=64)


class NoArgs(_Args):
    pass


class MetricsArgs(_Args):
    date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}")


JOB_ARGS: dict[str, type[BaseModel]] = {
    "fulfill_order": OrderArgs,
    "release_holds": NoArgs,
    "expire_reservations": NoArgs,
    "expire_pending_orders": NoArgs,
    "sweep_stuck_paid_orders": NoArgs,
    "sync_pending_payments": NoArgs,
    "aggregate_daily_metrics": MetricsArgs,
    "ai_moderate_product": ProductArgs,
    "ai_moderate_review": ReviewArgs,
    "ai_score_fraud": OrderArgs,
    "ai_fraud_score_order": OrderArgs,
    "ai_dispute_suggestion": DisputeArgs,
    "send_notification": SendNotificationArgs,
}
JOB_NAMES = frozenset(JOB_ARGS)
