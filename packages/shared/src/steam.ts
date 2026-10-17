import { STEAM_TOPUP_FEE_BPS, STEAM_TOPUP_MAX_KOPECKS, STEAM_TOPUP_MIN_KOPECKS } from "./constants";

/** Steam top-up price breakdown (all kopecks). total = amount credited to the wallet + service fee. */
export interface SteamTopupQuote {
  amount: number;
  fee: number;
  total: number;
  feePercent: number;
}

/** Default fee percent when Setting("steam_topup_fee_percent") is missing. */
export const STEAM_TOPUP_DEFAULT_FEE_PERCENT = STEAM_TOPUP_FEE_BPS / 100;

/**
 * Quote for a Steam wallet top-up: the buyer pays `amount + fee`, Steam receives `amount`.
 * fee = round-half-up(amount * feePercent / 100). Throws RangeError for out-of-range amounts.
 * ZONE B: use this (with the Setting value) to price TOPUP cart lines that carry `meta.amountKopecks` and no variant.
 */
export function quoteSteamTopup(amountKopecks: number, feePercent: number = STEAM_TOPUP_DEFAULT_FEE_PERCENT): SteamTopupQuote {
  if (!Number.isInteger(amountKopecks)) throw new RangeError("amount must be an integer number of kopecks");
  if (amountKopecks < STEAM_TOPUP_MIN_KOPECKS || amountKopecks > STEAM_TOPUP_MAX_KOPECKS) {
    throw new RangeError(`amount must be within ${STEAM_TOPUP_MIN_KOPECKS}..${STEAM_TOPUP_MAX_KOPECKS} kopecks`);
  }
  const pct = Number.isFinite(feePercent) && feePercent >= 0 && feePercent <= 100 ? feePercent : STEAM_TOPUP_DEFAULT_FEE_PERCENT;
  const bps = Math.round(pct * 100);
  const fee = Math.floor((amountKopecks * bps + 5_000) / 10_000);
  return { amount: amountKopecks, fee, total: amountKopecks + fee, feePercent: pct };
}
