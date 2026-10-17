import { clampKopecks, percentOf, splitCommission } from "@asap/shared";

/** Effective commission bps: seller override, else platform default. Always a valid 0..10000 integer. */
export function resolveCommissionBps(sellerBps: number | null | undefined, defaultBps: number): number {
  const bps = sellerBps ?? defaultBps;
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) return Math.min(10_000, Math.max(0, Math.round(Number.isFinite(bps) ? bps : 1000)));
  return bps;
}

/**
 * Spread an order-level discount over line totals proportionally (floor); the leftover kopecks go to the
 * largest lines first. Σ shares === discount exactly (capped at the subtotal) and no line is ever driven below 1 kopeck.
 */
export function allocateDiscount(lineTotals: readonly number[], discount: number): number[] {
  const subtotal = lineTotals.reduce((s, t) => s + t, 0);
  const d = clampKopecks(discount, 0, Math.max(0, subtotal - lineTotals.length));
  if (d === 0 || subtotal === 0) return lineTotals.map(() => 0);
  const shares = lineTotals.map((t) => Math.min(Math.max(0, t - 1), Math.floor((d * t) / subtotal)));
  let left = d - shares.reduce((s, x) => s + x, 0);
  const order = lineTotals.map((_, i) => i).sort((a, b) => lineTotals[b]! - lineTotals[a]! || a - b);
  while (left > 0) {
    let progressed = false;
    for (const i of order) {
      if (left === 0) break;
      if (shares[i]! < lineTotals[i]! - 1) {
        shares[i]!++;
        left--;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return shares;
}

export interface ItemMoney {
  /** line total BEFORE the promo share (unitPrice × quantity) */
  gross: number;
  /** promo share allocated to this line */
  discountShare: number;
  /** line total AFTER discount (OrderItem.total) */
  total: number;
  commissionBps: number;
  commissionAmount: number;
  sellerEarning: number;
}

/** Commission is computed on the post-discount line total (CONTRACTS §6). */
export function computeItemMoney(gross: number, discountShare: number, commissionBps: number): ItemMoney {
  const total = gross - discountShare;
  const { fee, net } = splitCommission(total, commissionBps);
  return { gross, discountShare, total, commissionBps, commissionAmount: fee, sellerEarning: net };
}

export interface PromoRule {
  type: "PERCENT" | "FIXED";
  /** PERCENT: 1..100; FIXED: kopecks */
  value: number;
  minOrder: number;
  maxDiscount?: number | null;
}

/** Minimum a single order line must still cost after discount (the ledger forbids zero amounts). */
export const MIN_LINE_TOTAL_KOPECKS = 100;

/**
 * Promo discount for a subtotal. PERCENT -> percentOf (floor), FIXED -> min(value, subtotal),
 * capped by maxDiscount and by (subtotal − 1 ₽ per line) so the order never becomes free.
 */
export function computePromoDiscount(rule: PromoRule, subtotal: number, lineCount = 1): number {
  if (subtotal < rule.minOrder) return 0;
  let d = rule.type === "PERCENT" ? percentOf(subtotal, Math.min(100, Math.max(0, rule.value))) : Math.min(rule.value, subtotal);
  if (rule.maxDiscount != null) d = Math.min(d, rule.maxDiscount);
  d = Math.min(d, Math.max(0, subtotal - MIN_LINE_TOTAL_KOPECKS * Math.max(1, lineCount)));
  return clampKopecks(d, 0, subtotal);
}
