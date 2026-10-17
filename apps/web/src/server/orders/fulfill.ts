import "server-only";
import { prisma, getSetting, type OrderItemStatus } from "@asap/db";
import { SETTING_KEYS } from "@asap/shared";
import { env } from "@/lib/env";
import { acquireLock } from "@/lib/redis";
import { notify } from "@/server/notifications";
import { getTopupProvider } from "@/server/topup/provider";
import { enqueueJob } from "@/server/worker";
import { lockRow, transitionOrder } from "./lifecycle";
import { deriveOrderStatus } from "./state-machine";

/**
 * Kick off delivery for a PAID order: POST worker `fulfill_order` (CONTRACTS §10). If the worker is unreachable
 * the order is fulfilled in-process so the purchase flow always completes.
 * (If the worker accepted the job but never processes it, `sweepStuckPaidOrders` picks the order up later.)
 */
export async function dispatchFulfillment(orderId: string): Promise<{ via: "worker" | "inline" }> {
  const res = await enqueueJob("fulfill_order", { orderId });
  if (res.ok) return { via: "worker" };
  console.warn(`[orders] worker unavailable (${res.error}) — fulfilling ${orderId} inline`);
  await fulfillOrderInline(orderId);
  return { via: "inline" };
}

export interface FulfillSummary {
  orderStatus: string;
  delivered: number;
  processing: number;
  failed: number;
}

/**
 * In-process fulfilment (fallback for the worker's `fulfill_order`). Idempotent, safe to run concurrently with the worker:
 * serialises on the Order row (`FOR UPDATE`) and only touches items that are still PENDING/PROCESSING.
 *  - AUTO_STOCK:    reserved StockItems -> SOLD, item DELIVERED (+ holdReleaseAt)
 *  - AUTO_PROVIDER: only with STEAM_TOPUP_PROVIDER=mock (clearly labelled mock result); a real supplier stays PROCESSING for the worker
 *  - MANUAL:        item PROCESSING, the seller delivers from /seller/orders
 */
export async function fulfillOrderInline(orderId: string): Promise<FulfillSummary | null> {
  const release = await acquireLock(`fulfill:${orderId}`, 60_000);
  if (!release) return null;
  try {
    const holdDays = await getSetting<number>(SETTING_KEYS.holdDays, env.holdDays);
    const result = await prisma.$transaction(
      async (tx) => {
        await lockRow(tx, "Order", orderId);
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: { items: { include: { product: { select: { deliveryMode: true } }, variant: { select: { attributes: true } }, stockItems: { select: { id: true, status: true } } } } },
        });
        if (!order || !["PAID", "PROCESSING"].includes(order.status)) {
          return { summary: order ? summarize(order.status, order.items.map((i) => i.status)) : null, notify: [] as { userId: string; kind: "delivered" | "manual" | "failed" }[], number: order?.number ?? "" };
        }
        const now = new Date();
        const holdReleaseAt = new Date(now.getTime() + holdDays * 86_400_000);
        const statuses: OrderItemStatus[] = [];
        const toNotify: { userId: string; kind: "delivered" | "manual" | "failed" }[] = [];

        for (const item of order.items) {
          if (item.status === "DELIVERED" || item.status === "REFUNDED" || item.status === "FAILED") {
            statuses.push(item.status);
            continue;
          }
          const mode = item.product.deliveryMode;
          if (mode === "AUTO_STOCK") {
            const reserved = item.stockItems.filter((s) => s.status === "RESERVED");
            if (reserved.length < item.quantity) {
              await tx.orderItem.update({ where: { id: item.id }, data: { status: "FAILED", deliveryData: { mode, error: "stock_missing" } } });
              statuses.push("FAILED");
              continue;
            }
            await tx.stockItem.updateMany({ where: { id: { in: reserved.map((s) => s.id) } }, data: { status: "SOLD", soldAt: now, reservedUntil: null } });
            await tx.orderItem.update({ where: { id: item.id }, data: { status: "DELIVERED", deliveredAt: now, holdReleaseAt, deliveryData: { mode, count: reserved.length } } });
            statuses.push("DELIVERED");
          } else if (mode === "AUTO_PROVIDER" && getTopupProvider().name === "mock") {
            // sandbox supplier only: a real supplier (STEAM_TOPUP_PROVIDER=http) is driven by the worker, never faked here
            const meta = (item.meta ?? {}) as { steamLogin?: string; amountKopecks?: number };
            const attrs = (item.variant?.attributes ?? {}) as { amountRub?: number };
            const amountRub = meta.amountKopecks ? meta.amountKopecks / 100 : (attrs.amountRub ?? 0);
            const topup = await getTopupProvider().topup({ login: meta.steamLogin ?? "", amountRub, ref: item.id });
            if (topup.status === "completed") {
              await tx.orderItem.update({
                where: { id: item.id },
                data: { status: "DELIVERED", deliveredAt: now, holdReleaseAt, deliveryData: { provider: "mock", sandbox: true, status: "completed", steamLogin: meta.steamLogin ?? null, amountRub, txId: topup.txId } },
              });
              statuses.push("DELIVERED");
            } else {
              if (item.status !== "PROCESSING") await tx.orderItem.update({ where: { id: item.id }, data: { status: "PROCESSING" } });
              statuses.push("PROCESSING");
            }
          } else {
            if (item.status !== "PROCESSING") await tx.orderItem.update({ where: { id: item.id }, data: { status: "PROCESSING" } });
            statuses.push("PROCESSING");
            if (mode === "MANUAL") toNotify.push({ userId: item.sellerId, kind: "manual" });
          }
        }

        const next = deriveOrderStatus(order.status, statuses);
        if (next) await transitionOrder(tx, order, next, next === "DELIVERED" ? { deliveredAt: now } : {});
        if (next === "DELIVERED") toNotify.push({ userId: order.buyerId, kind: "delivered" });
        if (next === "FAILED") toNotify.push({ userId: order.buyerId, kind: "failed" });
        return { summary: summarize(next ?? order.status, statuses), notify: toNotify, number: order.number };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    for (const n of result.notify) {
      const number = result.number;
      if (n.kind === "delivered") await notify(n.userId, { type: "ORDER_DELIVERED", title: `Заказ ${number} выдан`, body: "Ключи и данные доступны в личном кабинете.", link: `/account/orders/${orderId}` }).catch(() => {});
      else if (n.kind === "failed") await notify(n.userId, { type: "ORDER_FAILED", title: `Не удалось выдать заказ ${number}`, body: "Мы уже разбираемся — поддержка свяжется с вами или вернёт деньги.", link: `/account/orders/${orderId}` }).catch(() => {});
      else await notify(n.userId, { type: "ORDER_PAID", title: `Заказ ${number} ждёт выдачи`, body: "Покупатель оплатил заказ — выдайте товар.", link: "/seller/orders" }).catch(() => {});
    }
    return result.summary;
  } finally {
    await release();
  }
}

function summarize(orderStatus: string, itemStatuses: readonly string[]): FulfillSummary {
  return {
    orderStatus,
    delivered: itemStatuses.filter((s) => s === "DELIVERED").length,
    processing: itemStatuses.filter((s) => s === "PROCESSING" || s === "PENDING").length,
    failed: itemStatuses.filter((s) => s === "FAILED").length,
  };
}

/**
 * Safety net for PAID orders nobody picked up (worker down / job lost): fulfil inline.
 * Used by the success-page poller, `POST /api/payments/maintenance` and the worker's own stuck-order sweep.
 */
export async function sweepStuckPaidOrders(olderThanSeconds = 45): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanSeconds * 1000);
  const stuck = await prisma.order.findMany({ where: { status: "PAID", paidAt: { lt: cutoff } }, select: { id: true }, take: 100 });
  let n = 0;
  for (const o of stuck) {
    const r = await fulfillOrderInline(o.id).catch((e) => {
      console.warn(`[orders] sweep ${o.id} failed:`, (e as Error).message);
      return null;
    });
    if (r) n++;
  }
  return n;
}
