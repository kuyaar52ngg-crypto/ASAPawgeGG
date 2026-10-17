"""Tiny Redis mutex (SET NX PX + compare-and-delete) used to serialise slow external calls per order item."""
from __future__ import annotations

import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

_RELEASE_LUA = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"


@asynccontextmanager
async def redis_lock(redis: Any | None, key: str, ttl_ms: int = 120_000) -> AsyncIterator[bool]:
    """Yields True when the lock is held (or when no Redis is available, e.g. unit tests), False if someone else holds it."""
    if redis is None:
        yield True
        return
    token = secrets.token_hex(16)
    got = await redis.set(key, token, nx=True, px=ttl_ms)
    try:
        yield bool(got)
    finally:
        if got:
            try:
                await redis.eval(_RELEASE_LUA, 1, key, token)
            except Exception:  # noqa: BLE001 - the lock expires by TTL anyway
                pass
