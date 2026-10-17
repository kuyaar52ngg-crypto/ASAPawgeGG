/**
 * Pure double-entry ledger math (no DB). Posting rules: docs/CONTRACTS.md §8.
 * Everything here is deterministic and unit-tested; DB writes live in ./ledger.ts.
 */
import type { LedgerAccountName, LedgerDirectionName, LedgerKindName } from "./types";

export interface LedgerLine {
  account: LedgerAccountName;
  /** user id for USER_BALANCE / SELLER_*; null for PLATFORM_FEE / EXTERNAL */
  ownerId?: string | null;
  direction: LedgerDirectionName;
  /** kopecks, strictly > 0 */
  amount: number;
}

export interface LedgerPosting {
  kind: LedgerKindName;
  lines: LedgerLine[];
  orderId?: string | null;
  orderItemId?: string | null;
  paymentId?: string | null;
  payoutId?: string | null;
  memo?: string | null;
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

const OWNED: ReadonlySet<LedgerAccountName> = new Set(["USER_BALANCE", "SELLER_HOLD", "SELLER_AVAILABLE"]);

export function isOwnedAccount(account: LedgerAccountName): boolean {
  return OWNED.has(account);
}

/** Σ DEBIT and Σ CREDIT of the lines. */
export function totals(lines: readonly LedgerLine[]): { debit: number; credit: number } {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    if (l.direction === "DEBIT") debit += l.amount;
    else credit += l.amount;
  }
  return { debit, credit };
}

/** Throws unless every line is valid and Σ DEBIT === Σ CREDIT (> 0). */
export function assertBalanced(lines: readonly LedgerLine[]): void {
  if (lines.length < 2) throw new LedgerError("A posting needs at least two entries");
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amount) || l.amount <= 0) throw new LedgerError(`Ledger amount must be a positive integer (got ${l.amount})`);
    if (isOwnedAccount(l.account) && !l.ownerId) throw new LedgerError(`Account ${l.account} requires ownerId`);
    if (!isOwnedAccount(l.account) && l.ownerId) throw new LedgerError(`Account ${l.account} must not have ownerId`);
  }
  const { debit, credit } = totals(lines);
  if (debit !== credit) throw new LedgerError(`Unbalanced posting: debit ${debit} != credit ${credit}`);
}

/**
 * Signed contribution of a line to the account's "natural" balance
 * (EXTERNAL: DEBIT = money came in => +; all other accounts: CREDIT => +).
 */
export function naturalDelta(line: Pick<LedgerLine, "account" | "direction" | "amount">): number {
  const plusOnDebit = line.account === "EXTERNAL";
  const positive = plusOnDebit ? line.direction === "DEBIT" : line.direction === "CREDIT";
  return positive ? line.amount : -line.amount;
}

/** Natural balance of an account from its entries. */
export function balanceOfLines(lines: readonly Pick<LedgerLine, "account" | "direction" | "amount">[]): number {
  return lines.reduce((s, l) => s + naturalDelta(l), 0);
}

export type CacheDeltas = {
  /** userId -> delta of User.balance */
  userBalance: Map<string, number>;
  /** sellerId -> delta of SellerProfile.holdBalance */
  sellerHold: Map<string, number>;
  /** sellerId -> delta of SellerProfile.availableBalance */
  sellerAvailable: Map<string, number>;
};

/** Net change of the cached balance columns caused by a posting (zero deltas omitted). */
export function cacheDeltas(lines: readonly LedgerLine[]): CacheDeltas {
  const out: CacheDeltas = { userBalance: new Map(), sellerHold: new Map(), sellerAvailable: new Map() };
  const bump = (m: Map<string, number>, id: string, d: number) => m.set(id, (m.get(id) ?? 0) + d);
  for (const l of lines) {
    if (!l.ownerId) continue;
    if (l.account === "USER_BALANCE") bump(out.userBalance, l.ownerId, naturalDelta(l));
    else if (l.account === "SELLER_HOLD") bump(out.sellerHold, l.ownerId, naturalDelta(l));
    else if (l.account === "SELLER_AVAILABLE") bump(out.sellerAvailable, l.ownerId, naturalDelta(l));
  }
  for (const m of [out.userBalance, out.sellerHold, out.sellerAvailable]) for (const [k, v] of m) if (v === 0) m.delete(k);
  return out;
}

// ───────────── posting builders (CONTRACTS §8) ─────────────

const line = (account: LedgerAccountName, direction: LedgerDirectionName, amount: number, ownerId?: string | null): LedgerLine => ({
  account,
  direction,
  amount,
  ownerId: ownerId ?? null,
});

/** Drop zero-amount lines (the DB forbids amount = 0) and validate. Returns [] for an all-zero posting. */
function finalize(lines: LedgerLine[]): LedgerLine[] {
  const nonZero = lines.filter((l) => l.amount !== 0);
  if (nonZero.length === 0) return [];
  assertBalanced(nonZero);
  return nonZero;
}

/** Money entering the system from a gateway: EXTERNAL (debit) -> buyer's site balance (credit). Used for order payments AND balance top-ups. */
export function topupLines(buyerId: string, amount: number): LedgerLine[] {
  return finalize([line("EXTERNAL", "DEBIT", amount), line("USER_BALANCE", "CREDIT", amount, buyerId)]);
}

/** Order item paid from the buyer's balance: seller earning goes to HOLD, commission to the platform. */
export function purchaseLines(p: { buyerId: string; sellerId: string; total: number; sellerEarning: number; commissionAmount: number }): LedgerLine[] {
  if (p.sellerEarning + p.commissionAmount !== p.total) throw new LedgerError("sellerEarning + commissionAmount must equal item total");
  return finalize([
    line("USER_BALANCE", "DEBIT", p.total, p.buyerId),
    line("SELLER_HOLD", "CREDIT", p.sellerEarning, p.sellerId),
    line("PLATFORM_FEE", "CREDIT", p.commissionAmount),
  ]);
}

/** Refund of an item to the buyer's site balance. Seller side is debited from HOLD (not yet released) or AVAILABLE. */
export function refundLines(p: { buyerId: string; sellerId: string; total: number; sellerEarning: number; commissionAmount: number; holdReleased: boolean }): LedgerLine[] {
  if (p.sellerEarning + p.commissionAmount !== p.total) throw new LedgerError("sellerEarning + commissionAmount must equal item total");
  return finalize([
    line(p.holdReleased ? "SELLER_AVAILABLE" : "SELLER_HOLD", "DEBIT", p.sellerEarning, p.sellerId),
    line("PLATFORM_FEE", "DEBIT", p.commissionAmount),
    line("USER_BALANCE", "CREDIT", p.total, p.buyerId),
  ]);
}

/** Worker cron mirror (kept here so web/admin tooling and tests share the rule). */
export function holdReleaseLines(sellerId: string, sellerEarning: number): LedgerLine[] {
  return finalize([line("SELLER_HOLD", "DEBIT", sellerEarning, sellerId), line("SELLER_AVAILABLE", "CREDIT", sellerEarning, sellerId)]);
}

/** Seller payout request: funds leave AVAILABLE immediately, EXTERNAL is credited (money goes out). */
export function payoutLines(sellerId: string, amount: number): LedgerLine[] {
  return finalize([line("SELLER_AVAILABLE", "DEBIT", amount, sellerId), line("EXTERNAL", "CREDIT", amount)]);
}

/** Payout rejected/cancelled: mirror of payoutLines. */
export function payoutReversalLines(sellerId: string, amount: number): LedgerLine[] {
  return finalize([line("EXTERNAL", "DEBIT", amount), line("SELLER_AVAILABLE", "CREDIT", amount, sellerId)]);
}
