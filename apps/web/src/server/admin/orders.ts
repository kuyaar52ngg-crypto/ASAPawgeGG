import "server-only";
import { z } from "zod";
import { getSetting, prisma } from "@asap/db";
import { SETTING_KEYS, idSchema, type OrderStatusName } from "@asap/shared";
import { env } from "@/lib/env";
import { notify } from "@/server/notifications";
import { cancelOrder, dispatchFulfillment, refundOrder } from "@/server/orders";
import { lockRow, transitionOrder } from "@/server/orders/lifecycle";
import { deriveOrderStatus } from "@/server/orders/state-machine";
import { AdminError, audit, fail, ok, parseInput, type AdminCtx } from "./action";

const deliverSchema = z.object({
  orderItemId: idSchema,
  message: z.string().trim().min(1, "Введите данные для покупателя").max(4000),
});

/**
 * Manual delivery of one order item by an admin (stuck MANUAL order, failed supplier, support case).
 * Stores the text in `OrderItem.deliveryData` (shown to the buyer on the order page), marks the item DELIVERED,
 * starts the seller-hold timer (`holdReleaseAt`) and moves the order to DELIVERED once every live item is delivered.
 * A FAILED order is first reopened (FAILED → PROCESSING, the only allowed way out per the state machine).
 */
export async function manualDeliver(ctx: AdminCtx, input: unknown) {
  const p = parseInput(deliverSchema, input);
  if (p.error) return p.error;
  const { orderItemId, message } = p.data;
  const holdDays = Number(await getSetting<number>(SETTING_KEYS.holdDays, env.holdDays)) || env.holdDays;

  const res = await prisma.$transaction(
    async (tx) => {
      const found = await tx.orderItem.findUnique({ where: { id: orderItemId }, select: { orderId: true } });
      if (!found) throw new AdminError("Позиция заказа не найдена");
      await lockRow(tx, "Order", found.orderId);
      const order = await tx.order.findUnique({ where: { id: found.orderId }, include: { items: { select: { id: true, status: true } } } });
      if (!order) throw new AdminError("Заказ не найден");
      if (!["PAID", "PROCESSING", "FAILED"].includes(order.status)) throw new AdminError("Выдать вручную можно только оплаченный заказ, который ещё не выдан");
      const item = order.items.find((i) => i.id === orderItemId);
      if (!item || !["PENDING", "PROCESSING", "FAILED"].includes(item.status)) throw new AdminError("Позиция уже выдана или возвращена");

      const now = new Date();
      await tx.orderItem.update({
        where: { id: orderItemId },
        data: {
          status: "DELIVERED",
          deliveredAt: now,
          holdReleaseAt: new Date(now.getTime() + holdDays * 86_400_000),
          deliveryData: { manual: true, message, deliveredBy: ctx.admin.id, deliveredAt: now.toISOString() },
        },
      });

      let current = order.status as OrderStatusName;
      if (current === "FAILED") {
        await transitionOrder(tx, { id: order.id, status: current }, "PROCESSING");
        current = "PROCESSING";
      }
      const statuses = order.items.map((i) => (i.id === orderItemId ? "DELIVERED" : i.status));
      const next = deriveOrderStatus(current, statuses);
      if (next) await transitionOrder(tx, { id: order.id, status: current }, next, next === "DELIVERED" ? { deliveredAt: now } : {});
      await audit(tx, ctx, { action: "order.manual_deliver", entityType: "OrderItem", entityId: orderItemId, before: { status: item.status, orderStatus: order.status }, after: { status: "DELIVERED", orderStatus: next ?? current, length: message.length } });
      return { orderId: order.id, number: order.number, buyerId: order.buyerId, orderStatus: next ?? current };
    },
    { timeout: 20_000 },
  );
  if (res.orderStatus === "DELIVERED") {
    await notify(res.buyerId, { type: "ORDER_DELIVERED", title: `Заказ ${res.number} выдан`, body: "Данные доступны в личном кабинете.", link: `/account/orders/${res.orderId}` }).catch(() => {});
  }
  return ok({ orderStatus: res.orderStatus });
}

/** Re-run automatic fulfilment (worker job, inline fallback). A FAILED order is reopened and its failed items go back to PENDING. */
export async function retryFulfillment(ctx: AdminCtx, input: unknown) {
  const p = parseInput(z.object({ orderId: idSchema }), input);
  if (p.error) return p.error;
  const { orderId } = p.data;
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Order", orderId);
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
    if (!order) throw new AdminError("Заказ не найден");
    if (!["PAID", "PROCESSING", "FAILED"].includes(order.status)) throw new AdminError("Повторить выдачу можно только для оплаченного, ещё не выданного заказа");
    if (order.status === "FAILED") {
      await transitionOrder(tx, { id: order.id, status: "FAILED" }, "PROCESSING");
      await tx.orderItem.updateMany({ where: { orderId, status: "FAILED" }, data: { status: "PENDING" } });
    }
    await audit(tx, ctx, { action: "order.retry_fulfillment", entityType: "Order", entityId: orderId, before: { status: order.status } });
  });
  const via = await dispatchFulfillment(orderId);
  return ok({ via: via.via });
}

const refundSchema = z.object({
  orderId: idSchema,
  orderItemIds: z.array(idSchema).max(100).optional(),
  reason: z.string().trim().min(3, "Укажите причину возврата").max(300),
});

/** Refund (all or selected items) to the buyer's site balance through the ledger — delegates to zone B's `refundOrder`. */
export async function refundOrderAdmin(ctx: AdminCtx, input: unknown) {
  const p = parseInput(refundSchema, input);
  if (p.error) return p.error;
  const r = await refundOrder(p.data.orderId, { actor: { id: ctx.admin.id }, orderItemIds: p.data.orderItemIds, reason: p.data.reason, ip: ctx.ip });
  if (!r.ok) return fail(r.error);
  return ok({ amount: r.amount, items: r.refundedItems, orderStatus: r.orderStatus });
}

/** Cancel an unpaid (PENDING) order and release its reserved stock. */
export async function cancelPendingOrder(ctx: AdminCtx, input: unknown) {
  const p = parseInput(z.object({ orderId: idSchema }), input);
  if (p.error) return p.error;
  const r = await cancelOrder(p.data.orderId);
  if (!r.ok) return fail(r.error);
  await prisma.auditLog.create({ data: { actorId: ctx.admin.id, action: "order.cancel", entityType: "Order", entityId: p.data.orderId, ip: ctx.ip } });
  return ok();
}
