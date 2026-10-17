"""Order state machine — mirror of ORDER_TRANSITIONS in packages/shared/src/constants.ts and
`deriveOrderStatus` in apps/web/src/server/orders/state-machine.ts (docs/CONTRACTS.md §7)."""
from __future__ import annotations

from collections.abc import Iterable

ORDER_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "PENDING": ("PAID", "CANCELLED", "FAILED"),
    "PAID": ("PROCESSING", "DELIVERED", "REFUNDED", "FAILED"),
    "PROCESSING": ("DELIVERED", "FAILED", "REFUNDED"),
    "DELIVERED": ("DISPUTED", "REFUNDED"),
    "DISPUTED": ("DELIVERED", "REFUNDED"),
    "REFUNDED": (),
    "CANCELLED": (),
    "FAILED": ("REFUNDED", "PROCESSING"),
}


class OrderTransitionError(Exception):
    def __init__(self, src: str, dst: str) -> None:
        super().__init__(f"Illegal order transition {src} -> {dst}")
        self.src, self.dst = src, dst


def can_transition(src: str, dst: str) -> bool:
    return dst in ORDER_TRANSITIONS.get(src, ())


def assert_transition(src: str, dst: str) -> None:
    if not can_transition(src, dst):
        raise OrderTransitionError(src, dst)


def derive_order_status(current: str, item_statuses: Iterable[str]) -> str | None:
    """Order status implied by its items after a delivery step; None = leave as is."""
    statuses = list(item_statuses)
    if not statuses:
        return None
    live = [s for s in statuses if s != "REFUNDED"]
    if not live:
        return None if current == "REFUNDED" else "REFUNDED"
    if all(s == "DELIVERED" for s in live):
        nxt = "DELIVERED"
    elif any(s == "FAILED" for s in live) and all(s in ("FAILED", "DELIVERED") for s in live):
        nxt = "FAILED"
    elif any(s in ("PROCESSING", "DELIVERED") for s in live):
        nxt = "PROCESSING"
    else:
        nxt = current
    if nxt == current:
        return None
    return nxt if can_transition(current, nxt) else None
