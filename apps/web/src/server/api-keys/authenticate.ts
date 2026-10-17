import "server-only";
import { prisma } from "@asap/db";
import { hashApiKey, type ApiScope, type RoleName } from "@asap/shared";
import { rateLimit } from "@/lib/rate-limit";
import type { SessionUser } from "@/server/auth/session";
import { effectiveScopes, extractApiKey, keyRejection, minRole } from "./core";

export interface ApiPrincipal {
  keyId: string;
  keyPrefix: string;
  /** effective role (min of key role and current user role) */
  role: RoleName;
  scopes: ApiScope[];
  user: SessionUser;
}

export interface ApiAuthFailure {
  ok: false;
  status: 401 | 403 | 429;
  code: "missing_api_key" | "invalid_api_key" | "key_revoked" | "key_expired" | "user_banned" | "rate_limited";
  message: string;
  retryAfter?: number;
}

export type ApiAuthResult = { ok: true; principal: ApiPrincipal; rate: { limit: number; remaining: number } } | ApiAuthFailure;

/** Requests per minute per key. */
export const API_RATE_LIMIT_PER_MIN = 120;
const LAST_USED_THROTTLE_MS = 60_000;

/**
 * Authenticates a request by API key: lookup by sha256 hash, rejects revoked / expired keys and banned users,
 * loads the user fresh from the DB (authoritative role + balance), computes the effective role and scopes,
 * rate-limits per key and touches `lastUsedAt` (at most once a minute).
 */
export async function authenticateApiKey(req: Request, opts: { rateLimitPerMin?: number } = {}): Promise<ApiAuthResult> {
  const key = extractApiKey(req.headers);
  if (!key) {
    const hadHeader = Boolean(req.headers.get("authorization") || req.headers.get("x-api-key"));
    return { ok: false, status: 401, code: hadHeader ? "invalid_api_key" : "missing_api_key", message: hadHeader ? "Недействительный API-ключ" : "Передайте API-ключ в заголовке Authorization: Bearer ak_live_…" };
  }
  const row = await prisma.apiKey.findUnique({
    where: { hash: hashApiKey(key) },
    select: { id: true, prefix: true, scopes: true, role: true, revokedAt: true, expiresAt: true, lastUsedAt: true, user: { select: { id: true, email: true, name: true, image: true, role: true, balance: true, banned: true } } },
  });
  if (!row) return { ok: false, status: 401, code: "invalid_api_key", message: "Недействительный API-ключ" };
  const rejected = keyRejection({ revokedAt: row.revokedAt, expiresAt: row.expiresAt, userBanned: row.user.banned });
  if (rejected === "revoked") return { ok: false, status: 401, code: "key_revoked", message: "Ключ отозван" };
  if (rejected === "expired") return { ok: false, status: 401, code: "key_expired", message: "Срок действия ключа истёк" };
  if (rejected === "banned") return { ok: false, status: 403, code: "user_banned", message: "Аккаунт заблокирован" };

  const limit = opts.rateLimitPerMin ?? API_RATE_LIMIT_PER_MIN;
  const rl = await rateLimit({ key: `apikey:${row.id}`, limit, windowSec: 60 });
  if (!rl.ok) return { ok: false, status: 429, code: "rate_limited", message: "Превышен лимит запросов для этого ключа", retryAfter: rl.retryAfter };

  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    void prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }

  const role = minRole(row.role, row.user.role);
  const user: SessionUser = { id: row.user.id, email: row.user.email, name: row.user.name, image: row.user.image, role, balance: row.user.balance };
  return { ok: true, principal: { keyId: row.id, keyPrefix: row.prefix, role, scopes: effectiveScopes(row.scopes, role), user }, rate: { limit, remaining: rl.remaining } };
}
