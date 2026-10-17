import "server-only";
import { prisma } from "@asap/db";
import { API_SCOPES, ROLE_SCOPES, apiKeyCreateSchema, generateApiKey, idSchema, type ApiScope } from "@asap/shared";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/server/audit";
import type { SessionUser } from "@/server/auth/session";
import { fail, ok, zodFail, type ActionResult } from "./result";

export const MAX_ACTIVE_API_KEYS = 10;

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  role: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** computed on the server: revoked / expired / active */
  state: "active" | "revoked" | "expired";
}

/** Key metadata for the cabinet UI. NEVER includes the hash. */
export async function listApiKeys(userId: string): Promise<ApiKeyRow[]> {
  const rows = await prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, prefix: true, scopes: true, role: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true },
  });
  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    state: r.revokedAt ? ("revoked" as const) : r.expiresAt && r.expiresAt.getTime() <= now ? ("expired" as const) : ("active" as const),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Scopes the user's role may grant (CONTRACTS §12). */
export function allowedScopes(role: SessionUser["role"]): readonly ApiScope[] {
  return ROLE_SCOPES[role];
}

/**
 * Create a key. The full key is returned ONCE; only sha256(key) + the display prefix are stored.
 * Effective role is snapshotted from the user; scopes are limited to ROLE_SCOPES[role].
 */
export async function createApiKey(user: Pick<SessionUser, "id" | "role">, raw: unknown): Promise<ActionResult<{ key: string; id: string }>> {
  const parsed = apiKeyCreateSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const allowed = new Set<string>(ROLE_SCOPES[user.role]);
  const scopes = [...new Set(parsed.data.scopes)].filter((s) => (API_SCOPES as readonly string[]).includes(s));
  if (scopes.some((s) => !allowed.has(s))) return fail("Среди прав есть недоступные для вашей роли");
  const rl = await rateLimit({ key: `apikey-create:${user.id}`, limit: 10, windowSec: 3600 });
  if (!rl.ok) return fail("Слишком много попыток создания ключей. Попробуйте позже.");

  const active = await prisma.apiKey.count({ where: { userId: user.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
  if (active >= MAX_ACTIVE_API_KEYS) return fail(`Достигнут лимит активных ключей (${MAX_ACTIVE_API_KEYS}). Отзовите ненужные.`);

  const { key, prefix, hash } = generateApiKey();
  const expiresAt = parsed.data.expiresInDays ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000) : null;
  const row = await prisma.apiKey.create({ data: { userId: user.id, name: parsed.data.name, prefix, hash, scopes, role: user.role, expiresAt }, select: { id: true } });
  await writeAudit({ actorId: user.id, action: "apikey.create", entityType: "ApiKey", entityId: row.id, after: { name: parsed.data.name, scopes, prefix } }).catch(() => {});
  return ok({ key, id: row.id });
}

export async function revokeApiKey(user: Pick<SessionUser, "id">, rawId: unknown): Promise<ActionResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return fail("Ключ не найден");
  const res = await prisma.apiKey.updateMany({ where: { id: id.data, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (res.count !== 1) return fail("Ключ не найден или уже отозван");
  await writeAudit({ actorId: user.id, action: "apikey.revoke", entityType: "ApiKey", entityId: id.data }).catch(() => {});
  return ok();
}

