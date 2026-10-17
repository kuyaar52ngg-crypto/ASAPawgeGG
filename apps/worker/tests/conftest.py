"""Test setup. DB tests run against a throw-away PostgreSQL database `asapawge_worker_test` that is created on demand and
migrated from the REAL Prisma migration SQL (packages/db/prisma/migrations), so the schema under test is the production one.
They are skipped (not failed) when PostgreSQL is not reachable."""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import asyncpg
import pytest
import pytest_asyncio

ADMIN_URL = os.environ.get("TEST_ADMIN_DATABASE_URL", "postgresql://asap:asap@localhost:5432/postgres")
TEST_DB = "asapawge_worker_test"
TEST_URL = os.environ.get("TEST_DATABASE_URL", f"postgresql://asap:asap@localhost:5432/{TEST_DB}")
DEV_KEY = "ZGV2LW9ubHktc3RvY2sta2V5LTMyLWJ5dGVzLWxvbiE="

# must happen before `app.config.get_settings()` is first called
os.environ["WORKER_INTERNAL_TOKEN"] = "test-token"
os.environ["DATABASE_URL"] = TEST_URL
os.environ["STOCK_ENCRYPTION_KEY"] = DEV_KEY
os.environ["STEAM_TOPUP_PROVIDER"] = "mock"
os.environ["AI_PROVIDER"] = "mock"
for _k in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"):
    os.environ[_k] = ""

MIGRATIONS = Path(__file__).resolve().parents[3] / "packages" / "db" / "prisma" / "migrations"


def _dsn(url: str) -> str:
    return url.split("?")[0]


async def _ensure_database() -> None:
    admin = await asyncpg.connect(_dsn(ADMIN_URL))
    try:
        exists = await admin.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", urlsplit(TEST_URL).path.lstrip("/"))
        if not exists:
            await admin.execute(f'CREATE DATABASE "{urlsplit(TEST_URL).path.lstrip("/")}"')
    finally:
        await admin.close()
    conn = await asyncpg.connect(_dsn(TEST_URL))
    try:
        has_schema = await conn.fetchval("SELECT to_regclass('public.\"Order\"') IS NOT NULL")
        if not has_schema:
            for sql in sorted(MIGRATIONS.glob("*/migration.sql")):
                await conn.execute(sql.read_text())
    finally:
        await conn.close()


@pytest_asyncio.fixture(scope="session")
async def engine():
    from app.db import make_engine

    try:
        await _ensure_database()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"PostgreSQL not available for DB tests: {exc}")
    eng = make_engine(TEST_URL, pool_size=5)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def factory(engine):
    """Empty database for every test."""
    from sqlalchemy import text

    from app.db import make_session_factory

    async with engine.begin() as conn:
        tables = [r[0] for r in await conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'"))]
        await conn.execute(text("TRUNCATE " + ", ".join(f'"{t}"' for t in tables) + " CASCADE"))
    return make_session_factory(engine)
