import "server-only";
import { cookies } from "next/headers";
import { getSessionUser } from "@/server/auth/session";
import { GUEST_CART_COOKIE } from "@/server/cart-count";
import { mergeGuestCart, newGuestToken, type CartOwner } from "./service";

export { GUEST_CART_COOKIE };
const THIRTY_DAYS = 60 * 60 * 24 * 30;

/**
 * Resolve the current cart owner from the request: signed-in user, else guest cookie.
 * `create: true` (server actions only) issues a guest cookie when none exists.
 * For a signed-in user a leftover guest cart is merged lazily (safety net next to the sign-in hook).
 */
export async function resolveCartOwner(opts: { create?: boolean } = {}): Promise<{ owner: CartOwner | null; userId: string | null }> {
  const jar = await cookies();
  const guestToken = jar.get(GUEST_CART_COOKIE)?.value;
  const user = await getSessionUser();
  if (user) {
    if (guestToken) {
      await mergeGuestCart(user.id, guestToken).catch((e) => console.warn("[cart] lazy merge failed:", (e as Error).message));
      if (opts.create) clearGuestCookie(jar);
    }
    return { owner: { userId: user.id }, userId: user.id };
  }
  if (guestToken) return { owner: { guestToken }, userId: null };
  if (!opts.create) return { owner: null, userId: null };
  const token = newGuestToken();
  jar.set(GUEST_CART_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && process.env.AUTH_TRUST_HOST !== "insecure", path: "/", maxAge: THIRTY_DAYS });
  return { owner: { guestToken: token }, userId: null };
}

function clearGuestCookie(jar: Awaited<ReturnType<typeof cookies>>) {
  try {
    jar.delete(GUEST_CART_COOKIE);
  } catch {
    /* read-only cookie store (RSC render) */
  }
}

/**
 * Called from the sign-in / sign-up server actions right after authentication:
 * merges the guest cart (cookie) into the user's cart and drops the cookie. Never throws.
 */
export async function mergeGuestCartForUser(userId: string): Promise<void> {
  try {
    const jar = await cookies();
    const token = jar.get(GUEST_CART_COOKIE)?.value;
    if (!token) return;
    await mergeGuestCart(userId, token);
    clearGuestCookie(jar);
  } catch (e) {
    console.warn("[cart] guest cart merge failed:", (e as Error).message);
  }
}

/** Sign-in hook: the Auth.js redirect was thrown after a successful login — find the user by email and merge their guest cart. */
export async function mergeGuestCartForEmail(email: string): Promise<void> {
  try {
    const { prisma } = await import("@asap/db");
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) await mergeGuestCartForUser(user.id);
  } catch (e) {
    console.warn("[cart] guest cart merge (email) failed:", (e as Error).message);
  }
}
