import { STEAM_TOPUP_DEFAULT_FEE_PERCENT, quoteSteamTopup } from "@asap/shared";
import type { ItemMeta } from "./meta";

export interface PriceableProduct {
  type: string;
  price: number;
  variants: { id: string; price: number; isActive?: boolean; attributes?: unknown }[];
}

export type UnitPrice =
  | {
      ok: true;
      /** price per unit the buyer pays (kopecks) */
      unitPrice: number;
      variantId: string | null;
      /** custom Steam top-up: kopecks credited to the wallet */
      topupAmountKopecks?: number;
      /** service fee included in unitPrice (custom Steam top-up only) */
      topupFee?: number;
    }
  | { ok: false; error: string };

const activeVariants = (p: PriceableProduct) => p.variants.filter((v) => v.isActive !== false);

/** A product supports free-amount Steam top-ups when its variants are priced per wallet amount in RUB. */
export function supportsCustomTopup(p: PriceableProduct): boolean {
  return p.type === "TOPUP" && activeVariants(p).some((v) => (v.attributes as { amountRub?: number } | null)?.amountRub !== undefined);
}

/**
 * Server-side price of ONE cart/order unit (never trust the client):
 *   - variant chosen          -> variant.price
 *   - product has variants, none chosen, TOPUP with meta.amountKopecks -> quoteSteamTopup(amount, feePercent).total
 *   - product has variants, none chosen otherwise -> error
 *   - no variants             -> product.price
 */
export function resolveUnitPrice(p: PriceableProduct, variantId: string | null, meta: ItemMeta | null, steamFeePercent: number = STEAM_TOPUP_DEFAULT_FEE_PERCENT): UnitPrice {
  const variants = activeVariants(p);
  if (variantId) {
    const v = variants.find((x) => x.id === variantId);
    return v ? { ok: true, unitPrice: v.price, variantId: v.id } : { ok: false, error: "Вариант недоступен" };
  }
  if (variants.length === 0) return { ok: true, unitPrice: p.price, variantId: null };
  if (supportsCustomTopup(p) && meta?.amountKopecks) {
    try {
      const q = quoteSteamTopup(meta.amountKopecks, steamFeePercent);
      return { ok: true, unitPrice: q.total, variantId: null, topupAmountKopecks: q.amount, topupFee: q.fee };
    } catch {
      return { ok: false, error: "Сумма пополнения: от 100 до 15 000 ₽" };
    }
  }
  return { ok: false, error: "Выберите вариант товара" };
}
