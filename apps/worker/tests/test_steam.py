import httpx
import pytest

from app.providers import HttpSteamProvider, MockSteamProvider, ProviderError


async def test_mock_provider_is_deterministic_and_rules_match_web():
    p = MockSteamProvider()
    assert (await p.check_login("gamer_01")).ok
    assert not (await p.check_login("ab")).ok
    bad = await p.check_login("user_NOTFOUND")
    assert not bad and "не найден" in bad.reason
    a = await p.topup("gamer_01", 1000, "ref1")
    b = await p.topup("gamer_01", 1000.0, "ref1")
    assert a == b and a.status == "completed" and a.tx_id.startswith("mock_") and len(a.tx_id) == 17
    assert (await p.topup("nouser1", 100, "r")).status == "failed"
    # same id algorithm as apps/web/src/server/topup/provider.ts: sha256("ref1:gamer_01:1000")[:12]
    assert a.tx_id == "mock_" + __import__("hashlib").sha256(b"ref1:gamer_01:1000").hexdigest()[:12]


def http_provider(handler):
    return HttpSteamProvider("https://supplier.example/api", "KEY", client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))


async def test_http_provider_contract():
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen[req.url.path] = (req.headers["authorization"], req.content)
        if req.url.path.endswith("/check-login"):
            return httpx.Response(200, json={"valid": True, "name": "Gabe"})
        if req.method == "POST" and req.url.path.endswith("/topup"):
            return httpx.Response(200, json={"status": "pending", "id": "T-1"})
        return httpx.Response(200, json={"status": "completed", "id": "T-1"})

    p = http_provider(handler)
    assert (await p.check_login("gabe")).display_name == "Gabe"
    r = await p.topup("gabe", 500, "item1")
    assert (r.status, r.tx_id) == ("pending", "T-1")
    assert seen["/api/steam/topup"][0] == "Bearer KEY" and b'"ref":"item1"' in seen["/api/steam/topup"][1].replace(b" ", b"")
    assert (await p.status("item1", "T-1")).status == "completed"


async def test_http_provider_error_semantics():
    p500 = http_provider(lambda r: httpx.Response(503, text="down"))
    with pytest.raises(ProviderError):
        await p500.topup("gabe", 100, "r")

    def boom(req):
        raise httpx.ConnectError("refused")

    with pytest.raises(ProviderError):
        await http_provider(boom).topup("gabe", 100, "r")
    # 4xx = supplier refuses the request itself -> business failure, never retried
    p400 = http_provider(lambda r: httpx.Response(400, json={"error": "insufficient supplier balance"}))
    res = await p400.topup("gabe", 100, "r")
    assert res.status == "failed" and "insufficient" in res.message
    with pytest.raises(ProviderError):
        await http_provider(lambda r: httpx.Response(200, json={"status": "weird"})).topup("gabe", 100, "r")
    with pytest.raises(ProviderError):
        await http_provider(lambda r: httpx.Response(200, text="<html>")).topup("gabe", 100, "r")
