"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@asap/db";
import { idSchema } from "@asap/shared";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { AuthError, assertRole } from "@/server/auth/session";
import { isSandboxAllowed } from "./config";
import { TOPUP_MAX_KOPECKS, TOPUP_MIN_KOPECKS } from "./constants";
import { startBalanceTopup } from "./initiate";
import { buildSandboxWebhook } from "./sandbox";
import { pollOrder, pollTopup } from "./reconcile";
import { handleWebhook } from "./webhook";
import { PAYMENT_CHOICES } from "./types";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

const topupSchema = z.object({
  amount: z.number().int("Сумма должна быть целым числом копеек").min(TOPUP_MIN_KOPECKS, "Минимальная сумма пополнения — 100 ₽").max(TOPUP_MAX_KOPECKS, "Максимальная сумма пополнения — 100 000 ₽"),
  method: z.enum(PAYMENT_CHOICES).refine((m) => m !== "BALANCE", "Выберите внешний способ оплаты"),
});

/**
 * Balance top-up (пополнение баланса) via a payment gateway — consumed by the /account/balance UI (zone C).
 * `amount` is in KOPECKS. Returns the URL to send the buyer to; the balance is credited by the webhook
 * (same path as order payments) and the page `/checkout/success?payment=<paymentId>` confirms it.
 *
 * @example const r = await createBalanceTopup({ amount: 50_000, method: "SANDBOX" }); if (r.ok) window.location.href = r.data.redirectUrl;
 */
export async function createBalanceTopup(input: z.input<typeof topupSchema>): Promise<ActionResult<{ redirectUrl: string; paymentId: string }>> {
  let user;
  try {
    user = await assertRole("USER", "SELLER", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
  const parsed = topupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте сумму", fieldErrors: parsed.error.flatten().fieldErrors };
  const rl = await rateLimit({ key: `topup:${user.id}`, limit: 10, windowSec: 600 });
  if (!rl.ok) return { ok: false, error: "Слишком много попыток. Подождите несколько минут." };
  const sessionId = (await cookies()).get("asap_sid")?.value;
  const res = await startBalanceTopup({ userId: user.id, amount: parsed.data.amount, choice: parsed.data.method, sessionId });
  if (!res.ok) return res;
  return { ok: true, data: { redirectUrl: res.redirectUrl, paymentId: res.paymentId } };
}

const sandboxSchema = z.object({ paymentId: idSchema, outcome: z.enum(["PAID", "FAILED"]) });

/**
 * Sandbox checkout buttons ("Оплатить" / "Отклонить"). Builds a webhook signed with SANDBOX_WEBHOOK_SECRET and feeds it
 * through the SAME handler real gateways use (signature check -> dedupe -> lock -> amount check -> markPaid).
 * Only the owner of the payment can resolve it, and only while the sandbox is enabled.
 */
export async function resolveSandboxPayment(input: z.input<typeof sandboxSchema>): Promise<ActionResult<{ redirectUrl: string }>> {
  let user;
  try {
    user = await assertRole("USER", "SELLER", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
  const parsed = sandboxSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Некорректный запрос" };
  if (!isSandboxAllowed()) return { ok: false, error: "Тестовая оплата отключена" };

  const payment = await prisma.payment.findFirst({
    where: { id: parsed.data.paymentId, userId: user.id, provider: "SANDBOX" },
    select: { id: true, orderId: true, externalId: true, amount: true, status: true },
  });
  if (!payment || !payment.externalId) return { ok: false, error: "Платёж не найден" };
  const q = payment.orderId ? `order=${encodeURIComponent(payment.orderId)}` : `payment=${encodeURIComponent(payment.id)}`;
  if (payment.status === "PAID") return { ok: true, data: { redirectUrl: `/checkout/success?${q}` } };
  if (!["CREATED", "PENDING"].includes(payment.status)) return { ok: false, error: "Платёж уже закрыт" };

  const wh = buildSandboxWebhook(env.sandboxWebhookSecret, {
    eventId: `sbx-evt-${randomUUID()}`,
    externalId: payment.externalId,
    status: parsed.data.outcome,
    amount: payment.amount,
  });
  const res = await handleWebhook("SANDBOX", wh.body, new Headers(wh.headers));
  if (res.status >= 400) return { ok: false, error: "Не удалось обработать платёж. Попробуйте ещё раз." };
  revalidatePath("/", "layout"); // header balance
  return { ok: true, data: { redirectUrl: parsed.data.outcome === "PAID" ? `/checkout/success?${q}` : `/checkout/fail?${q}` } };
}

/** Poll an order's payment/delivery state (success page). Owner only. */
export async function pollOrderStatus(orderId: string): Promise<ActionResult<Awaited<ReturnType<typeof pollOrder>> & object>> {
  try {
    const user = await assertRole("USER", "SELLER", "ADMIN");
    const r = await pollOrder(idSchema.parse(orderId), user.id);
    return r ? { ok: true, data: r } : { ok: false, error: "Заказ не найден" };
  } catch (e) {
    return { ok: false, error: e instanceof AuthError ? e.message : "Ошибка" };
  }
}

/** Poll a balance top-up payment. Owner only. */
export async function pollTopupStatus(paymentId: string): Promise<ActionResult<{ stage: "pending" | "paid" | "failed"; amount: number }>> {
  try {
    const user = await assertRole("USER", "SELLER", "ADMIN");
    const r = await pollTopup(idSchema.parse(paymentId), user.id);
    return r ? { ok: true, data: r } : { ok: false, error: "Платёж не найден" };
  } catch (e) {
    return { ok: false, error: e instanceof AuthError ? e.message : "Ошибка" };
  }
}
