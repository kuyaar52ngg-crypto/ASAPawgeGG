"""Async SQLAlchemy engine/session factory (asyncpg) shared by the FastAPI app and the arq worker."""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from .config import get_settings

SessionFactory = async_sessionmaker[AsyncSession]

_engine: AsyncEngine | None = None
_factory: SessionFactory | None = None


def make_engine(url: str | None = None, **kw) -> AsyncEngine:
    kw.setdefault("pool_size", 10)
    kw.setdefault("max_overflow", 10)
    kw.setdefault("pool_pre_ping", True)
    if url:  # accept plain Prisma-style URLs too
        url = url.split("?")[0].replace("postgresql://", "postgresql+asyncpg://", 1).replace("postgres://", "postgresql+asyncpg://", 1)
    return create_async_engine(url or get_settings().async_database_url, **kw)


def make_session_factory(engine: AsyncEngine) -> SessionFactory:
    return async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = make_engine()
    return _engine


def get_session_factory() -> SessionFactory:
    global _factory
    if _factory is None:
        _factory = make_session_factory(get_engine())
    return _factory


@asynccontextmanager
async def session_scope(factory: SessionFactory | None = None) -> AsyncIterator[AsyncSession]:
    """One transaction: commit on success, roll back on error."""
    async with (factory or get_session_factory())() as session, session.begin():
        yield session


async def dispose_engine() -> None:
    global _engine, _factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _factory = None
