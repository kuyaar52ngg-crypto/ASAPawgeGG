import "server-only";
import { prisma } from "@asap/db";
import type { Db } from "@/server/ledger/ledger";
import { computePromoDiscount } from "./pricing";

export interface PromoCheck {
  ok: boolean;
  /** Russian message for the buyer when !ok */
  error?: string;
  promoCodeId?: string;
  code?: string;
  discount?: number;
  description?: string;
}

/** Orders that count towards a user's per-user limit (anything not abandoned). */
const COUNTED_STATUSES = ["PENDING", "PAID", "PROCESSING", "DELIVERED", "DISPUTED"] as const;

/**
 * Validate a promo code for a user and subtotal (CONTRACTS §9):
 * isActive, expiresAt, maxUses/usedCount, minOrder, per-user limit (orders with promoCodeId).
 * `lineCount` is used for the "never free" cap.
 */
export async function validatePromo(rawCode: string, userId: string, subtotal: number, lineCount: number, db: Db = prisma): Promise<PromoCheck> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: "Введите промокод" };
  const promo = await db.promoCode.findUnique({ where: { code } });
  if (!promo || !promo.isActive) return { ok: false, error: "Промокод не найден или отключён" };
  if (promo.expiresAt && promo.expiresAt.getTime() < Date.now()) return { ok: false, error: "Срок действия промокода истёк" };
  if (promo.maxUses != null && promo.usedCount >= promo.maxUses) return { ok: false, error: "Лимит использований промокода исчерпан" };
  if (subtotal < promo.minOrder) {
    return { ok: false, error: `Промокод действует для заказов от ${Math.ceil(promo.minOrder / 100)} ₽` };
  }
  const used = await db.order.count({ where: { buyerId: userId, promoCodeId: promo.id, status: { in: [...COUNTED_STATUSES] } } });
  if (used >= promo.perUserLimit) return { ok: false, error: "Вы уже использовали этот промокод" };

  const discount = computePromoDiscount({ type: promo.type, value: promo.value, minOrder: promo.minOrder, maxDiscount: promo.maxDiscount }, subtotal, lineCount);
  if (discount <= 0) return { ok: false, error: "Промокод не применим к этому заказу" };
  return {
    ok: true,
    promoCodeId: promo.id,
    code: promo.code,
    discount,
    description: promo.type === "PERCENT" ? `Скидка ${promo.value}%` : "Фиксированная скидка",
  };
}
