import "server-only";
import { prisma } from "@asap/db";
import { formatRub } from "@asap/shared";
import { postLedger } from "@/server/ledger/ledger";
import { refundLines } from "@/server/ledger/accounts";
import { writeAudit } from "@/server/audit";
import { notify } from "@/server/notifications";
import { lockRow, transitionOrder } from "./lifecycle";
import { canTransition } from "./state-machine";

export type RefundResult = { ok: true; refundedItems: number; amount: number; orderStatus: string } | { ok: false; error: string };

export interface RefundOptions {
  /** ADMIN user performing the refund (re-verified against the DB), or "system" for automatic resolutions */
  actor: { id: string } | "system";
  /** only these order items (default: every item not yet refunded) */
  orderItemIds?: string[];
  reason?: string;
  ip?: string;
}

/**
 * Refund paid order items to the BUYER'S SITE BALANCE (CONTRACTS §8 `REFUND`):
 *   DEBIT SELLER_HOLD|SELLER_AVAILABLE earning · DEBIT PLATFORM_FEE commission · CREDIT USER_BALANCE total.
 * Atomic and idempotent per item (a REFUNDED item is skipped). Order -> REFUNDED when no live item remains.
 * Reserved-but-undelivered stock returns to the pool; already delivered (SOLD) keys stay sold.
 * Open disputes on the refunded items are resolved as RESOLVED_REFUND. Audited as `order.refund`.
 * The CALLER must have verified role ADMIN (assertRole) — this function re-checks the actor in the DB as defence in depth.
 */
export async function refundOrder(orderId: string, opts: RefundOptions): Promise<RefundResult> {
  if (opts.actor !== "system") {
    const actor = await prisma.user.findUnique({ where: { id: opts.actor.id }, select: { role: true, banned: true } });
    if (!actor || actor.banned || actor.role !== "ADMIN") return { ok: false, error: "Недостаточно прав для возврата" };
  }
  const actorId = opts.actor === "system" ? null : opts.actor.id;

  const result = await prisma.$transaction(
    async (tx) => {
      await lockRow(tx, "Order", orderId);
      // the worker's release_holds locks single OrderItems (not the Order): lock them too so `holdReleased` is read consistently
      await tx.$queryRaw`SELECT id FROM "OrderItem" WHERE "orderId" = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: { include: { stockItems: { select: { id: true, status: true } } } } } });
      if (!order) return { ok: false, error: "Заказ не найден" } as const;
      if (!order.paidAt) return { ok: false, error: "Заказ не был оплачен" } as const;
      if (!canTransition(order.status, "REFUNDED")) return { ok: false, error: `Возврат невозможен для заказа в статусе ${order.status}` } as const;

      const wanted = opts.orderItemIds ? new Set(opts.orderItemIds) : null;
      if (wanted) for (const id of wanted) if (!order.items.some((i) => i.id === id)) return { ok: false, error: "Позиция не относится к заказу" } as const;
      const targets = order.items.filter((i) => i.status !== "REFUNDED" && (!wanted || wanted.has(i.id)));
      if (targets.length === 0) return { ok: false, error: "Нечего возвращать: позиции уже возвращены" } as const;

      let amount = 0;
      for (const item of targets) {
        await postLedger(tx, {
          kind: "REFUND",
          lines: refundLines({
            buyerId: order.buyerId,
            sellerId: item.sellerId,
            total: item.total,
            sellerEarning: item.sellerEarning,
            commissionAmount: item.commissionAmount,
            holdReleased: item.holdReleased,
          }),
          orderId: order.id,
          orderItemId: item.id,
          memo: `Возврат: ${item.title}${opts.reason ? ` (${opts.reason.slice(0, 120)})` : ""}`,
        });
        await tx.orderItem.update({ where: { id: item.id }, data: { status: "REFUNDED" } });
        await tx.stockItem.updateMany({ where: { orderItemId: item.id, status: "RESERVED" }, data: { status: "AVAILABLE", reservedUntil: null, orderItemId: null } });
        amount += item.total;
      }

      await tx.dispute.updateMany({
        where: { orderId: order.id, status: { in: ["OPEN", "SELLER_REPLIED", "ESCALATED"] }, OR: [{ orderItemId: null }, { orderItemId: { in: targets.map((t) => t.id) } }] },
        data: { status: "RESOLVED_REFUND", resolution: opts.reason ?? "Возврат средств", resolvedById: actorId, resolvedAt: new Date() },
      });

      const remaining = order.items.filter((i) => i.status !== "REFUNDED" && !targets.some((t) => t.id === i.id));
      let status: string = order.status;
      if (remaining.length === 0) {
        await transitionOrder(tx, order, "REFUNDED");
        status = "REFUNDED";
      }
      return { ok: true, refundedItems: targets.length, amount, orderStatus: status, buyerId: order.buyerId, number: order.number } as const;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  if (!result.ok) return result;
  await writeAudit({
    actorId,
    action: "order.refund",
    entityType: "Order",
    entityId: orderId,
    after: { items: result.refundedItems, amount: result.amount, status: result.orderStatus, reason: opts.reason ?? null },
    ip: opts.ip,
  }).catch((e) => console.warn("[orders] refund audit failed:", (e as Error).message));
  await notify(result.buyerId, {
    type: "SYSTEM",
    title: `Возврат по заказу ${result.number}`,
    body: `${formatRub(result.amount)} возвращено на ваш баланс.`,
    link: `/account/orders/${orderId}`,
  }).catch(() => {});
  return { ok: true, refundedItems: result.refundedItems, amount: result.amount, orderStatus: result.orderStatus };
}

/** Refund one order item (admin dispute resolution etc.). */
export async function refundOrderItem(orderItemId: string, opts: Omit<RefundOptions, "orderItemIds">): Promise<RefundResult> {
  const item = await prisma.orderItem.findUnique({ where: { id: orderItemId }, select: { orderId: true } });
  if (!item) return { ok: false, error: "Позиция не найдена" };
  return refundOrder(item.orderId, { ...opts, orderItemIds: [orderItemId] });
}
