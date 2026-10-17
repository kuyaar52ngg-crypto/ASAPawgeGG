import "server-only";
import { z } from "zod";
import { prisma, type Prisma } from "@asap/db";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request";
import { AuthError, assertRole, type SessionUser } from "@/server/auth/session";

/** Server-action result envelope (CONTRACTS §5). Messages are Russian and safe to show. */
export type ActionFailure = { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };
export type ActionResult<T = null> = { ok: true; data: T } | ActionFailure;

export function ok(): { ok: true; data: null };
export function ok<T>(data: T): { ok: true; data: T };
export function ok<T>(data?: T) {
  return { ok: true as const, data: (data ?? null) as T };
}
export function fail(error: string, fieldErrors?: ActionFailure["fieldErrors"]): ActionFailure {
  return { ok: false, error, fieldErrors };
}
export function zodFail(error: z.ZodError): ActionFailure {
  return fail(error.issues[0]?.message ?? "Проверьте введённые данные", z.flattenError(error).fieldErrors as ActionFailure["fieldErrors"]);
}

export interface AdminCtx {
  admin: SessionUser;
  ip: string;
}

/** Thrown inside an action body to abort with a user-facing message. */
export class AdminError extends Error {}

/**
 * Wrapper for EVERY admin server action: verifies the ADMIN role against the DB (never trusts the client or the JWT),
 * rate-limits mutations per admin and converts failures to the `{ ok:false, error }` envelope.
 */
export async function adminAction<T>(fn: (ctx: AdminCtx) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    const admin = await assertRole("ADMIN");
    const rl = await rateLimit({ key: `admin-action:${admin.id}`, limit: 120, windowSec: 60 });
    if (!rl.ok) return fail("Слишком много действий подряд. Подождите минуту.");
    const ip = await getClientIp();
    return await fn({ admin, ip });
  } catch (e) {
    if (e instanceof AuthError) return fail(e.code === "UNAUTHENTICATED" ? "Войдите в аккаунт" : "Недостаточно прав");
    if (e instanceof AdminError) return fail(e.message);
    console.error("[admin] action failed:", e);
    return fail("Что-то пошло не так. Попробуйте ещё раз.");
  }
}

/** Parse an action payload with zod, returning an ActionFailure on error. */
export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): { data: z.infer<S>; error?: undefined } | { data?: undefined; error: ActionFailure } {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { error: zodFail(parsed.error) };
  return { data: parsed.data };
}

type Db = Prisma.TransactionClient | typeof prisma;

/** AuditLog row inside the caller's transaction, so a mutation and its audit trail commit (or roll back) together. */
export async function audit(
  db: Db,
  ctx: AdminCtx,
  entry: { action: string; entityType: string; entityId?: string | null; before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue },
) {
  await db.auditLog.create({
    data: { actorId: ctx.admin.id, action: entry.action, entityType: entry.entityType, entityId: entry.entityId ?? null, before: entry.before, after: entry.after, ip: ctx.ip },
  });
}

/** Page-size helper for admin tables. */
export const ADMIN_PAGE_SIZE = 25;

export function pageParam(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 10_000) : 1;
}
export function strParam(raw: string | string[] | undefined, max = 100): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (v ?? "").trim().slice(0, max);
}
