import "server-only";
import { z } from "zod";
import { prisma } from "@asap/db";
import { idSchema } from "@asap/shared";
import { notify } from "@/server/notifications";
import { AdminError, audit, fail, ok, parseInput, type AdminCtx } from "./action";

const decisionSchema = z.object({
  sellerId: idSchema,
  decision: z.enum(["approve", "reject", "suspend", "restore"]),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Seller verification workflow on SellerProfile.status:
 *   approve: PENDING|REJECTED → VERIFIED (+verifiedAt, user promoted to SELLER)   reject: PENDING → REJECTED (reason required)
 *   suspend: VERIFIED → SUSPENDED (reason required)                                restore: SUSPENDED|REJECTED → VERIFIED
 */
export async function reviewSeller(ctx: AdminCtx, input: unknown) {
  const p = parseInput(decisionSchema, input);
  if (p.error) return p.error;
  const { sellerId, decision, reason } = p.data;
  if ((decision === "reject" || decision === "suspend") && !reason) return fail("Укажите причину", { reason: ["Укажите причину"] });

  const result = await prisma.$transaction(async (tx) => {
    const profile = await tx.sellerProfile.findUnique({ where: { id: sellerId }, include: { user: { select: { id: true, role: true } } } });
    if (!profile) throw new AdminError("Продавец не найден");
    const from = profile.status;
    const allowed: Record<typeof decision, string[]> = { approve: ["PENDING", "REJECTED"], reject: ["PENDING"], suspend: ["VERIFIED"], restore: ["SUSPENDED", "REJECTED"] };
    if (!allowed[decision].includes(from)) throw new AdminError("Это действие недоступно для текущего статуса продавца");
    const to = decision === "approve" || decision === "restore" ? "VERIFIED" : decision === "reject" ? "REJECTED" : "SUSPENDED";

    await tx.sellerProfile.update({ where: { id: sellerId }, data: { status: to, ...(to === "VERIFIED" ? { verifiedAt: new Date() } : {}) } });
    if (to === "VERIFIED" && profile.user.role === "USER") await tx.user.update({ where: { id: profile.userId }, data: { role: "SELLER" } });
    await audit(tx, ctx, { action: `seller.${decision}`, entityType: "SellerProfile", entityId: sellerId, before: { status: from }, after: { status: to, reason: reason ?? null } });
    return { userId: profile.userId, to, shopName: profile.shopName };
  });

  const msg =
    result.to === "VERIFIED"
      ? { title: "Магазин подтверждён", body: `Магазин «${result.shopName}» прошёл проверку — можно публиковать товары.`, link: "/seller" }
      : result.to === "REJECTED"
        ? { title: "Заявка продавца отклонена", body: `Причина: ${reason}`, link: "/seller" }
        : { title: "Магазин приостановлен", body: `Причина: ${reason}`, link: "/seller" };
  await notify(result.userId, { type: "SYSTEM", ...msg }).catch(() => {});
  return ok();
}

const commissionSchema = z.object({
  sellerId: idSchema,
  /** percent with up to 2 decimals, e.g. "8" or "7,5"; empty string removes the override (default commission applies) */
  percent: z
    .string()
    .trim()
    .regex(/^(\d{1,2}([.,]\d{1,2})?)?$/, "Введите процент от 0 до 50, например 8 или 7,5")
    .transform((v) => (v === "" ? null : Number(v.replace(",", "."))))
    .refine((v) => v === null || (v >= 0 && v <= 50), "Комиссия должна быть от 0 до 50%"),
});

/** Per-seller commission override (basis points on SellerProfile.commissionBps; NULL = platform default). Applies to future orders only. */
export async function setSellerCommission(ctx: AdminCtx, input: unknown) {
  const p = parseInput(commissionSchema, input);
  if (p.error) return p.error;
  const { sellerId, percent } = p.data;
  const bps = percent === null ? null : Math.round(percent * 100);
  await prisma.$transaction(async (tx) => {
    const profile = await tx.sellerProfile.findUnique({ where: { id: sellerId }, select: { commissionBps: true } });
    if (!profile) throw new AdminError("Продавец не найден");
    await tx.sellerProfile.update({ where: { id: sellerId }, data: { commissionBps: bps } });
    await audit(tx, ctx, { action: "seller.commission", entityType: "SellerProfile", entityId: sellerId, before: { commissionBps: profile.commissionBps }, after: { commissionBps: bps } });
  });
  return ok();
}
