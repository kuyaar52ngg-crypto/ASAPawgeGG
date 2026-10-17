import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@asap/db";

/** Cookie holding the guest cart token (Cart.guestToken). Zone B (commerce) owns cart logic. */
export const GUEST_CART_COOKIE = "asap_cart";

/** Total quantity of items in the current cart (user cart, else guest cart). Used by the header badge. */
export async function getCartCount(userId?: string | null): Promise<number> {
  try {
    let where: { userId: string } | { guestToken: string } | null = null;
    if (userId) where = { userId };
    else {
      const token = (await cookies()).get(GUEST_CART_COOKIE)?.value;
      if (token) where = { guestToken: token };
    }
    if (!where) return 0;
    const agg = await prisma.cartItem.aggregate({ _sum: { quantity: true }, where: { cart: where } });
    return agg._sum.quantity ?? 0;
  } catch {
    return 0;
  }
}
