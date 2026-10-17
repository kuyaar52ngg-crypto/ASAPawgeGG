import "server-only";
import { prisma, type Prisma } from "@asap/db";
import { formatRub } from "@asap/shared";
import { trackEvent } from "@/server/analytics/track";
import { postLedger, type Tx } from "@/server/ledger/ledger";
import { purchaseLines, topupLines } from "@/server/ledger/accounts";
import { notify } from "@/server/notifications";
import { lockRow, releaseAndCancelForLostStock, transitionOrder } from "./lifecycle";
import { OutOfStockError, confirmOrderStock, reserveStock } from "./stock";
import { dispatchFulfillment } from "./fulfill";

export class AmountMismatchError extends Error {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(`Payment amount mismatch: expected ${expected}, got ${actual}`);
    this.name = "AmountMismatchError";
  }
}

export class PaymentNotFoundError extends Error {
  constructor(id: string) {
    super(`Payment ${id} not found`);
    this.name = "PaymentNotFoundError";
  }
}

export type MarkPaidOutcome =
  /** order moved PENDING -> PAID and purchase postings were made */
  | { kind: "order_paid"; paymentId: string; orderId: string }
  /** BALANCE_TOPUP payment credited the user's balance */
  | { kind: "topup"; paymentId: string; userId: string; amount: number }
  /** money arrived for an order that can no longer be fulfilled -> credited to the buyer's balance instead */
  | { kind: "credited"; paymentId: string; userId: string; orderId: string; amount: number; reason: "order_not_pending" | "stock_lost" }
  /** idempotent no-op: payment was already settled */
  | { kind: "already"; paymentId: string };

export interface MarkPaidOptions {
  /** amount reported by the provider (kopecks); must equal Payment.amount */
  reportedAmount?: number;
  /** provider payload merged into Payment.raw */
  raw?: Prisma.InputJsonValue;
}

/**
 * Settle a payment INSIDE the caller's transaction (CONTRACTS §8/§9). Idempotent: a PAID payment returns `already`.
 *  - BALANCE_TOPUP: EXTERNAL -> USER_BALANCE
 *  - ORDER via gateway: EXTERNAL -> USER_BALANCE (gross), then PURCHASE posting per item; via BALANCE: PURCHASE only
 *    (fails with InsufficientFundsError when the balance is too low -> whole tx rolls back)
 * Run `afterMarkPaid(outcome)` after the transaction commits.
 */
export async function markPaidTx(tx: Tx, paymentId: string, opts: MarkPaidOptions = {}): Promise<MarkPaidOutcome> {
  await lockRow(tx, "Payment", paymentId);
  const payment = await tx.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new PaymentNotFoundError(paymentId);
  if (payment.status === "PAID" || payment.status === "REFUNDED") return { kind: "already", paymentId };
  if (opts.reportedAmount != null && opts.reportedAmount !== payment.amount) throw new AmountMismatchError(payment.amount, opts.reportedAmount);

  const now = new Date();
  const raw = opts.raw !== undefined ? { ...(typeof payment.raw === "object" && payment.raw ? (payment.raw as object) : {}), confirmation: opts.raw } : undefined;
  const markPaymentPaid = () =>
    tx.payment.update({ where: { id: payment.id }, data: { status: "PAID", paidAt: now, ...(raw ? { raw: raw as Prisma.InputJsonValue } : {}) } });

  // ── balance top-up ──
  if (payment.purpose === "BALANCE_TOPUP" || !payment.orderId) {
    await postLedger(tx, { kind: "TOPUP", lines: topupLines(payment.userId, payment.amount), paymentId: payment.id, memo: "Пополнение баланса" });
    await markPaymentPaid();
    return { kind: "topup", paymentId: payment.id, userId: payment.userId, amount: payment.amount };
  }

  // ── order payment ──
  await lockRow(tx, "Order", payment.orderId);
  const order = await tx.order.findUnique({ where: { id: payment.orderId }, include: { items: { include: { product: { select: { deliveryMode: true } } } } } });
  if (!order) throw new PaymentNotFoundError(`order of ${paymentId}`);

  const creditToBalance = async (reason: "order_not_pending" | "stock_lost"): Promise<MarkPaidOutcome> => {
    if (payment.provider !== "BALANCE") {
      await postLedger(tx, {
        kind: "TOPUP",
        lines: topupLines(payment.userId, payment.amount),
        paymentId: payment.id,
        orderId: order.id,
        memo: `Платёж по недоступному заказу ${order.number} зачислен на баланс`,
      });
    }
    await markPaymentPaid();
    return { kind: "credited", paymentId: payment.id, userId: payment.userId, orderId: order.id, amount: payment.amount, reason };
  };

  if (order.status !== "PENDING") return creditToBalance("order_not_pending");
  if (payment.amount !== order.total) throw new AmountMismatchError(order.total, payment.amount);

  // reservation integrity: re-reserve what expired in the meantime, otherwise give the money back as balance
  for (const item of order.items) {
    if (item.product.deliveryMode !== "AUTO_STOCK") continue;
    const reserved = await tx.stockItem.count({ where: { orderItemId: item.id, status: "RESERVED" } });
    if (reserved >= item.quantity) continue;
    try {
      await reserveStock(tx, { productId: item.productId, variantId: item.variantId, quantity: item.quantity - reserved, orderItemId: item.id, productTitle: item.title });
    } catch (e) {
      if (!(e instanceof OutOfStockError)) throw e;
      await releaseAndCancelForLostStock(tx, order);
      return creditToBalance("stock_lost");
    }
  }

  if (payment.provider !== "BALANCE") {
    await postLedger(tx, { kind: "TOPUP", lines: topupLines(payment.userId, payment.amount), paymentId: payment.id, orderId: order.id, memo: `Оплата заказа ${order.number}` });
  }
  for (const item of order.items) {
    await postLedger(tx, {
      kind: "PURCHASE",
      lines: purchaseLines({ buyerId: order.buyerId, sellerId: item.sellerId, total: item.total, sellerEarning: item.sellerEarning, commissionAmount: item.commissionAmount }),
      orderId: order.id,
      orderItemId: item.id,
      paymentId: payment.id,
      memo: `Покупка: ${item.title}`,
    });
  }

  await transitionOrder(tx, order, "PAID", { paidAt: now });
  await markPaymentPaid();
  await confirmOrderStock(tx, order.id);
  if (order.promoCodeId) await tx.promoCode.update({ where: { id: order.promoCodeId }, data: { usedCount: { increment: 1 } } });
  for (const item of order.items) {
    await tx.product.update({ where: { id: item.productId }, data: { salesCount: { increment: item.quantity } } });
    await tx.sellerProfile.updateMany({ where: { userId: item.sellerId }, data: { salesCount: { increment: item.quantity } } });
  }
  return { kind: "order_paid", paymentId: payment.id, orderId: order.id };
}

/** Standalone: settle a payment in its own transaction, then run side effects. Safe to call repeatedly. */
export async function markPaid(paymentId: string, opts: MarkPaidOptions = {}): Promise<MarkPaidOutcome> {
  const outcome = await prisma.$transaction((tx) => markPaidTx(tx, paymentId, opts), { timeout: 30_000, maxWait: 10_000 });
  await afterMarkPaid(outcome);
  return outcome;
}

/** Post-commit side effects (analytics, notifications, fulfilment kick-off). Never throws. */
export async function afterMarkPaid(outcome: MarkPaidOutcome): Promise<void> {
  try {
    if (outcome.kind === "already") return;
    if (outcome.kind === "topup") {
      void trackEvent({ name: "topup_balance", userId: outcome.userId, properties: { value: outcome.amount / 100, paymentId: outcome.paymentId } });
      await notify(outcome.userId, { type: "SYSTEM", title: "Баланс пополнен", body: `Зачислено ${formatRub(outcome.amount)}`, link: "/account/balance" });
      return;
    }
    if (outcome.kind === "credited") {
      await notify(outcome.userId, {
        type: "SYSTEM",
        title: "Платёж зачислен на баланс",
        body: `Заказ уже недоступен (истёк или нет в наличии). ${formatRub(outcome.amount)} зачислено на ваш баланс.`,
        link: "/account/balance",
      });
      return;
    }
    const order = await prisma.order.findUnique({
      where: { id: outcome.orderId },
      select: { id: true, number: true, buyerId: true, total: true, items: { select: { sellerId: true, title: true } }, payments: { where: { id: outcome.paymentId }, select: { provider: true, method: true } } },
    });
    if (!order) return;
    const pay = order.payments[0];
    void trackEvent({
      name: "purchase",
      userId: order.buyerId,
      properties: { orderId: order.id, value: order.total / 100, currency: "RUB", method: pay ? (pay.method ?? pay.provider).toLowerCase() : "unknown" },
    });
    await notify(order.buyerId, { type: "ORDER_PAID", title: `Заказ ${order.number} оплачен`, body: "Выдача началась — ключи появятся в личном кабинете.", link: `/account/orders/${order.id}` });
    const sellers = [...new Set(order.items.map((i) => i.sellerId))];
    await Promise.all(
      sellers.map((sid) =>
        notify(sid, { type: "ORDER_PAID", title: "Новый оплаченный заказ", body: order.items.filter((i) => i.sellerId === sid).map((i) => i.title).join(", ").slice(0, 200), link: "/seller/orders" }),
      ),
    );
    await dispatchFulfillment(order.id);
  } catch (e) {
    console.error("[orders] afterMarkPaid failed:", (e as Error).message);
  }
}
