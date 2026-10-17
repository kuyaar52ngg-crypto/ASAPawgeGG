import "server-only";
import { z } from "zod";
import { prisma } from "@asap/db";
import { idSchema } from "@asap/shared";
import { notify } from "@/server/notifications";
import { refundOrder } from "@/server/orders";
import { lockRow, transitionOrder } from "@/server/orders/lifecycle";
import { aiComplete } from "./ai";
import { AdminError, audit, fail, ok, parseInput, type ActionResult, type AdminCtx } from "./action";

export const ACTIVE_DISPUTE = ["OPEN", "SELLER_REPLIED", "ESCALATED"] as const;

export interface DisputeAdvice {
  summary: string;
  recommendation: "refund" | "reject" | "ask_more_info";
  confidence: number;
  provider?: string;
  model?: string;
  mock?: boolean;
  generatedAt?: string;
}

/** Defensive reader for Dispute.aiSuggestion (seed/worker/this panel all write { summary, recommendation, confidence }). */
export function readAdvice(raw: unknown): DisputeAdvice | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rec = r.recommendation;
  if (typeof r.summary !== "string") return null;
  return {
    summary: r.summary,
    recommendation: rec === "refund" || rec === "reject" ? rec : "ask_more_info",
    confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
    provider: typeof r.provider === "string" ? r.provider : undefined,
    model: typeof r.model === "string" ? r.model : undefined,
    mock: r.mock === true,
    generatedAt: typeof r.generatedAt === "string" ? r.generatedAt : undefined,
  };
}

// ───────────────────────── chat ─────────────────────────

export async function postDisputeMessage(ctx: AdminCtx, input: unknown) {
  const p = parseInput(z.object({ disputeId: idSchema, body: z.string().trim().min(1, "Введите сообщение").max(4000) }), input);
  if (p.error) return p.error;
  const dispute = await prisma.dispute.findUnique({ where: { id: p.data.disputeId }, select: { id: true, status: true, buyerId: true, sellerId: true, order: { select: { number: true } } } });
  if (!dispute) return fail("Спор не найден");
  if (!(ACTIVE_DISPUTE as readonly string[]).includes(dispute.status)) return fail("Спор уже закрыт");

  await prisma.$transaction(async (tx) => {
    await tx.disputeMessage.create({ data: { disputeId: dispute.id, authorId: ctx.admin.id, authorRole: "ADMIN", body: p.data.body } });
    if (dispute.status !== "ESCALATED") await tx.dispute.update({ where: { id: dispute.id }, data: { status: "ESCALATED" } });
    await audit(tx, ctx, { action: "dispute.message", entityType: "Dispute", entityId: dispute.id, after: { length: p.data.body.length } });
  });
  for (const uid of [dispute.buyerId, dispute.sellerId]) {
    await notify(uid, { type: "DISPUTE_UPDATE", title: `Администратор ответил по спору (заказ ${dispute.order.number})`, body: p.data.body.slice(0, 140), link: uid === dispute.buyerId ? `/account/disputes/${dispute.id}` : `/seller/orders` }).catch(() => {});
  }
  return ok();
}

// ───────────────────────── resolution ─────────────────────────

const resolveSchema = z.object({
  disputeId: idSchema,
  decision: z.enum(["refund", "reject"]),
  resolution: z.string().trim().min(5, "Опишите решение (минимум 5 символов)").max(1000),
});

/**
 * Resolve a dispute.
 *  refund: money goes back to the buyer's site balance through the ledger (zone B `refundOrder`, which also closes the dispute as RESOLVED_REFUND);
 *  reject: dispute → RESOLVED_REJECTED and the order returns DISPUTED → DELIVERED (unless another dispute is still open).
 */
export async function resolveDispute(ctx: AdminCtx, input: unknown): Promise<ActionResult<{ status: string }>> {
  const p = parseInput(resolveSchema, input);
  if (p.error) return p.error;
  const { disputeId, decision, resolution } = p.data;
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId }, include: { order: { select: { id: true, number: true } } } });
  if (!dispute) return fail("Спор не найден");
  if (!(ACTIVE_DISPUTE as readonly string[]).includes(dispute.status)) return fail("Спор уже решён");

  let status: string;
  if (decision === "refund") {
    const r = await refundOrder(dispute.orderId, { actor: { id: ctx.admin.id }, orderItemIds: dispute.orderItemId ? [dispute.orderItemId] : undefined, reason: resolution, ip: ctx.ip });
    if (!r.ok) return fail(r.error);
    status = "RESOLVED_REFUND";
    // refundOrder already closed the dispute; make sure the audit trail carries this decision explicitly
    await prisma.$transaction(async (tx) => {
      await lockRow(tx, "Order", dispute.orderId);
      await tx.dispute.update({ where: { id: disputeId }, data: { status: "RESOLVED_REFUND", resolution, resolvedById: ctx.admin.id, resolvedAt: new Date() } });
      // a partial refund leaves the order DISPUTED although nothing is disputed any more
      const order = await tx.order.findUnique({ where: { id: dispute.orderId }, select: { id: true, status: true } });
      const stillActive = await tx.dispute.count({ where: { orderId: dispute.orderId, id: { not: disputeId }, status: { in: [...ACTIVE_DISPUTE] } } });
      if (order && order.status === "DISPUTED" && stillActive === 0) await transitionOrder(tx, order, "DELIVERED");
      await tx.disputeMessage.create({ data: { disputeId, authorId: ctx.admin.id, authorRole: "ADMIN", body: `Решение: возврат средств покупателю. ${resolution}` } });
      await audit(tx, ctx, { action: "dispute.resolve_refund", entityType: "Dispute", entityId: disputeId, after: { status, resolution, amount: r.amount } });
    });
  } else {
    status = "RESOLVED_REJECTED";
    await prisma.$transaction(async (tx) => {
      await lockRow(tx, "Order", dispute.orderId);
      const fresh = await tx.dispute.findUnique({ where: { id: disputeId }, select: { status: true } });
      if (!fresh || !(ACTIVE_DISPUTE as readonly string[]).includes(fresh.status)) throw new AdminError("Спор уже решён");
      await tx.dispute.update({ where: { id: disputeId }, data: { status: "RESOLVED_REJECTED", resolution, resolvedById: ctx.admin.id, resolvedAt: new Date() } });
      await tx.disputeMessage.create({ data: { disputeId, authorId: ctx.admin.id, authorRole: "ADMIN", body: `Решение: спор отклонён. ${resolution}` } });
      const order = await tx.order.findUnique({ where: { id: dispute.orderId }, select: { id: true, status: true } });
      const stillActive = await tx.dispute.count({ where: { orderId: dispute.orderId, id: { not: disputeId }, status: { in: [...ACTIVE_DISPUTE] } } });
      if (order && order.status === "DISPUTED" && stillActive === 0) await transitionOrder(tx, order, "DELIVERED");
      await audit(tx, ctx, { action: "dispute.resolve_reject", entityType: "Dispute", entityId: disputeId, before: { status: dispute.status }, after: { status, resolution } });
    });
  }

  const title = decision === "refund" ? `Спор по заказу ${dispute.order.number}: возврат средств` : `Спор по заказу ${dispute.order.number} отклонён`;
  await notify(dispute.buyerId, { type: "DISPUTE_UPDATE", title, body: resolution.slice(0, 200), link: `/account/disputes/${disputeId}` }).catch(() => {});
  await notify(dispute.sellerId, { type: "DISPUTE_UPDATE", title, body: resolution.slice(0, 200), link: "/seller/orders" }).catch(() => {});
  return ok({ status });
}

// ───────────────────────── AI advice ─────────────────────────

export function ruleBasedAdvice(d: { itemStatus: string | null; sellerReplied: boolean; messages: number; ageDays: number }): DisputeAdvice {
  const notDelivered = d.itemStatus !== null && d.itemStatus !== "DELIVERED" && d.itemStatus !== "REFUNDED";
  if (notDelivered) return { summary: "Товар не был выдан покупателю — по правилам площадки это основание для возврата.", recommendation: "refund", confidence: 0.85 };
  if (!d.sellerReplied) return { summary: "Продавец ещё не ответил на претензию. Запросите у него подтверждение выдачи и скриншоты.", recommendation: "ask_more_info", confidence: 0.6 };
  if (d.messages >= 4 && d.ageDays > 7) return { summary: "Спор затянулся без новых доказательств от покупателя. Выдача подтверждена — можно отклонить.", recommendation: "reject", confidence: 0.55 };
  return { summary: "Данных недостаточно: запросите у покупателя скриншот ошибки активации, у продавца — подтверждение выдачи.", recommendation: "ask_more_info", confidence: 0.64 };
}

const adviceJson = z.object({ summary: z.string().min(3).max(1200), recommendation: z.enum(["refund", "reject", "ask_more_info"]), confidence: z.coerce.number().min(0).max(1) });

/** «Совет AI»: LLM (or rule-based fallback) analyses the dispute and stores `Dispute.aiSuggestion`. Advisory only. */
export async function generateDisputeAdvice(ctx: AdminCtx, input: unknown): Promise<ActionResult<DisputeAdvice>> {
  const p = parseInput(z.object({ disputeId: idSchema }), input);
  if (p.error) return p.error;
  const d = await prisma.dispute.findUnique({
    where: { id: p.data.disputeId },
    include: {
      order: { select: { number: true, status: true, total: true, deliveredAt: true } },
      orderItem: { select: { title: true, status: true, quantity: true, total: true, deliveryData: true } },
      messages: { orderBy: { createdAt: "asc" }, take: 30, select: { authorRole: true, body: true } },
    },
  });
  if (!d) return fail("Спор не найден");

  const fallback = ruleBasedAdvice({
    itemStatus: d.orderItem?.status ?? null,
    sellerReplied: d.messages.some((m) => m.authorRole === "SELLER"),
    messages: d.messages.length,
    ageDays: Math.floor((Date.now() - d.createdAt.getTime()) / 86_400_000),
  });
  const r = await aiComplete({
    task: "dispute",
    userId: ctx.admin.id,
    logInput: { disputeId: d.id, orderNumber: d.order.number },
    system:
      "Ты помощник арбитра маркетплейса цифровых товаров. По описанию спора предложи решение. Правила: если товар не выдан или выдан неработающим по вине продавца — возврат; " +
      "если выдача подтверждена и претензия необоснованна — отказ; если доказательств мало — запросить дополнительные данные. " +
      'Ответь ТОЛЬКО JSON: {"summary": "2-3 предложения по-русски", "recommendation": "refund"|"reject"|"ask_more_info", "confidence": 0..1}.',
    prompt: [
      `Товар: ${d.orderItem?.title ?? "—"} (статус позиции: ${d.orderItem?.status ?? "—"}), сумма заказа ${d.order.total / 100} RUB, статус заказа ${d.order.status}`,
      `Претензия покупателя: ${d.reason}`,
      "Переписка:",
      ...d.messages.map((m) => `[${m.authorRole}] ${m.body.slice(0, 500)}`),
    ].join("\n"),
    fallback: () => JSON.stringify(fallback),
  });
  let advice: DisputeAdvice = fallback;
  try {
    const m = r.text.match(/\{[\s\S]*\}/);
    advice = adviceJson.parse(JSON.parse(m ? m[0] : r.text));
  } catch {
    advice = fallback;
  }
  const stored: DisputeAdvice = { ...advice, provider: r.provider, model: r.model, mock: r.mock, generatedAt: new Date().toISOString() };
  await prisma.$transaction(async (tx) => {
    await tx.dispute.update({ where: { id: d.id }, data: { aiSuggestion: stored as never } });
    await audit(tx, ctx, { action: "dispute.ai_advice", entityType: "Dispute", entityId: d.id, after: { recommendation: stored.recommendation, provider: r.provider } });
  });
  return ok(stored);
}
