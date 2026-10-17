import { describe, expect, it, vi } from "vitest";
import { generateApiKey } from "@asap/shared";
import { extractKey, KeyVerifier } from "./auth";

const KEY = generateApiKey().key;
const ME = { userId: "u1", name: "Test", role: "USER", scopes: ["catalog:read"], keyPrefix: KEY.slice(0, 16) };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("extractKey", () => {
  it("accepts a well-formed Bearer key", () => {
    expect(extractKey({ authorization: `Bearer ${KEY}` })).toBe(KEY);
    expect(extractKey({ authorization: `bearer   ${KEY} ` })).toBe(KEY);
  });
  it("accepts X-API-Key", () => {
    expect(extractKey({ "x-api-key": KEY })).toBe(KEY);
  });
  it("rejects malformed keys and other schemes", () => {
    expect(extractKey({})).toBeNull();
    expect(extractKey({ authorization: "Bearer ak_live_short" })).toBeNull();
    expect(extractKey({ authorization: `Basic ${KEY}` })).toBeNull();
    expect(extractKey({ authorization: `Bearer ${KEY.replace("ak_live_", "sk_live_")}` })).toBeNull();
    expect(extractKey({ authorization: "Bearer " })).toBeNull();
  });
});

describe("KeyVerifier", () => {
  it("rejects a missing key without calling the API", async () => {
    const f = vi.fn();
    const r = await new KeyVerifier("http://x/api/v1", f).verify(null);
    expect(r).toMatchObject({ ok: false, status: 401 });
    expect(f).not.toHaveBeenCalled();
  });

  it("verifies through GET /me with the caller's key and caches the result", async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
      return json(200, { ok: true, data: ME });
    });
    let t = 1000;
    const v = new KeyVerifier("http://x/api/v1", f, 30_000, () => t);
    const a = await v.verify(KEY);
    expect(a).toMatchObject({ ok: true, me: { role: "USER" } });
    expect(f.mock.calls[0]![0]).toBe("http://x/api/v1/me");
    await v.verify(KEY);
    expect(f).toHaveBeenCalledTimes(1); // cached
    t += 31_000;
    await v.verify(KEY);
    expect(f).toHaveBeenCalledTimes(2); // expired
  });

  it("maps upstream rejections (revoked key, banned user, rate limit)", async () => {
    const mk = (status: number, code: string) => new KeyVerifier("http://x/api/v1", async () => json(status, { ok: false, error: { code, message: "no" } }));
    expect(await mk(401, "key_revoked").verify(KEY)).toMatchObject({ ok: false, status: 401 });
    expect(await mk(403, "user_banned").verify(KEY)).toMatchObject({ ok: false, status: 403 });
    expect(await mk(429, "rate_limited").verify(KEY)).toMatchObject({ ok: false, status: 429 });
  });

  it("does not cache failures and reports an unreachable API as 502", async () => {
    const f = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const v = new KeyVerifier("http://x/api/v1", f);
    expect(await v.verify(KEY)).toMatchObject({ ok: false, status: 502 });
    expect(await v.verify(KEY)).toMatchObject({ ok: false, status: 502 });
    expect(f).toHaveBeenCalledTimes(2);
  });
});
