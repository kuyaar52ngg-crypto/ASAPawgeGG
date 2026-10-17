import "server-only";
import { prisma } from "@asap/db";
import { redis, withLock } from "@/lib/redis";
import { fulfillOrderInline } from "@/server/orders/fulfill";
import { AmountMismatchError, markPaid } from "@/server/orders/mark-paid";
import { getProvider } from "./config";

/**
 * Pull-based safety net for late/missing webhooks (typical on localhost where gateways cannot call back):
 * asks the provider for the status of a pending payment and settles it through the SAME `markPaid` path.
 * Throttled to once per 5 s per payment. Sandbox payments have no remote state and are skipped.
 */
export async function reconcilePayment(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true, provider: true, externalId: true, status: true, amount: true } });
  if (!payment || !payment.externalId || !["CREATED", "PENDING"].includes(payment.status)) return;
  if (payment.provider === "BALANCE" || payment.provider === "SANDBOX") return;
  try {
    const ok = await redis.set(`throttle:reconcile:${payment.id}`, "1", "EX", 5, "NX");
    if (ok !== "OK") return;
  } catch {
    /* proceed */
  }
  const provider = getProvider(payment.provider);
  if (!provider.isConfigured()) return;
  try {
    const st = await provider.getStatus(payment.externalId);
    if (st.status === "PAID") {
      await withLock(`payment:${payment.provider}:${payment.externalId}`, 60_000, () => markPaid(payment.id, { reportedAmount: st.amount, raw: { via: "getStatus", ...(typeof st.raw === "object" && st.raw ? (st.raw as object) : {}) } as never }));
    } else if (st.status === "FAILED" || st.status === "CANCELLED") {
      await prisma.payment.updateMany({ where: { id: payment.id, status: { in: ["CREATED", "PENDING"] } }, data: { status: st.status } });
    }
  } catch (e) {
    if (e instanceof AmountMismatchError) console.error(`[payments] reconcile amount mismatch payment=${payment.id}`);
    else console.warn(`[payments] reconcile ${payment.id} failed:`, (e as Error).message);
  }
}

export interface OrderPollState {
  /** "paid" = money received (order PAID/PROCESSING/DELIVERED...), "pending" = waiting, "failed" = payment failed/cancelled */
  stage: "pending" | "paid" | "failed";
  orderStatus: string;
  done: boolean;
}

/** Status for the success-page poller. Also nudges stuck PAID orders to inline fulfilment after a grace period. */
export async function pollOrder(orderId: string, buyerId: string): Promise<OrderPollState | null> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, buyerId },
    select: { id: true, status: true, paidAt: true, payments: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true } } },
  });
  if (!order) return null;
  let status = order.status;
  if (status === "PENDING" && order.payments[0]) {
    await reconcilePayment(order.payments[0].id);
    status = (await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } }))?.status ?? status;
  }
  if (status === "PAID" && order.paidAt && Date.now() - order.paidAt.getTime() > 20_000) {
    await fulfillOrderInline(orderId).catch(() => null);
    status = (await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } }))?.status ?? status;
  }
  const paid = !["PENDING", "CANCELLED", "FAILED"].includes(status);
  const failed = status === "CANCELLED" || status === "FAILED";
  return { stage: paid ? "paid" : failed ? "failed" : "pending", orderStatus: status, done: status === "DELIVERED" || failed || status === "REFUNDED" };
}

/** Status of a balance top-up payment for the poller. */
export async function pollTopup(paymentId: string, userId: string): Promise<{ stage: "pending" | "paid" | "failed"; amount: number } | null> {
  let payment = await prisma.payment.findFirst({ where: { id: paymentId, userId, purpose: "BALANCE_TOPUP" }, select: { id: true, status: true, amount: true } });
  if (!payment) return null;
  if (payment.status === "CREATED" || payment.status === "PENDING") {
    await reconcilePayment(payment.id);
    payment = (await prisma.payment.findUnique({ where: { id: payment.id }, select: { id: true, status: true, amount: true } })) ?? payment;
  }
  const stage = payment.status === "PAID" ? "paid" : ["FAILED", "CANCELLED", "EXPIRED"].includes(payment.status) ? "failed" : "pending";
  return { stage, amount: payment.amount };
}
