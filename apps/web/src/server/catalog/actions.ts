"use server";
import { z } from "zod";
import { prisma } from "@asap/db";
import { cartAddSchema, idSchema, quoteSteamTopup } from "@asap/shared";
import { getSessionUser } from "@/server/auth/session";
import { getClientIp } from "@/lib/request";
import { rateLimit } from "@/lib/rate-limit";
import { trackEvent } from "@/server/analytics/track";
import { addItemToCart, type ActionResult, type CartAddData } from "./cart-bridge";
import { getSteamConfig } from "./steam";

/** Add a product (variant / quantity / buyer meta) to the cart. Used by product page + quick-add buttons. */
export async function addToCartAction(input: z.input<typeof cartAddSchema>): Promise<ActionResult<CartAddData>> {
  const [user, ip] = await Promise.all([getSessionUser(), getClientIp()]);
  const rl = await rateLimit({ key: `cart-add:${user?.id ?? ip}`, limit: 60, windowSec: 60 });
  if (!rl.ok) return { ok: false, error: "Слишком много действий. Попробуйте через минуту." };
  return addItemToCart(input);
}

/** Toggle a favourite. Returns UNAUTHENTICATED error code text for guests so the UI can redirect to sign-in. */
export async function toggleFavoriteAction(productId: string): Promise<ActionResult<{ favorite: boolean }>> {
  const parsed = idSchema.safeParse(productId);
  if (!parsed.success) return { ok: false, error: "Некорректный товар" };
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "UNAUTHENTICATED" };
  const rl = await rateLimit({ key: `fav:${user.id}`, limit: 60, windowSec: 60 });
  if (!rl.ok) return { ok: false, error: "Слишком много действий. Попробуйте позже." };

  const product = await prisma.product.findFirst({ where: { id: parsed.data, status: "ACTIVE" }, select: { id: true } });
  if (!product) return { ok: false, error: "Товар недоступен" };

  const key = { userId_productId: { userId: user.id, productId: product.id } };
  const existing = await prisma.favorite.findUnique({ where: key });
  if (existing) {
    await prisma.favorite.delete({ where: key });
    return { ok: true, data: { favorite: false } };
  }
  await prisma.favorite.create({ data: { userId: user.id, productId: product.id } });
  void trackEvent({ name: "favorite_add", userId: user.id, properties: { productId: product.id } });
  return { ok: true, data: { favorite: true } };
}

const steamInput = z.object({
  currency: z.enum(["RUB", "KZT"]),
  login: z
    .string()
    .trim()
    .min(3, "Минимум 3 символа")
    .max(64)
    .regex(/^[A-Za-z0-9_.-]+$/, "Логин Steam: латиница, цифры, _ . -"),
  /** RUB: whole rubles (custom or preset); KZT: must match a preset */
  amount: z.number().int().positive().max(1_000_000),
});

/**
 * Steam calculator -> cart line (TOPUP). Re-validates the login through the TopupProvider on the server, resolves a
 * matching preset variant (price from DB) or a custom RUB amount (`meta.amountKopecks`, priced by zone B with quoteSteamTopup).
 * On success the client navigates to /checkout.
 */
export async function startSteamTopupAction(raw: z.input<typeof steamInput>): Promise<ActionResult<CartAddData & { total: number }>> {
  const parsed = steamInput.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] = i.message;
    return { ok: false, error: Object.values(fieldErrors)[0] ?? "Проверьте данные", fieldErrors };
  }
  const { currency, login, amount } = parsed.data;
  const [user, ip] = await Promise.all([getSessionUser(), getClientIp()]);
  const rl = await rateLimit({ key: `steam-start:${user?.id ?? ip}`, limit: 20, windowSec: 60 });
  if (!rl.ok) return { ok: false, error: "Слишком много попыток. Попробуйте через минуту." };

  const cfg = await getSteamConfig();
  const target = currency === "RUB" ? cfg.rub : cfg.kzt;
  if (!target) return { ok: false, error: "Пополнение для выбранной валюты временно недоступно" };

  const preset = target.presets.find((p) => p.amount === amount);
  let total: number;
  let meta: { steamLogin: string; amountKopecks?: number };
  let variantId: string | null = null;
  if (preset) {
    variantId = preset.variantId;
    total = preset.price;
    meta = { steamLogin: login };
  } else if (target.customAllowed) {
    try {
      const q = quoteSteamTopup(amount * 100, cfg.feePercent);
      total = q.total;
    } catch {
      return { ok: false, error: "Сумма пополнения: от 100 до 15 000 ₽", fieldErrors: { amount: "Сумма пополнения: от 100 до 15 000 ₽" } };
    }
    meta = { steamLogin: login, amountKopecks: amount * 100 };
  } else {
    return { ok: false, error: "Выберите одну из доступных сумм", fieldErrors: { amount: "Выберите одну из доступных сумм" } };
  }

  const res = await addItemToCart({ productId: target.productId, variantId, quantity: 1, meta });
  if (!res.ok) return res;
  void trackEvent({ name: "steam_topup_start", userId: user?.id ?? null, path: "/steam", properties: { value: total / 100 } });
  return { ok: true, data: { ...res.data, total } };
}
