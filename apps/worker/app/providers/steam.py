"""Steam wallet top-up supplier adapters (AUTO_PROVIDER delivery) — docs/CONTRACTS.md §10.

    TopupProvider { check_login(login) -> CheckLoginResult (truthy when ok); topup(login, amount_rub, ref) -> TopupResult }

* `MockSteamProvider`  — default (`STEAM_TOPUP_PROVIDER=mock`). Deterministic, clearly labelled sandbox. Same rules as the web
  side (`apps/web/src/server/topup/provider.ts`): logins containing invalid/notfound/nouser are rejected, tx id =
  "mock_" + sha256(f"{ref}:{login}:{amount}")[:12].
* `HttpSteamProvider`  — real supplier over HTTP (`STEAM_TOPUP_PROVIDER=http`, `STEAM_TOPUP_API_URL`, `STEAM_TOPUP_API_KEY`).
  The generic JSON contract below is what we expect from a reseller API — VERIFY / ADAPT against the chosen supplier's
  documentation before production:
      POST {url}/steam/check-login   {login}                              -> {valid: bool, name?: str, error?: str}
      POST {url}/steam/topup         {login, amount, currency:"RUB", ref} -> {status: completed|pending|failed, id: str, error?: str}
      GET  {url}/steam/topup/{ref}                                         -> {status: completed|pending|failed, id?: str, error?: str}
  `ref` is our idempotency key (OrderItem.id): the supplier must return the existing operation for a repeated `ref`.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Literal, Protocol

import httpx

from ..config import get_settings

LOGIN_RE = re.compile(r"^[A-Za-z0-9_.-]{3,64}$")
REJECT_RE = re.compile(r"(invalid|notfound|nouser)", re.IGNORECASE)

TopupStatus = Literal["completed", "pending", "failed"]


class ProviderError(Exception):
    """Transient supplier failure (network, 5xx, malformed answer): the caller may retry. Business refusals are `failed` results."""


@dataclass(frozen=True, slots=True)
class CheckLoginResult:
    ok: bool
    display_name: str | None = None
    reason: str | None = None
    source: str = "mock"

    def __bool__(self) -> bool:
        return self.ok


@dataclass(frozen=True, slots=True)
class TopupResult:
    status: TopupStatus
    tx_id: str
    message: str | None = None
    raw: dict | None = None


class TopupProvider(Protocol):
    name: str

    async def check_login(self, login: str) -> CheckLoginResult: ...

    async def topup(self, login: str, amount_rub: int | float, ref: str) -> TopupResult: ...

    async def status(self, ref: str, tx_id: str | None = None) -> TopupResult: ...


def _fmt_amount(amount: int | float) -> str:
    return str(int(amount)) if float(amount).is_integer() else str(amount)


class MockSteamProvider:
    name = "mock"

    async def check_login(self, login: str) -> CheckLoginResult:
        if not LOGIN_RE.match(login or ""):
            return CheckLoginResult(False, reason="Логин Steam: 3–64 символа, латиница, цифры, _ . -", source="mock")
        if REJECT_RE.search(login):
            return CheckLoginResult(False, reason="Аккаунт Steam с таким логином не найден", source="mock")
        return CheckLoginResult(True, display_name=login, source="mock")

    @staticmethod
    def _tx_id(login: str, amount_rub: int | float, ref: str) -> str:
        digest = hashlib.sha256(f"{ref}:{login}:{_fmt_amount(amount_rub)}".encode()).hexdigest()
        return f"mock_{digest[:12]}"

    async def topup(self, login: str, amount_rub: int | float, ref: str) -> TopupResult:
        tx_id = self._tx_id(login, amount_rub, ref)
        check = await self.check_login(login)
        if not check.ok:
            return TopupResult("failed", tx_id, check.reason or "Аккаунт не найден")
        return TopupResult("completed", tx_id, "Sandbox: пополнение эмулировано")

    async def status(self, ref: str, tx_id: str | None = None) -> TopupResult:
        return TopupResult("completed", tx_id or f"mock_{hashlib.sha256(ref.encode()).hexdigest()[:12]}", "Sandbox")


class HttpSteamProvider:
    name = "http"

    def __init__(self, base_url: str, api_key: str, *, client: httpx.AsyncClient | None = None, timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self._client = client
        self._timeout = timeout

    def _headers(self) -> dict[str, str]:
        return {"authorization": f"Bearer {self.api_key}", "content-type": "application/json", "accept": "application/json"}

    async def _request(self, method: str, path: str, *, json: dict | None = None, timeout: float | None = None) -> dict:
        url = f"{self.base_url}{path}"
        try:
            if self._client is not None:
                res = await self._client.request(method, url, json=json, headers=self._headers(), timeout=timeout or self._timeout)
            else:
                async with httpx.AsyncClient() as client:
                    res = await client.request(method, url, json=json, headers=self._headers(), timeout=timeout or self._timeout)
        except httpx.HTTPError as exc:
            raise ProviderError(f"supplier unreachable: {exc.__class__.__name__}") from exc
        if res.status_code >= 500 or res.status_code == 429:
            raise ProviderError(f"supplier responded {res.status_code}")
        if res.status_code >= 400:
            # 4xx = the supplier refused the request itself (bad login, no funds...) -> business failure, not transient
            try:
                body = res.json()
            except ValueError:
                body = {}
            return {"status": "failed", "error": str(body.get("error") or body.get("message") or f"supplier responded {res.status_code}"), "valid": False}
        try:
            data = res.json()
        except ValueError as exc:
            raise ProviderError("supplier returned non-JSON") from exc
        if not isinstance(data, dict):
            raise ProviderError("supplier returned unexpected payload")
        return data

    async def check_login(self, login: str) -> CheckLoginResult:
        if not LOGIN_RE.match(login or ""):
            return CheckLoginResult(False, reason="Логин Steam: 3–64 символа, латиница, цифры, _ . -", source="http")
        data = await self._request("POST", "/steam/check-login", json={"login": login}, timeout=10)
        if data.get("valid"):
            return CheckLoginResult(True, display_name=str(data.get("name") or login), source="http")
        return CheckLoginResult(False, reason=str(data.get("error") or "Аккаунт Steam не найден"), source="http")

    @staticmethod
    def _to_result(data: dict, fallback_id: str) -> TopupResult:
        status = data.get("status")
        if status not in ("completed", "pending", "failed"):
            raise ProviderError(f"supplier returned unknown status {status!r}")
        return TopupResult(status, str(data.get("id") or fallback_id), data.get("error"), raw={k: v for k, v in data.items() if k != "token"})

    async def topup(self, login: str, amount_rub: int | float, ref: str) -> TopupResult:
        data = await self._request("POST", "/steam/topup", json={"login": login, "amount": amount_rub, "currency": "RUB", "ref": ref})
        return self._to_result(data, "")

    async def status(self, ref: str, tx_id: str | None = None) -> TopupResult:
        data = await self._request("GET", f"/steam/topup/{ref}", timeout=15)
        return self._to_result(data, tx_id or "")


_instance: TopupProvider | None = None


def get_topup_provider() -> TopupProvider:
    global _instance
    if _instance is None:
        s = get_settings()
        if s.steam_topup_provider.lower() == "http" and s.steam_topup_api_url and s.steam_topup_api_key:
            _instance = HttpSteamProvider(s.steam_topup_api_url, s.steam_topup_api_key)
        else:
            _instance = MockSteamProvider()
    return _instance


def reset_topup_provider() -> None:
    global _instance
    _instance = None
