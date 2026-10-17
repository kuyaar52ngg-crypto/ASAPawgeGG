/**
 * Money helpers. ALL money in the system is an integer number of KOPECKS (1 RUB = 100 kopecks).
 * Never store or pass floats for money. Only convert at the UI/input boundary.
 */

export type Kopecks = number;

const rubFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const rubFmtFrac = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 199.99 | "199,99" -> 19999. Rounds half up to the nearest kopeck. */
export function rubToKopecks(rub: number | string): Kopecks {
  const n = typeof rub === "string" ? Number(rub.replace(/\s/g, "").replace(",", ".")) : rub;
  if (!Number.isFinite(n)) throw new RangeError(`Invalid RUB amount: ${rub}`);
  return Math.round(n * 100 + Number.EPSILON * Math.sign(n));
}

/** 19999 -> 199.99 (for display math only, never store). */
export function kopecksToRub(kopecks: Kopecks): number {
  return kopecks / 100;
}

/**
 * Format kopecks as Russian rubles: 19999 -> "199,99 ₽", 150000 -> "1 500 ₽".
 * Whole-ruble amounts omit the fractional part unless `alwaysFraction` is set.
 */
export function formatRub(kopecks: Kopecks, opts: { alwaysFraction?: boolean; symbol?: boolean } = {}): string {
  const { alwaysFraction = false, symbol = true } = opts;
  const whole = kopecks % 100 === 0;
  const rub = kopecks / 100;
  const body = whole && !alwaysFraction ? rubFmt.format(rub) : rubFmtFrac.format(rub);
  return symbol ? `${body} ₽` : body;
}

/** Discount percent between old and current price (0 if no discount). */
export function discountPercent(price: Kopecks, oldPrice?: Kopecks | null): number {
  if (!oldPrice || oldPrice <= price) return 0;
  return Math.round(((oldPrice - price) / oldPrice) * 100);
}

/** Commission split. fee = round-half-up(amount * bps / 10000); net = amount - fee. */
export function splitCommission(amount: Kopecks, bps: number): { fee: Kopecks; net: Kopecks } {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError("amount must be a non-negative integer");
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new RangeError("bps must be 0..10000");
  const fee = Math.floor((amount * bps + 5_000) / 10_000);
  return { fee, net: amount - fee };
}

/** Percent discount on an amount (floor, so platform never over-discounts). */
export function percentOf(amount: Kopecks, percent: number): Kopecks {
  return Math.floor((amount * percent) / 100);
}

/** Clamp helper for promo/discount math. */
export function clampKopecks(value: Kopecks, min = 0, max = Number.MAX_SAFE_INTEGER): Kopecks {
  return Math.min(Math.max(Math.trunc(value), min), max);
}
