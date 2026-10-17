import "server-only";
import { z } from "zod";
import { prisma } from "@asap/db";
import { MIN_PAYOUT_KOPECKS, formatRub, idSchema } from "@asap/shared";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/server/audit";
import { payoutLines, payoutReversalLines } from "@/server/ledger/accounts";
import { InsufficientFundsError, postLedger } from "@/server/ledger/ledger";
import { notify } from "@/server/notifications";
import type { SellerCtx } from "./seller-context";
import { fail, ok, zodFail, type ActionResult } from "./result";

export const MAX_OPEN_PAYOUTS = 3;

function luhn(num: string): boolean {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const digits = (s: string) => s.replace(/[\s-]/g, "");

const detailsByMethod = {
  CARD: z.object({ card: z.string().transform(digits).pipe(z.string().regex(/^\d{16,19}$/, "Номер карты — 16–19 цифр").refine(luhn, "Некорректный номер карты")) }),
  SBP: z.object({
    phone: z.string().transform((s) => s.replace(/[^\d+]/g, "")).pipe(z.string().regex(/^\+?\d{10,15}$/, "Телефон в формате +79991234567")),
    bank: z.string().trim().min(2, "Укажите банк").max(60),
  }),
  USDT: z.object({
    address: z.string().trim().regex(/^[A-Za-z0-9]{26,64}$/, "Некорректный адрес кошелька"),
    network: z.enum(["TRC20", "ERC20", "BEP20"], { message: "Выберите сеть" }),
  }),
  YOOMONEY: z.object({ wallet: z.string().transform(digits).pipe(z.string().regex(/^\d{11,20}$/, "Номер кошелька ЮMoney — 11–20 цифр")) }),
} as const;

const requestSchema = z.object({
  amount: z.number().int("Сумма должна быть целым числом копеек").min(MIN_PAYOUT_KOPECKS, `Минимальная сумма выплаты — ${formatRub(MIN_PAYOUT_KOPECKS)}`).max(1_000_000_000),
  method: z.enum(["CARD", "SBP", "USDT", "YOOMONEY"]),
  details: z.record(z.string(), z.string().max(200)),
});

/** Masked version of stored payout details for tables (never show a full card number back). */
export function maskPayoutDetails(method: string, details: unknown): string {
  const d = (details && typeof details === "object" ? details : {}) as Record<string, string>;
  switch (method) {
    case "CARD": return d.card ? `•••• ${d.card.slice(-4)}` : "—";
    case "SBP": return d.phone ? `${d.phone.slice(0, 5)}•••${d.phone.slice(-2)}${d.bank ? ` · ${d.bank}` : ""}` : "—";
    case "USDT": return d.address ? `${d.network ?? ""} ${d.address.slice(0, 5)}…${d.address.slice(-4)}`.trim() : "—";
    case "YOOMONEY": return d.wallet ? `•••${d.wallet.slice(-4)}` : "—";
    default: return "—";
  }
}

/**
 * Payout request (CONTRACTS §8 `PAYOUT`): Payout row + ledger posting DEBIT SELLER_AVAILABLE / CREDIT EXTERNAL in ONE transaction;
 * the guarded decrement in postLedger prevents overdrawing (double-click / concurrent requests).
 */
export async function requestPayout(ctx: SellerCtx, raw: unknown): Promise<ActionResult<{ payoutId: string }>> {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const dparsed = detailsByMethod[parsed.data.method].safeParse(parsed.data.details);
  if (!dparsed.success) return zodFail(dparsed.error);
  const rl = await rateLimit({ key: `payout-request:${ctx.user.id}`, limit: 5, windowSec: 3600 });
  if (!rl.ok) return fail("Слишком много заявок. Попробуйте позже.");
  const { amount, method } = parsed.data;
  const details = dparsed.data as Record<string, string>;

  try {
    const payout = await prisma.$transaction(async (tx) => {
      const open = await tx.payout.count({ where: { sellerId: ctx.user.id, status: { in: ["REQUESTED", "APPROVED"] } } });
      if (open >= MAX_OPEN_PAYOUTS) throw new PayoutRuleError(`Одновременно можно иметь не более ${MAX_OPEN_PAYOUTS} активных заявок на выплату`);
      const created = await tx.payout.create({ data: { sellerId: ctx.user.id, amount, method, details }, select: { id: true } });
      await postLedger(tx, { kind: "PAYOUT", lines: payoutLines(ctx.user.id, amount), payoutId: created.id });
      await tx.sellerProfile.update({ where: { userId: ctx.user.id }, data: { payoutDetails: { method, details } } });
      return created;
    });
    await writeAudit({ actorId: ctx.user.id, action: "payout.request", entityType: "Payout", entityId: payout.id, after: { amount, method } }).catch(() => {});
    const admins = await prisma.user.findMany({ where: { role: "ADMIN", banned: false }, select: { id: true }, take: 20 });
    await Promise.all(admins.map((a) => notify(a.id, { type: "PAYOUT_UPDATE", title: "Новая заявка на выплату", body: `${ctx.profile.shopName}: ${formatRub(amount)}`, link: "/admin/payouts" }).catch(() => {})));
    return ok({ payoutId: payout.id });
  } catch (e) {
    if (e instanceof InsufficientFundsError) return fail("Недостаточно доступных средств. Средства на удержании станут доступны после окончания периода холда.", { amount: ["Недостаточно средств"] });
    if (e instanceof PayoutRuleError) return fail(e.message);
    throw e;
  }
}

class PayoutRuleError extends Error {}

/** Seller withdraws their own not-yet-processed request: status -> CANCELLED and the funds return to SELLER_AVAILABLE. */
export async function cancelPayout(ctx: SellerCtx, rawId: unknown): Promise<ActionResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return fail("Заявка не найдена");
  const done = await prisma.$transaction(async (tx) => {
    // compare-and-set: only a still-REQUESTED payout of this seller can be cancelled, exactly once
    const res = await tx.payout.updateMany({ where: { id: id.data, sellerId: ctx.user.id, status: "REQUESTED" }, data: { status: "CANCELLED", processedAt: new Date(), note: "Отменено продавцом" } });
    if (res.count !== 1) return false;
    const payout = await tx.payout.findUniqueOrThrow({ where: { id: id.data }, select: { amount: true } });
    await postLedger(tx, { kind: "PAYOUT_REVERSAL", lines: payoutReversalLines(ctx.user.id, payout.amount), payoutId: id.data });
    return true;
  });
  if (!done) return fail("Заявку нельзя отменить: она уже обработана или не найдена");
  await writeAudit({ actorId: ctx.user.id, action: "payout.cancel", entityType: "Payout", entityId: id.data }).catch(() => {});
  return ok();
}
