import "server-only";
import { z } from "zod";
import { prisma } from "@asap/db";
import { formatRub, idSchema } from "@asap/shared";
import { payoutReversalLines } from "@/server/ledger/accounts";
import { postLedger, type Tx } from "@/server/ledger/ledger";
import { notify } from "@/server/notifications";
import { AdminError, audit, ok, parseInput, type AdminCtx } from "./action";

const actionSchema = z.object({ payoutId: idSchema, note: z.string().trim().max(500).optional() });

async function lockPayout(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "Payout" WHERE id = ${id} FOR UPDATE`;
  const payout = await tx.payout.findUnique({ where: { id } });
  if (!payout) throw new AdminError("Выплата не найдена");
  return payout;
}

/** REQUESTED → APPROVED: the request is checked and queued for the manual transfer. No ledger entries (funds left SELLER_AVAILABLE at request time). */
export async function approvePayout(ctx: AdminCtx, input: unknown) {
  const p = parseInput(actionSchema, input);
  if (p.error) return p.error;
  const payout = await prisma.$transaction(async (tx) => {
    const cur = await lockPayout(tx, p.data.payoutId);
    if (cur.status !== "REQUESTED") throw new AdminError("Одобрить можно только новую заявку");
    await tx.payout.update({ where: { id: cur.id }, data: { status: "APPROVED", note: p.data.note ?? cur.note, processedById: ctx.admin.id } });
    await audit(tx, ctx, { action: "payout.approve", entityType: "Payout", entityId: cur.id, before: { status: cur.status }, after: { status: "APPROVED", amount: cur.amount } });
    return cur;
  });
  await notify(payout.sellerId, { type: "PAYOUT_UPDATE", title: "Выплата одобрена", body: `Заявка на ${formatRub(payout.amount)} одобрена и скоро будет отправлена.`, link: "/seller/payouts" }).catch(() => {});
  return ok();
}

/** (REQUESTED|APPROVED) → PAID: the money was transferred outside the platform. No ledger entries (posted at request time). */
export async function markPayoutPaid(ctx: AdminCtx, input: unknown) {
  const p = parseInput(actionSchema, input);
  if (p.error) return p.error;
  const payout = await prisma.$transaction(async (tx) => {
    const cur = await lockPayout(tx, p.data.payoutId);
    if (cur.status !== "APPROVED" && cur.status !== "REQUESTED") throw new AdminError("Выплата уже обработана");
    await tx.payout.update({ where: { id: cur.id }, data: { status: "PAID", processedAt: new Date(), processedById: ctx.admin.id, note: p.data.note ?? cur.note } });
    await audit(tx, ctx, { action: "payout.paid", entityType: "Payout", entityId: cur.id, before: { status: cur.status }, after: { status: "PAID", amount: cur.amount, note: p.data.note ?? null } });
    return cur;
  });
  await notify(payout.sellerId, { type: "PAYOUT_UPDATE", title: "Выплата отправлена", body: `${formatRub(payout.amount)} отправлено на указанные реквизиты.`, link: "/seller/payouts" }).catch(() => {});
  return ok();
}

/** (REQUESTED|APPROVED) → REJECTED with a reason; the funds return to SELLER_AVAILABLE via a PAYOUT_REVERSAL posting (same transaction). */
export async function rejectPayout(ctx: AdminCtx, input: unknown) {
  const p = parseInput(actionSchema.extend({ note: z.string().trim().min(3, "Укажите причину отказа").max(500) }), input);
  if (p.error) return p.error;
  const payout = await prisma.$transaction(async (tx) => {
    const cur = await lockPayout(tx, p.data.payoutId);
    if (cur.status !== "APPROVED" && cur.status !== "REQUESTED") throw new AdminError("Выплата уже обработана");
    await postLedger(tx, { kind: "PAYOUT_REVERSAL", lines: payoutReversalLines(cur.sellerId, cur.amount), payoutId: cur.id, memo: `Отказ в выплате: ${p.data.note}` });
    await tx.payout.update({ where: { id: cur.id }, data: { status: "REJECTED", processedAt: new Date(), processedById: ctx.admin.id, note: p.data.note } });
    await audit(tx, ctx, { action: "payout.reject", entityType: "Payout", entityId: cur.id, before: { status: cur.status }, after: { status: "REJECTED", amount: cur.amount, reason: p.data.note } });
    return cur;
  });
  await notify(payout.sellerId, { type: "PAYOUT_UPDATE", title: "Выплата отклонена", body: `${formatRub(payout.amount)} возвращено на ваш доступный баланс. Причина: ${p.data.note}`, link: "/seller/payouts" }).catch(() => {});
  return ok();
}
