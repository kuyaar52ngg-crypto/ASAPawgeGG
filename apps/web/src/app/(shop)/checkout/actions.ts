"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@asap/db";
import { emailSchema, idSchema } from "@asap/shared";
import { rateLimit } from "@/lib/rate-limit";
import { acquireLock } from "@/lib/redis";
import { getClientIp } from "@/lib/request";
import { headers } from "next/headers";
import { AuthError, assertRole } from "@/server/auth/session";
import { CheckoutError, cancelOrder, createOrderFromCart, validatePromo } from "@/server/orders";
import { startOrderPayment } from "@/server/payments/initiate";
import { PAYMENT_CHOICES } from "@/server/payments/types";

export interface CheckoutState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

const placeOrderSchema = z.object({
  email: emailSchema,
  paymentMethod: z.enum(PAYMENT_CHOICES, { message: "Выберите способ оплаты" }),
  promoCode: z
    .string()
    .trim()
    .toUpperCase()
    .max(40)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

/**
 * Checkout submit: validate → create the PENDING order (reserves stock) → start the payment → redirect to the gateway / success page.
 * On any payment-start failure the order is cancelled again so reserved keys are released and the cart stays intact.
 */
export async function placeOrder(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  let user;
  try {
    user = await assertRole("USER", "SELLER", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) redirect("/sign-in?callbackUrl=%2Fcheckout");
    throw e;
  }
  const parsed = placeOrderSchema.safeParse({
    email: formData.get("email"),
    paymentMethod: formData.get("paymentMethod"),
    promoCode: formData.get("promoCode") ?? undefined,
  });
  if (!parsed.success) return { error: "Проверьте введённые данные", fieldErrors: parsed.error.flatten().fieldErrors };

  const ip = await getClientIp();
  const rl = await rateLimit({ key: `checkout:${user.id}`, limit: 15, windowSec: 600 });
  if (!rl.ok) return { error: "Слишком много попыток оформления. Подождите несколько минут." };

  // one checkout at a time per user (double click / two tabs must not create two orders from one cart)
  const release = await acquireLock(`checkout:${user.id}`, 30_000);
  if (!release) return { error: "Заказ уже оформляется. Подождите несколько секунд." };

  let redirectUrl: string;
  try {
    const order = await createOrderFromCart({
      userId: user.id,
      email: parsed.data.email,
      promoCode: parsed.data.promoCode,
      paymentMethod: parsed.data.paymentMethod,
      ip,
      userAgent: (await headers()).get("user-agent"),
    });
    const sessionId = (await cookies()).get("asap_sid")?.value;
    const pay = await startOrderPayment({ orderId: order.id, userId: user.id, choice: parsed.data.paymentMethod, sessionId });
    if (!pay.ok) {
      await cancelOrder(order.id, { buyerId: user.id }).catch(() => {});
      return { error: pay.error };
    }
    redirectUrl = pay.redirectUrl;
  } catch (e) {
    if (e instanceof CheckoutError) return { error: e.message };
    console.error("[checkout] placeOrder failed:", e);
    return { error: "Не удалось оформить заказ. Попробуйте ещё раз." };
  } finally {
    await release();
  }
  revalidatePath("/", "layout"); // header: cart badge + balance
  redirect(redirectUrl);
}

const payExistingSchema = z.object({ orderId: idSchema, paymentMethod: z.enum(PAYMENT_CHOICES, { message: "Выберите способ оплаты" }) });

/** Pay (again) an already created PENDING order, e.g. after a declined payment. */
export async function payExistingOrder(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  let user;
  try {
    user = await assertRole("USER", "SELLER", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) redirect("/sign-in");
    throw e;
  }
  const parsed = payExistingSchema.safeParse({ orderId: formData.get("orderId"), paymentMethod: formData.get("paymentMethod") });
  if (!parsed.success) return { error: "Выберите способ оплаты" };
  const rl = await rateLimit({ key: `checkout:${user.id}`, limit: 15, windowSec: 600 });
  if (!rl.ok) return { error: "Слишком много попыток. Подождите несколько минут." };
  const sessionId = (await cookies()).get("asap_sid")?.value;
  const pay = await startOrderPayment({ orderId: parsed.data.orderId, userId: user.id, choice: parsed.data.paymentMethod, sessionId });
  if (!pay.ok) return { error: pay.error };
  revalidatePath("/", "layout");
  redirect(pay.redirectUrl);
}

/** Cancel the buyer's own unpaid order (releases reserved stock). */
export async function cancelPendingOrder(formData: FormData): Promise<void> {
  const user = await assertRole("USER", "SELLER", "ADMIN");
  const orderId = idSchema.safeParse(formData.get("orderId"));
  if (!orderId.success) redirect("/cart");
  await cancelOrder(orderId.data, { buyerId: user.id });
  redirect("/cart");
}

export interface PromoPreview {
  ok: boolean;
  error?: string;
  code?: string;
  discount?: number;
  total?: number;
  description?: string;
}

/** Live promo preview for the checkout form (the order re-validates on submit). */
export async function previewPromo(code: string): Promise<PromoPreview> {
  let user;
  try {
    user = await assertRole("USER", "SELLER", "ADMIN");
  } catch {
    return { ok: false, error: "Войдите, чтобы применить промокод" };
  }
  const rl = await rateLimit({ key: `promo:${user.id}`, limit: 20, windowSec: 600 });
  if (!rl.ok) return { ok: false, error: "Слишком много попыток. Подождите немного." };
  const parsed = z.string().trim().min(1).max(40).safeParse(code);
  if (!parsed.success) return { ok: false, error: "Введите промокод" };
  const cart = await prisma.cart.findUnique({
    where: { userId: user.id },
    select: { items: { select: { quantity: true, product: { select: { price: true } }, variant: { select: { price: true } } } } },
  });
  if (!cart || cart.items.length === 0) return { ok: false, error: "Корзина пуста" };
  const subtotal = cart.items.reduce((s, i) => s + (i.variant?.price ?? i.product.price) * i.quantity, 0);
  const res = await validatePromo(parsed.data, user.id, subtotal, cart.items.length);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, code: res.code, discount: res.discount, total: subtotal - (res.discount ?? 0), description: res.description };
}
