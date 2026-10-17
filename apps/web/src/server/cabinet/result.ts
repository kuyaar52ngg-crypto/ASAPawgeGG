import { z } from "zod";
import type { AuthError } from "@/server/auth/session";

/** Server-action result envelope (CONTRACTS §5). Messages are Russian and safe to show to the user. */
export type ActionFailure = { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };
export type ActionResult<T = null> = { ok: true; data: T } | ActionFailure;

export function ok(): { ok: true; data: null };
export function ok<T>(data: T): { ok: true; data: T };
export function ok<T>(data?: T) {
  return { ok: true as const, data: (data ?? null) as T };
}

export function fail(error: string, fieldErrors?: Record<string, string[] | undefined>): ActionFailure {
  return { ok: false, error, fieldErrors };
}

/** Turn a zod failure into an ActionFailure (first issue as the headline, per-field messages attached). */
export function zodFail(error: z.ZodError): ActionFailure {
  const fieldErrors = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  return fail(error.issues[0]?.message ?? "Проверьте введённые данные", fieldErrors);
}

// Duck-typed on purpose: importing the AuthError class would pull Auth.js (next-auth) into every service and its unit/integration tests.
function isAuthError(e: unknown): e is AuthError {
  return e instanceof Error && ((e as { code?: unknown }).code === "UNAUTHENTICATED" || (e as { code?: unknown }).code === "FORBIDDEN");
}

/** Runs an action body, converting AuthError into a failed result. Unexpected errors are logged and masked. */
export async function guarded<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    if (isAuthError(e)) return fail(e.code === "UNAUTHENTICATED" ? "Войдите в аккаунт, чтобы продолжить" : e.message || "Недостаточно прав для этого действия");
    console.error("[cabinet] action failed:", e);
    return fail("Что-то пошло не так. Попробуйте ещё раз.");
  }
}
