import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@asap/db";
import { cartAddSchema } from "@asap/shared";
import { resolveCartOwner } from "@/server/cart/context";
import { addItem, getCartView } from "@/server/cart/service";
import { steamLoginSchema } from "@/server/cart/meta";
import { trackEvent } from "@/server/analytics/track";
import { checkSteamLogin } from "@/server/topup/provider";

/**
 * Storefront -> cart bridge (zone A). Delegates to zone B's cart service (`@/server/cart/service.addItem`), which owns
 * pricing, stock caps, meta whitelisting and the guest cookie. On top of that the storefront re-validates the Steam login
 * with the TopupProvider for TOPUP products (never trust the client) and tracks `add_to_cart`.
 * `meta` keys set by the storefront: steamLogin, amountKopecks, buyerInput (see docs/CONTRACTS.md §20-A).
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export interface CartAddData {
  cartCount: number;
  lineId: string;
}

export async function addItemToCart(rawInput: unknown): Promise<ActionResult<CartAddData>> {
  const parsed = cartAddSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "Некорректные данные корзины" };
  const input = parsed.data;

  const product = await prisma.product.findFirst({ where: { id: input.productId, status: "ACTIVE" }, select: { type: true, deliveryMode: true, platform: true } });
  if (!product) return { ok: false, error: "Товар недоступен" };

  const meta = (input.meta ?? {}) as Record<string, unknown>;
  if (product.type === "TOPUP" && product.platform === "STEAM") {
    const login = steamLoginSchema.safeParse(meta.steamLogin);
    if (!login.success) {
      const msg = login.error.issues[0]?.message ?? "Укажите логин Steam";
      return { ok: false, error: msg, fieldErrors: { steamLogin: msg, login: msg } };
    }
    // re-validate with the supplier (cached 10 min)
    const check = await checkSteamLogin(login.data).catch(() => null);
    if (!check) return { ok: false, error: "Не удалось проверить логин Steam. Попробуйте позже." };
    if (!check.ok) {
      const reason = check.reason ?? "Аккаунт Steam не найден";
      return { ok: false, error: reason, fieldErrors: { steamLogin: reason, login: reason } };
    }
  }
  if (product.deliveryMode === "MANUAL" && typeof meta.buyerInput !== "string") {
    return { ok: false, error: "Укажите данные для выдачи (логин, UID или email)", fieldErrors: { buyerInput: "Укажите данные для выдачи" } };
  }

  const { owner, userId } = await resolveCartOwner({ create: true });
  if (!owner) return { ok: false, error: "Не удалось открыть корзину" };
  const res = await addItem(owner, { productId: input.productId, variantId: input.variantId ?? null, quantity: input.quantity, meta: input.meta });
  if (!res.ok) return { ok: false, error: res.error };

  const view = await getCartView(owner);
  void trackEvent({
    name: "add_to_cart",
    userId,
    sessionId: (await cookies()).get("asap_sid")?.value ?? null,
    path: "/product",
    properties: { productId: input.productId, variantId: input.variantId ?? null, quantity: res.data.quantity, value: (res.data.unitPrice * input.quantity) / 100 },
  });
  return { ok: true, data: { cartCount: view.count, lineId: res.data.itemId } };
}
