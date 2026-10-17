import "server-only";
import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@asap/db";
import { assertBalanced, balanceOfLines, cacheDeltas, type LedgerPosting } from "./accounts";
import type { LedgerAccountName } from "./types";

/** Any Prisma client usable inside or outside a transaction. */
export type Db = Prisma.TransactionClient | typeof prisma;
export type Tx = Prisma.TransactionClient;

export class InsufficientFundsError extends Error {
  constructor(
    public readonly account: LedgerAccountName,
    public readonly ownerId: string,
  ) {
    super(account === "USER_BALANCE" ? "Недостаточно средств на балансе" : "Недостаточно доступных средств");
    this.name = "InsufficientFundsError";
  }
}

/**
 * Post a balanced set of entries AND update cached balances (User.balance, SellerProfile.holdBalance/availableBalance).
 * MUST run inside a prisma.$transaction (pass `tx`) together with the business change that causes it.
 *
 * Guards: User.balance can never go negative (also a DB CHECK) -> InsufficientFundsError;
 * SELLER_AVAILABLE cannot be overdrawn by a PAYOUT. Refund clawbacks may push seller caches below zero (seller owes the platform).
 *
 * Returns the generated txId (or null when the posting is empty).
 */
export async function postLedger(tx: Tx, posting: LedgerPosting): Promise<string | null> {
  if (posting.lines.length === 0) return null;
  assertBalanced(posting.lines);
  const txId = randomUUID();
  const deltas = cacheDeltas(posting.lines);

  for (const [userId, delta] of deltas.userBalance) {
    if (delta < 0) {
      const res = await tx.user.updateMany({ where: { id: userId, balance: { gte: -delta } }, data: { balance: { decrement: -delta } } });
      if (res.count !== 1) throw new InsufficientFundsError("USER_BALANCE", userId);
    } else {
      await tx.user.update({ where: { id: userId }, data: { balance: { increment: delta } } });
    }
  }
  for (const [sellerId, delta] of deltas.sellerHold) {
    await tx.sellerProfile.updateMany({ where: { userId: sellerId }, data: { holdBalance: { increment: delta } } });
  }
  for (const [sellerId, delta] of deltas.sellerAvailable) {
    if (delta < 0 && posting.kind === "PAYOUT") {
      const res = await tx.sellerProfile.updateMany({ where: { userId: sellerId, availableBalance: { gte: -delta } }, data: { availableBalance: { decrement: -delta } } });
      if (res.count !== 1) throw new InsufficientFundsError("SELLER_AVAILABLE", sellerId);
    } else {
      await tx.sellerProfile.updateMany({ where: { userId: sellerId }, data: { availableBalance: { increment: delta } } });
    }
  }

  await tx.ledgerEntry.createMany({
    data: posting.lines.map((l) => ({
      txId,
      kind: posting.kind,
      account: l.account,
      ownerId: l.ownerId ?? null,
      direction: l.direction,
      amount: l.amount,
      orderId: posting.orderId ?? null,
      orderItemId: posting.orderItemId ?? null,
      paymentId: posting.paymentId ?? null,
      payoutId: posting.payoutId ?? null,
      memo: posting.memo ?? null,
    })),
  });
  return txId;
}

/** Ledger balance of one account (source of truth, NOT the cached column). Kopecks. */
export async function getBalance(account: LedgerAccountName, ownerId?: string | null, db: Db = prisma): Promise<number> {
  const rows = await db.ledgerEntry.groupBy({
    by: ["direction"],
    where: { account, ownerId: ownerId ?? null },
    _sum: { amount: true },
  });
  return balanceOfLines(rows.map((r) => ({ account, direction: r.direction, amount: r._sum.amount ?? 0 })));
}

export interface LedgerIntegrityReport {
  unbalancedTx: string[];
  userBalanceMismatches: { userId: string; cached: number; ledger: number }[];
  sellerMismatches: { sellerId: string; field: "holdBalance" | "availableBalance"; cached: number; ledger: number }[];
}

/** Consistency audit used by tests/admin tooling: every txId balanced, every cached balance equals the ledger. */
export async function verifyLedgerIntegrity(db: Db = prisma): Promise<LedgerIntegrityReport> {
  const unbalanced = await db.$queryRaw<{ txId: string }[]>`
    SELECT "txId" FROM "LedgerEntry" GROUP BY 1
    HAVING SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END) <> 0`;

  const userRows = await db.$queryRaw<{ id: string; cached: number; ledger: number }[]>`
    SELECT u.id, u.balance AS cached,
           COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount ELSE -l.amount END), 0)::int AS ledger
    FROM "User" u
    LEFT JOIN "LedgerEntry" l ON l."ownerId" = u.id AND l.account = 'USER_BALANCE'
    GROUP BY u.id HAVING u.balance <> COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount ELSE -l.amount END), 0)`;

  const sellerRows = await db.$queryRaw<{ id: string; hold_c: number; hold_l: number; avail_c: number; avail_l: number }[]>`
    SELECT s."userId" AS id, s."holdBalance" AS hold_c, s."availableBalance" AS avail_c,
      COALESCE(SUM(CASE WHEN l.account = 'SELLER_HOLD' THEN (CASE WHEN l.direction = 'CREDIT' THEN l.amount ELSE -l.amount END) END), 0)::int AS hold_l,
      COALESCE(SUM(CASE WHEN l.account = 'SELLER_AVAILABLE' THEN (CASE WHEN l.direction = 'CREDIT' THEN l.amount ELSE -l.amount END) END), 0)::int AS avail_l
    FROM "SellerProfile" s
    LEFT JOIN "LedgerEntry" l ON l."ownerId" = s."userId" AND l.account IN ('SELLER_HOLD', 'SELLER_AVAILABLE')
    GROUP BY s."userId", s."holdBalance", s."availableBalance"`;

  const sellerMismatches: LedgerIntegrityReport["sellerMismatches"] = [];
  for (const r of sellerRows) {
    if (r.hold_c !== r.hold_l) sellerMismatches.push({ sellerId: r.id, field: "holdBalance", cached: r.hold_c, ledger: r.hold_l });
    if (r.avail_c !== r.avail_l) sellerMismatches.push({ sellerId: r.id, field: "availableBalance", cached: r.avail_c, ledger: r.avail_l });
  }
  return {
    unbalancedTx: unbalanced.map((r) => r.txId),
    userBalanceMismatches: userRows.map((r) => ({ userId: r.id, cached: r.cached, ledger: r.ledger })),
    sellerMismatches,
  };
}
