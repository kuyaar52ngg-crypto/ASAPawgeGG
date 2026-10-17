import "server-only";
import { z } from "zod";
import { getSetting, prisma } from "@asap/db";
import { SETTING_KEYS, idSchema } from "@asap/shared";
import { env } from "@/lib/env";
import { notify } from "@/server/notifications";
import { lockRow, transitionOrder } from "@/server/orders/lifecycle";
import { deriveOrderStatus } from "@/server/orders/state-machine";
import type { OrderStatusName } from "@asap/shared";
import type { SellerCtx } from "./seller-context";
import { fail, ok, zodFail, type ActionResult } from "./result";

const deliverSchema = z.object({
  orderItemId: idSchema,
  message: z.string().trim().min(2, "Введите данные для покупателя").max(4000, "Максимум 4000 символов"),
});

/**
 * MANUAL delivery: the seller types the content (code / credentials / instructions) and marks the item DELIVERED
 * (CONTRACTS §7: `deliveryData.message`). Starts the hold timer (holdReleaseAt = now + holdDays) and moves the order forward
 * through the state machine. Only the item's own seller, only for MANUAL products and only for paid orders.
 */
export async function deliverManualItem(ctx: SellerCtx, raw: unknown): Promise<ActionResult<{ orderStatus: string }>> {
  const parsed = deliverSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const holdDays = await getSetting<number>(SETTING_KEYS.holdDays, env.holdDays);

  const result = await prisma.$transaction(
    async (tx) => {
      const pre = await tx.orderItem.findUnique({ where: { id: parsed.data.orderItemId }, select: { orderId: true, sellerId: true } });
      if (!pre || pre.sellerId !== ctx.user.id) return fail("Позиция заказа не найдена");
      await lockRow(tx, "Order", pre.orderId);
      const order = await tx.order.findUnique({ where: { id: pre.orderId }, select: { id: true, number: true, status: true, buyerId: true, items: { select: { id: true, status: true } } } });
      const item = await tx.orderItem.findUnique({ where: { id: parsed.data.orderItemId }, select: { id: true, title: true, status: true, product: { select: { deliveryMode: true } } } });
      if (!order || !item) return fail("Позиция заказа не найдена");
      if (item.product.deliveryMode !== "MANUAL") return fail("Этот товар выдаётся автоматически");
      if (!["PAID", "PROCESSING"].includes(order.status)) return fail("Заказ не оплачен или уже закрыт — выдача невозможна");
      if (!["PENDING", "PROCESSING"].includes(item.status)) return fail("Позиция уже выдана или закрыта");

      const now = new Date();
      await tx.orderItem.update({
        where: { id: item.id },
        data: { status: "DELIVERED", deliveredAt: now, holdReleaseAt: new Date(now.getTime() + holdDays * 86_400_000), deliveryData: { mode: "MANUAL", message: parsed.data.message, deliveredBy: ctx.user.id } },
      });
      const statuses = order.items.map((i) => (i.id === item.id ? "DELIVERED" : i.status));
      const next = deriveOrderStatus(order.status as OrderStatusName, statuses);
      if (next) await transitionOrder(tx, order as { id: string; status: OrderStatusName }, next, next === "DELIVERED" ? { deliveredAt: now } : {});
      return ok({ orderStatus: next ?? order.status, number: order.number, buyerId: order.buyerId, orderId: order.id, title: item.title });
    },
    { timeout: 20_000 },
  );
  if (!result.ok) return result;
  const d = result.data;
  await notify(d.buyerId, {
    type: "ORDER_DELIVERED",
    title: `Заказ ${d.number}: «${d.title}» выдан`,
    body: "Продавец отправил данные — они доступны в личном кабинете.",
    link: `/account/orders/${d.orderId}`,
  }).catch(() => {});
  return ok({ orderStatus: d.orderStatus });
}
