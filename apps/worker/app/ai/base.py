"""Provider abstraction for the worker's AI jobs: one `LLMProvider.chat()` contract, three HTTP adapters (OpenAI, Anthropic
Claude, OpenRouter) and a router with a fallback chain. Plain `httpx` — no vendor SDK lock-in, trivially mockable in tests."""
from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


class LLMError(Exception):
    """Provider call failed (network, HTTP error, empty/invalid answer). The router falls through to the next provider."""


@dataclass(frozen=True, slots=True)
class ChatMessage:
    role: str  # system | user | assistant
    content: str


@dataclass(slots=True)
class LLMResult:
    text: str
    provider: str
    model: str
    tokens_in: int = 0
    tokens_out: int = 0
    latency_ms: int = 0
    raw: dict[str, Any] = field(default_factory=dict)


class LLMProvider(ABC):
    name: str
    model: str

    @abstractmethod
    async def chat(self, messages: list[ChatMessage], *, json_mode: bool = False, max_tokens: int = 800, temperature: float = 0.2) -> LLMResult: ...


_FENCE = re.compile(r"^```(?:json|JSON)?\s*|\s*```$", re.MULTILINE)


def extract_json_object(text: str) -> dict[str, Any]:
    """Pull the first JSON object out of an LLM answer (handles ```json fences and chatter around the object)."""
    cleaned = _FENCE.sub("", text.strip()).strip()
    try:
        value = json.loads(cleaned)
        if isinstance(value, dict):
            return value
    except json.JSONDecodeError:
        pass
    start = cleaned.find("{")
    while start != -1:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(cleaned)):
            ch = cleaned[i]
            if in_str:
                esc = (not esc) and ch == "\\"
                if ch == '"' and not esc:
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        value = json.loads(cleaned[start : i + 1])
                        if isinstance(value, dict):
                            return value
                    except json.JSONDecodeError:
                        pass
                    break
        start = cleaned.find("{", start + 1)
    raise LLMError("model did not return a JSON object")
