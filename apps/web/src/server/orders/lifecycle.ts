import "server-only";
import { prisma, type Prisma } from "@asap/db";
import type { OrderStatusName } from "@asap/shared";
import type { Tx } from "@/server/ledger/ledger";
import { assertTransition } from "./state-machine";
import { releaseOrderStock } from "./stock";

/** `SELECT … FOR UPDATE` on one row (serialises concurrent webhook / poll / worker handlers). */
export async function lockRow(tx: Tx, table: "Order" | "Payment" | "OrderItem", id: string): Promise<void> {
  await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, id);
}

/**
 * The ONLY place that changes Order.status (CONTRACTS §7): validates the transition against ORDER_TRANSITIONS
 * and uses a compare-and-set on the previous status so racing writers cannot both win.
 */
export async function transitionOrder(
  tx: Tx,
  order: { id: string; status: OrderStatusName },
  to: OrderStatusName,
  data: Omit<Prisma.OrderUpdateManyMutationInput, "status"> = {},
): Promise<void> {
  assertTransition(order.status, to);
  const res = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { ...data, status: to } });
  if (res.count !== 1) throw new Error(`Order ${order.id} changed concurrently (expected ${order.status})`);
}

export type CancelResult = { ok: true } | { ok: false; error: string };

/**
 * Cancel an unpaid order: PENDING -> CANCELLED, frees the reserved stock, cancels open payments.
 * `buyerId` (when given) enforces ownership for user-initiated cancellations.
 */
export async function cancelOrder(orderId: string, opts: { buyerId?: string } = {}): Promise<CancelResult> {
  return prisma.$transaction(async (tx) => {
    await lockRow(tx, "Order", orderId);
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, buyerId: true } });
    if (!order || (opts.buyerId && order.buyerId !== opts.buyerId)) return { ok: false, error: "Заказ не найден" } as const;
    if (order.status !== "PENDING") return { ok: false, error: "Оплаченный или закрытый заказ нельзя отменить" } as const;
    await transitionOrder(tx, order, "CANCELLED", { cancelledAt: new Date() });
    await releaseOrderStock(tx, order.id);
    await tx.payment.updateMany({ where: { orderId: order.id, status: { in: ["CREATED", "PENDING"] } }, data: { status: "CANCELLED" } });
    return { ok: true } as const;
  });
}

/** Used when a paid order's reservation was lost: cancel it and free whatever stock it still holds (inside the caller's tx). */
export async function releaseAndCancelForLostStock(tx: Tx, order: { id: string; status: OrderStatusName }): Promise<void> {
  await transitionOrder(tx, order, "CANCELLED", { cancelledAt: new Date() });
  await releaseOrderStock(tx, order.id);
}
