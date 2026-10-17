import { isApiKeyFormat } from "@asap/shared";
import { ApiError, AsapApiClient, type FetchLike, type Me } from "./api-client";

/** `Authorization: Bearer ak_live_…` or `X-API-Key`. Returns null unless the value is a well-formed key. */
export function extractKey(headers: Record<string, string | string[] | undefined>): string | null {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const auth = one(headers["authorization"]);
  const m = auth ? /^Bearer\s+(\S+)$/i.exec(auth.trim()) : null;
  const candidate = m?.[1] ?? one(headers["x-api-key"])?.trim();
  return candidate && isApiKeyFormat(candidate) ? candidate : null;
}

export type Verification = { ok: true; me: Me; client: AsapApiClient } | { ok: false; status: 401 | 403 | 429 | 502; message: string };

/**
 * Verifies a key by asking the web app (`GET /me`) — the single source of truth for revocation, expiry, bans and scopes.
 * Successful results are cached for a short time so a tool-heavy session does not double every request.
 */
export class KeyVerifier {
  private cache = new Map<string, { me: Me; expires: number }>();

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl?: FetchLike,
    private readonly ttlMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  async verify(key: string | null): Promise<Verification> {
    if (!key) return { ok: false, status: 401, message: "Передайте API-ключ: заголовок Authorization: Bearer ak_live_…" };
    const client = new AsapApiClient(this.baseUrl, key, this.fetchImpl);
    const hit = this.cache.get(key);
    if (hit && hit.expires > this.now()) return { ok: true, me: hit.me, client };
    try {
      const me = await client.me();
      this.cache.set(key, { me, expires: this.now() + this.ttlMs });
      if (this.cache.size > 500) for (const [k, v] of this.cache) if (v.expires <= this.now()) this.cache.delete(k);
      return { ok: true, me, client };
    } catch (e) {
      this.cache.delete(key);
      if (e instanceof ApiError) {
        if (e.status === 401) return { ok: false, status: 401, message: e.message };
        if (e.status === 403) return { ok: false, status: 403, message: e.message };
        if (e.status === 429) return { ok: false, status: 429, message: e.message };
      }
      return { ok: false, status: 502, message: "Сервис ASAPawge временно недоступен" };
    }
  }
}
