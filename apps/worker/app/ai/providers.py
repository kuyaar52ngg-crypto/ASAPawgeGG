"""HTTP adapters: OpenAI, OpenRouter (OpenAI-compatible, https://openrouter.ai/api/v1) and Anthropic Claude."""
from __future__ import annotations

import time
from typing import Any

import httpx

from .base import ChatMessage, LLMError, LLMProvider, LLMResult

DEFAULT_MODELS = {"openai": "gpt-4o-mini", "anthropic": "claude-haiku-4-5", "openrouter": "openai/gpt-4o-mini"}
OPENAI_URL = "https://api.openai.com/v1"
OPENROUTER_URL = "https://openrouter.ai/api/v1"
ANTHROPIC_URL = "https://api.anthropic.com/v1"


class _HttpProvider(LLMProvider):
    def __init__(self, api_key: str, model: str, *, base_url: str, client: httpx.AsyncClient | None = None, timeout: float = 40.0) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self._client = client
        self._timeout = timeout

    async def _post(self, path: str, headers: dict[str, str], body: dict[str, Any]) -> dict[str, Any]:
        try:
            if self._client is not None:
                res = await self._client.post(f"{self.base_url}{path}", headers=headers, json=body, timeout=self._timeout)
            else:
                async with httpx.AsyncClient() as client:
                    res = await client.post(f"{self.base_url}{path}", headers=headers, json=body, timeout=self._timeout)
        except httpx.HTTPError as exc:
            raise LLMError(f"{self.name}: network error {exc.__class__.__name__}") from exc
        if res.status_code >= 400:
            raise LLMError(f"{self.name}: HTTP {res.status_code}: {res.text[:200]}")
        try:
            data = res.json()
        except ValueError as exc:
            raise LLMError(f"{self.name}: non-JSON response") from exc
        if not isinstance(data, dict):
            raise LLMError(f"{self.name}: unexpected response")
        return data


class OpenAICompatProvider(_HttpProvider):
    """OpenAI `/chat/completions`; OpenRouter speaks the same protocol (different base_url + attribution headers)."""

    def __init__(self, name: str, api_key: str, model: str, *, base_url: str, client: httpx.AsyncClient | None = None, timeout: float = 40.0) -> None:
        super().__init__(api_key, model, base_url=base_url, client=client, timeout=timeout)
        self.name = name

    async def chat(self, messages: list[ChatMessage], *, json_mode: bool = False, max_tokens: int = 800, temperature: float = 0.2) -> LLMResult:
        headers = {"authorization": f"Bearer {self.api_key}", "content-type": "application/json"}
        if self.name == "openrouter":
            headers.update({"HTTP-Referer": "https://asapawge.gg", "X-Title": "ASAPawge GG"})
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        t0 = time.perf_counter()
        data = await self._post("/chat/completions", headers, body)
        try:
            text = (data["choices"][0]["message"]["content"] or "").strip()
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError(f"{self.name}: malformed completion") from exc
        if not text:
            raise LLMError(f"{self.name}: empty completion")
        usage = data.get("usage") or {}
        return LLMResult(text, self.name, str(data.get("model") or self.model), int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0), int((time.perf_counter() - t0) * 1000))


class AnthropicProvider(_HttpProvider):
    name = "anthropic"

    def __init__(self, api_key: str, model: str, *, base_url: str = ANTHROPIC_URL, client: httpx.AsyncClient | None = None, timeout: float = 40.0) -> None:
        super().__init__(api_key, model, base_url=base_url, client=client, timeout=timeout)

    async def chat(self, messages: list[ChatMessage], *, json_mode: bool = False, max_tokens: int = 800, temperature: float = 0.2) -> LLMResult:
        system = "\n\n".join(m.content for m in messages if m.role == "system")
        convo = [{"role": m.role, "content": m.content} for m in messages if m.role != "system"]
        if json_mode:  # Claude has no JSON-mode flag (and newer models reject assistant prefill): ask in the system prompt
            system = (system + "\n\n" if system else "") + "Respond with a single valid JSON object and nothing else."
        body: dict[str, Any] = {"model": self.model, "max_tokens": max_tokens, "temperature": temperature, "messages": convo}
        if system:
            body["system"] = system
        headers = {"x-api-key": self.api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
        t0 = time.perf_counter()
        data = await self._post("/messages", headers, body)
        parts = [b.get("text", "") for b in (data.get("content") or []) if isinstance(b, dict) and b.get("type") == "text"]
        text = "".join(parts).strip()
        if not text:
            raise LLMError("anthropic: empty completion")
        usage = data.get("usage") or {}
        return LLMResult(text, self.name, str(data.get("model") or self.model), int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0), int((time.perf_counter() - t0) * 1000))
