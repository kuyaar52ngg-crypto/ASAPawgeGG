import { API_SCOPES, ROLE_SCOPES, isApiKeyFormat, type ApiScope, type RoleName } from "@asap/shared";

/** Pure helpers of API-key authentication (CONTRACTS §12). No I/O — unit-tested without a database. */

const RANK: Record<RoleName, number> = { USER: 0, SELLER: 1, ADMIN: 2 };

/** Effective role = min(ApiKey.role, User.role): demoting a user instantly demotes their keys. */
export function minRole(a: RoleName, b: RoleName): RoleName {
  return RANK[a] <= RANK[b] ? a : b;
}

/** Scopes actually usable: the key's scopes ∩ what the effective role may hold. */
export function effectiveScopes(keyScopes: readonly string[], role: RoleName): ApiScope[] {
  const allowed = new Set<string>(ROLE_SCOPES[role]);
  return API_SCOPES.filter((s) => keyScopes.includes(s) && allowed.has(s));
}

/** `Authorization: Bearer ak_live_…` or `X-API-Key: ak_live_…`. Returns null for anything that is not a well-formed key. */
export function extractApiKey(headers: { get(name: string): string | null }): string | null {
  const auth = headers.get("authorization");
  let candidate: string | null = null;
  if (auth) {
    const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
    if (m) candidate = m[1]!;
  }
  candidate ??= headers.get("x-api-key")?.trim() || null;
  return candidate && isApiKeyFormat(candidate) ? candidate : null;
}

export type KeyRejection = "revoked" | "expired" | "banned";

export function keyRejection(row: { revokedAt: Date | null; expiresAt: Date | null; userBanned: boolean }, now = new Date()): KeyRejection | null {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (row.userBanned) return "banned";
  return null;
}

export function hasScope(scopes: readonly string[], required: ApiScope | readonly ApiScope[]): boolean {
  const need = Array.isArray(required) ? (required as readonly ApiScope[]) : [required as ApiScope];
  return need.every((s) => scopes.includes(s));
}
