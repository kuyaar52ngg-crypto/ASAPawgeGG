"""Provider selection + fallback chain + AiLog writing.

Selection (docs/CONTRACTS.md §12): `Setting("ai.provider")` > env `AI_PROVIDER`; "mock"/empty-with-no-keys means heuristics only.
The preferred provider goes first, then every other provider that has an API key (openai, anthropic, openrouter). When every
provider fails (or none is configured) the task's deterministic heuristic answers and the result is flagged `mock=True`.
Every attempt (success, failure, heuristic) is written to `AiLog` in its own transaction.
"""
from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx

from ..config import Settings, get_settings
from ..db import SessionFactory, session_scope
from ..models import AiLog
from ..settings_store import AI_MODEL, AI_PROVIDER, get_setting
from ..util import clip, new_id, utcnow
from .base import ChatMessage, LLMError, LLMProvider, extract_json_object
from .providers import ANTHROPIC_URL, DEFAULT_MODELS, OPENAI_URL, OPENROUTER_URL, AnthropicProvider, OpenAICompatProvider

log = logging.getLogger("worker.ai")

HEURISTIC_MODEL = "heuristic-v1"
_ORDER = ("openai", "anthropic", "openrouter")


@dataclass(slots=True)
class AiResult:
    data: dict[str, Any]
    provider: str  # openai | anthropic | openrouter | mock
    model: str
    mock: bool
    tokens_in: int = 0
    tokens_out: int = 0
    error: str | None = None


def _key_for(settings: Settings, name: str) -> str:
    return {"openai": settings.openai_api_key, "anthropic": settings.anthropic_api_key, "openrouter": settings.openrouter_api_key}[name].strip()


def build_chain(settings: Settings, preferred: str | None, model: str | None, client: httpx.AsyncClient | None = None) -> list[LLMProvider]:
    """Providers to try, in order. `model` overrides the default model of the PREFERRED provider only (model ids are provider-specific)."""
    pref = (preferred or "").strip().lower()
    if pref == "mock":
        return []
    names = [n for n in _ORDER if _key_for(settings, n)]
    if pref in _ORDER and pref in names:
        names.remove(pref)
        names.insert(0, pref)
    chain: list[LLMProvider] = []
    for idx, name in enumerate(names):
        mdl = (model or "").strip() if (idx == 0 and name == pref and model) else ""
        mdl = mdl or DEFAULT_MODELS[name]
        key = _key_for(settings, name)
        timeout = settings.ai_timeout_seconds
        if name == "anthropic":
            chain.append(AnthropicProvider(key, mdl, base_url=ANTHROPIC_URL, client=client, timeout=timeout))
        else:
            chain.append(OpenAICompatProvider(name, key, mdl, base_url=OPENROUTER_URL if name == "openrouter" else OPENAI_URL, client=client, timeout=timeout))
    return chain


async def resolve_chain(factory: SessionFactory, client: httpx.AsyncClient | None = None) -> list[LLMProvider]:
    settings = get_settings()
    async with factory() as s:
        db_provider = await get_setting(s, AI_PROVIDER, None)
        db_model = await get_setting(s, AI_MODEL, None)
    preferred = (db_provider if isinstance(db_provider, str) and db_provider else None) or settings.ai_provider
    model = (db_model if isinstance(db_model, str) and db_model else None) or settings.ai_model or None
    return build_chain(settings, preferred, model, client)


async def write_ai_log(
    factory: SessionFactory, *, provider: str, model: str, task: str, input: Any, output: Any, tokens_in: int, tokens_out: int, latency_ms: int, ok: bool, error: str | None = None, user_id: str | None = None
) -> None:
    try:
        async with session_scope(factory) as s:
            s.add(
                AiLog(
                    id=new_id(), userId=user_id, provider=provider, model=model, task=task, input=clip(input), output=clip(output), tokensIn=tokens_in,
                    tokensOut=tokens_out, latencyMs=latency_ms, ok=ok, error=error[:500] if error else None, createdAt=utcnow(),
                )
            )
    except Exception:  # noqa: BLE001 - logging must never break a job
        log.exception("AiLog write failed")


async def run_json_task(
    factory: SessionFactory,
    *,
    task: str,
    system: str,
    user: str,
    normalize: Callable[[dict[str, Any]], dict[str, Any]],
    heuristic: Callable[[], dict[str, Any]],
    log_input: Any,
    chain: list[LLMProvider] | None = None,
    user_id: str | None = None,
    max_tokens: int = 700,
) -> AiResult:
    """Ask the provider chain for a JSON verdict; fall back to the heuristic. `normalize` validates/clamps the model output
    (raise ValueError to treat it as a failed attempt)."""
    providers = chain if chain is not None else await resolve_chain(factory)
    messages = [ChatMessage("system", system), ChatMessage("user", user)]
    last_error: str | None = None
    for prov in providers:
        t0 = time.perf_counter()
        try:
            res = await prov.chat(messages, json_mode=True, max_tokens=max_tokens)
            data = normalize(extract_json_object(res.text))
        except (LLMError, ValueError, KeyError, TypeError) as exc:
            last_error = f"{prov.name}: {exc}"
            await write_ai_log(
                factory, provider=prov.name, model=prov.model, task=task, input=log_input, output=None, tokens_in=0, tokens_out=0,
                latency_ms=int((time.perf_counter() - t0) * 1000), ok=False, error=last_error, user_id=user_id,
            )
            log.warning("AI %s via %s failed: %s", task, prov.name, exc)
            continue
        await write_ai_log(
            factory, provider=res.provider, model=res.model, task=task, input=log_input, output=data, tokens_in=res.tokens_in, tokens_out=res.tokens_out,
            latency_ms=res.latency_ms, ok=True, user_id=user_id,
        )
        return AiResult(data, res.provider, res.model, False, res.tokens_in, res.tokens_out)

    t0 = time.perf_counter()
    data = heuristic()
    await write_ai_log(
        factory, provider="mock", model=HEURISTIC_MODEL, task=task, input=log_input, output=data, tokens_in=0, tokens_out=0,
        latency_ms=int((time.perf_counter() - t0) * 1000), ok=True, error=last_error, user_id=user_id,
    )
    return AiResult(data, "mock", HEURISTIC_MODEL, True, error=last_error)


AsyncChainFactory = Callable[[], Awaitable[list[LLMProvider]]]
