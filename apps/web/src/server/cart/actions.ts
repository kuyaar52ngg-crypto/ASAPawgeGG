"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { cartAddSchema, idSchema } from "@asap/shared";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request";
import { trackEvent } from "@/server/analytics/track";
import { resolveCartOwner } from "./context";
import { addItem, getCartView, removeItem, setItemMeta, setQuantity, type CartView } from "./service";

/** Server actions return `{ ok: true, data } | { ok: false, error }` (CONTRACTS §5). */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function guard(): Promise<{ ok: true } | { ok: false; error: string }> {
  const ip = await getClientIp();
  const rl = await rateLimit({ key: `cart:${ip}`, limit: 120, windowSec: 60 });
  return rl.ok ? { ok: true } : { ok: false, error: "Слишком много действий. Подождите минуту." };
}

async function sessionId(): Promise<string | undefined> {
  return (await cookies()).get("asap_sid")?.value;
}

function refresh() {
  // header badge lives in the root shop layout
  revalidatePath("/", "layout");
}

/** Add a product (variant) to the cart. Guests get a cookie cart; it is merged into the user cart on sign-in. */
export async function addToCart(input: z.input<typeof cartAddSchema>): Promise<ActionResult<{ itemId: string; quantity: number; cartCount: number }>> {
  const parsed = cartAddSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Некорректные данные товара" };
  const g = await guard();
  if (!g.ok) return g;
  const { owner, userId } = await resolveCartOwner({ create: true });
  if (!owner) return { ok: false, error: "Не удалось открыть корзину" };
  const res = await addItem(owner, { productId: parsed.data.productId, variantId: parsed.data.variantId ?? null, quantity: parsed.data.quantity, meta: parsed.data.meta });
  if (!res.ok) return res;
  const view = await getCartView(owner);
  void trackEvent({
    name: "add_to_cart",
    userId,
    sessionId: await sessionId(),
    properties: { productId: parsed.data.productId, variantId: parsed.data.variantId ?? null, quantity: parsed.data.quantity, value: res.data.unitPrice * parsed.data.quantity / 100 },
  });
  refresh();
  return { ok: true, data: { itemId: res.data.itemId, quantity: res.data.quantity, cartCount: view.count } };
}

const updateQtySchema = z.object({ itemId: idSchema, quantity: z.number().int().min(0).max(50) });

/** Set the quantity of a cart line (0 removes it). */
export async function updateQty(input: z.input<typeof updateQtySchema>): Promise<ActionResult<{ quantity: number }>> {
  const parsed = updateQtySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Некорректное количество" };
  const g = await guard();
  if (!g.ok) return g;
  const { owner } = await resolveCartOwner();
  if (!owner) return { ok: false, error: "Корзина пуста" };
  const res = await setQuantity(owner, parsed.data.itemId, parsed.data.quantity);
  if (!res.ok) return res;
  refresh();
  return { ok: true, data: res.data };
}

const removeSchema = z.object({ itemId: idSchema });

export async function removeFromCart(input: z.input<typeof removeSchema>): Promise<ActionResult> {
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Некорректная позиция" };
  const g = await guard();
  if (!g.ok) return g;
  const { owner, userId } = await resolveCartOwner();
  if (!owner) return { ok: false, error: "Корзина пуста" };
  const res = await removeItem(owner, parsed.data.itemId);
  if (!res.ok) return res;
  void trackEvent({
    name: "remove_from_cart",
    userId,
    sessionId: await sessionId(),
    properties: { productId: res.data.productId, variantId: res.data.variantId, quantity: res.data.quantity },
  });
  refresh();
  return { ok: true, data: undefined };
}

const metaSchema = z.object({ itemId: idSchema, steamLogin: z.string().max(64).optional(), buyerInput: z.string().max(200).optional() });

/** Save the delivery input (Steam login / account note) for a cart line. */
export async function updateCartItemMeta(input: z.input<typeof metaSchema>): Promise<ActionResult> {
  const parsed = metaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Некорректные данные" };
  const { owner } = await resolveCartOwner();
  if (!owner) return { ok: false, error: "Корзина пуста" };
  const { itemId, ...meta } = parsed.data;
  const res = await setItemMeta(owner, itemId, meta);
  if (!res.ok) return res;
  refresh();
  return { ok: true, data: undefined };
}

/** Current cart as plain serialisable data. */
export async function getCart(): Promise<CartView> {
  const { owner } = await resolveCartOwner();
  return getCartView(owner);
}
