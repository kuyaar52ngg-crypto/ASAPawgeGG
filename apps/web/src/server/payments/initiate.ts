import "server-only";
import { Prisma, prisma } from "@asap/db";
import { env } from "@/lib/env";
import { trackEvent } from "@/server/analytics/track";
import { InsufficientFundsError } from "@/server/ledger/ledger";
import { lockRow } from "@/server/orders/lifecycle";
import { afterMarkPaid, markPaidTx } from "@/server/orders/mark-paid";
import { getProvider, resolveMethod } from "./config";
import { ProviderError, type PaymentChoice } from "./types";

export type StartPaymentResult =
  | { ok: true; redirectUrl: string; paymentId: string; paid: boolean }
  | { ok: false; error: string };

const base = () => env.appUrl.replace(/\/$/, "");

/** Return/fail URLs shown to the buyer after the gateway (the pages re-check the real state — redirects are never trusted). */
function returnUrls(ref: { orderId?: string; paymentId: string }) {
  const q = ref.orderId ? `order=${encodeURIComponent(ref.orderId)}` : `payment=${encodeURIComponent(ref.paymentId)}`;
  return { returnUrl: `${base()}/checkout/success?${q}`, failUrl: `${base()}/checkout/fail?${q}` };
}

/**
 * Pay a PENDING order. BALANCE settles immediately (atomic debit); gateways create a Payment, call the provider
 * and return its redirect URL. The caller is responsible for `sessionUserId` having been authenticated.
 */
export async function startOrderPayment(p: { orderId: string; userId: string; choice: PaymentChoice; sessionId?: string }): Promise<StartPaymentResult> {
  const order = await prisma.order.findFirst({ where: { id: p.orderId, buyerId: p.userId }, select: { id: true, number: true, email: true, total: true, status: true, createdAt: true } });
  if (!order) return { ok: false, error: "Заказ не найден" };
  if (order.status !== "PENDING") return { ok: false, error: "Заказ уже оплачен или закрыт" };

  const method = await resolveMethod(p.choice);
  if ("error" in method) return { ok: false, error: method.error };
  void trackEvent({ name: "add_payment_info", userId: p.userId, sessionId: p.sessionId, properties: { method: p.choice.toLowerCase() } });

  if (method.provider === "BALANCE") {
    const res = await payOrderWithBalance(order.id, p.userId);
    if (res.ok) await clearCartAfterOrder(p.userId, order.createdAt);
    return res;
  }

  // any earlier unfinished attempt of this order is superseded (late money from it is still credited safely, see markPaidTx)
  await prisma.payment.updateMany({ where: { orderId: order.id, status: { in: ["CREATED", "PENDING"] } }, data: { status: "CANCELLED" } });

  const provider = getProvider(method.provider);
  const payment = await prisma.payment.create({
    data: { orderId: order.id, userId: p.userId, provider: method.provider, purpose: "ORDER", status: "CREATED", amount: order.total, method: method.submethod ?? method.provider.toLowerCase() },
    select: { id: true },
  });
  try {
    const created = await provider.createPayment({
      payment: { id: payment.id, amount: order.total, currency: "RUB", purpose: "ORDER", userId: p.userId, method: method.submethod },
      order: { id: order.id, number: order.number, email: order.email },
      description: `Заказ ${order.number} — ASAPawge GG`,
      ...returnUrls({ orderId: order.id, paymentId: payment.id }),
    });
    await prisma.payment.update({
      where: { id: payment.id },
      data: { externalId: created.externalId, paymentUrl: created.paymentUrl, status: "PENDING", raw: (created.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue },
    });
    await clearCartAfterOrder(p.userId, order.createdAt);
    return { ok: true, redirectUrl: created.paymentUrl, paymentId: payment.id, paid: false };
  } catch (e) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", raw: { error: (e as Error).message } } }).catch(() => {});
    console.error(`[payments] ${method.provider} createPayment failed:`, (e as Error).message);
    return { ok: false, error: e instanceof ProviderError ? "Платёжная система временно недоступна. Попробуйте другой способ оплаты." : "Не удалось создать платёж. Попробуйте ещё раз." };
  }
}

/**
 * Atomic payment from the site balance: Payment(BALANCE) + purchase postings + order PAID in ONE transaction.
 * `User.balance >= total` is enforced by a guarded UPDATE (and a DB CHECK) — two parallel tabs can never overspend.
 */
export async function payOrderWithBalance(orderId: string, userId: string): Promise<StartPaymentResult> {
  try {
    const { outcome, paymentId } = await prisma.$transaction(
      async (tx) => {
        await lockRow(tx, "Order", orderId);
        const order = await tx.order.findFirst({ where: { id: orderId, buyerId: userId }, select: { id: true, total: true, status: true } });
        if (!order) throw new PayError("Заказ не найден");
        if (order.status !== "PENDING") throw new PayError("Заказ уже оплачен или закрыт");
        const payment = await tx.payment.upsert({
          where: { provider_externalId: { provider: "BALANCE", externalId: `bal_${order.id}` } },
          create: { orderId: order.id, userId, provider: "BALANCE", purpose: "ORDER", externalId: `bal_${order.id}`, status: "CREATED", amount: order.total, method: "balance" },
          update: { status: "CREATED", amount: order.total },
          select: { id: true },
        });
        await tx.payment.updateMany({ where: { orderId: order.id, id: { not: payment.id }, status: { in: ["CREATED", "PENDING"] } }, data: { status: "CANCELLED" } });
        const outcome = await markPaidTx(tx, payment.id, { reportedAmount: order.total });
        return { outcome, paymentId: payment.id };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    await afterMarkPaid(outcome);
    return { ok: true, redirectUrl: `/checkout/success?order=${encodeURIComponent(orderId)}`, paymentId, paid: true };
  } catch (e) {
    if (e instanceof InsufficientFundsError) return { ok: false, error: "Недостаточно средств на балансе. Пополните баланс или выберите другой способ оплаты." };
    if (e instanceof PayError) return { ok: false, error: e.message };
    console.error("[payments] payOrderWithBalance failed:", e);
    return { ok: false, error: "Не удалось выполнить оплату. Попробуйте ещё раз." };
  }
}

class PayError extends Error {}

/** Create a gateway payment that credits the user's balance (BALANCE_TOPUP). `choice` must not be BALANCE. */
export async function startBalanceTopup(p: { userId: string; amount: number; choice: PaymentChoice; sessionId?: string }): Promise<StartPaymentResult> {
  const method = await resolveMethod(p.choice, { forTopup: true });
  if ("error" in method) return { ok: false, error: method.error };
  if (method.provider === "BALANCE") return { ok: false, error: "Нельзя пополнить баланс балансом" };
  const provider = getProvider(method.provider);
  const payment = await prisma.payment.create({
    data: { userId: p.userId, provider: method.provider, purpose: "BALANCE_TOPUP", status: "CREATED", amount: p.amount, method: method.submethod ?? method.provider.toLowerCase() },
    select: { id: true },
  });
  try {
    const created = await provider.createPayment({
      payment: { id: payment.id, amount: p.amount, currency: "RUB", purpose: "BALANCE_TOPUP", userId: p.userId, method: method.submethod },
      order: null,
      description: "Пополнение баланса — ASAPawge GG",
      ...returnUrls({ paymentId: payment.id }),
    });
    await prisma.payment.update({
      where: { id: payment.id },
      data: { externalId: created.externalId, paymentUrl: created.paymentUrl, status: "PENDING", raw: (created.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue },
    });
    return { ok: true, redirectUrl: created.paymentUrl, paymentId: payment.id, paid: false };
  } catch (e) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", raw: { error: (e as Error).message } } }).catch(() => {});
    console.error(`[payments] ${method.provider} topup createPayment failed:`, (e as Error).message);
    return { ok: false, error: "Платёжная система временно недоступна. Попробуйте другой способ." };
  }
}

/** Remove cart lines that were added before the order was created (later additions stay). */
async function clearCartAfterOrder(userId: string, orderCreatedAt: Date): Promise<void> {
  try {
    await prisma.cartItem.deleteMany({ where: { cart: { userId }, createdAt: { lte: orderCreatedAt } } });
  } catch (e) {
    console.warn("[payments] cart cleanup failed:", (e as Error).message);
  }
}
