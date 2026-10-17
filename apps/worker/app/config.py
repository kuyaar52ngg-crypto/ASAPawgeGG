"""Worker settings, loaded from environment (root .env is loaded by the dev scripts / docker env)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../../.env", ".env"), extra="ignore")

    database_url: str = "postgresql://asap:asap@localhost:5432/asapawge"
    redis_url: str = "redis://localhost:6379"
    worker_internal_token: str = ""
    stock_encryption_key: str = ""
    web_internal_url: str = "http://localhost:3000"

    steam_topup_provider: str = "mock"
    steam_topup_api_url: str = ""
    steam_topup_api_key: str = ""

    ai_provider: str = "mock"
    ai_model: str = ""
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    openrouter_api_key: str = ""

    hold_days: int = 3
    commission_default_bps: int = 1000

    @property
    def async_database_url(self) -> str:
        """SQLAlchemy asyncpg URL (strip any ?schema= param Prisma-style URLs may carry)."""
        url = self.database_url.split("?")[0]
        return url.replace("postgresql://", "postgresql+asyncpg://", 1).replace("postgres://", "postgresql+asyncpg://", 1)


@lru_cache
def get_settings() -> Settings:
    return Settings()
