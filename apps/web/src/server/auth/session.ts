import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@asap/db";
import type { RoleName } from "@asap/shared";
import { auth } from "@/auth";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: RoleName;
  /** kopecks */
  balance: number;
}

export class AuthError extends Error {
  constructor(
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN",
    message?: string,
  ) {
    super(message ?? (code === "UNAUTHENTICATED" ? "Требуется вход" : "Недостаточно прав"));
  }
}

/**
 * Current user loaded FRESH from the DB (authoritative role / ban state), memoised per request.
 * Returns null for guests and banned users. Use in RSC for optional-auth UI (header etc.).
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const u = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, image: true, role: true, balance: true, banned: true },
  });
  if (!u || u.banned) return null;
  return { id: u.id, email: u.email, name: u.name, image: u.image, role: u.role, balance: u.balance };
});

/** Pages / layouts: redirects to /sign-in when not authenticated. */
export async function requireUser(callbackUrl?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/sign-in${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`);
  return user;
}

/** Pages / layouts: requires one of the roles, else redirects to /forbidden (or /sign-in for guests). */
export async function requireRole(...roles: RoleName[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/forbidden");
  return user;
}

/**
 * Server actions / route handlers: throws AuthError instead of redirecting.
 * Usage:  const user = await assertRole("SELLER", "ADMIN");
 */
export async function assertRole(...roles: RoleName[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("UNAUTHENTICATED");
  if (roles.length && !roles.includes(user.role)) throw new AuthError("FORBIDDEN");
  return user;
}

export function hasRole(user: Pick<SessionUser, "role"> | null | undefined, ...roles: RoleName[]): boolean {
  return !!user && roles.includes(user.role);
}
