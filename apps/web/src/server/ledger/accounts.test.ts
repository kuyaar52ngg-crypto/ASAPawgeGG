import { describe, expect, it } from "vitest";
import { splitCommission } from "@asap/shared";
import {
  LedgerError,
  assertBalanced,
  balanceOfLines,
  cacheDeltas,
  holdReleaseLines,
  payoutLines,
  payoutReversalLines,
  purchaseLines,
  refundLines,
  topupLines,
  totals,
  type LedgerLine,
} from "./accounts";

const buyer = "u_buyer";
const seller = "u_seller";

function item(total: number, bps: number) {
  const { fee, net } = splitCommission(total, bps);
  return { buyerId: buyer, sellerId: seller, total, sellerEarning: net, commissionAmount: fee };
}

describe("assertBalanced", () => {
  it("accepts balanced postings", () => {
    expect(() => assertBalanced(topupLines(buyer, 12_345))).not.toThrow();
  });
  it("rejects unbalanced postings", () => {
    const lines: LedgerLine[] = [
      { account: "EXTERNAL", direction: "DEBIT", amount: 100 },
      { account: "USER_BALANCE", ownerId: buyer, direction: "CREDIT", amount: 99 },
    ];
    expect(() => assertBalanced(lines)).toThrow(LedgerError);
  });
  it("rejects non-positive / fractional amounts", () => {
    for (const amount of [0, -5, 10.5]) {
      expect(() => assertBalanced([{ account: "EXTERNAL", direction: "DEBIT", amount }, { account: "USER_BALANCE", ownerId: buyer, direction: "CREDIT", amount }])).toThrow(LedgerError);
    }
  });
  it("requires ownerId for owned accounts and forbids it for platform accounts", () => {
    expect(() => assertBalanced([{ account: "USER_BALANCE", direction: "CREDIT", amount: 1 }, { account: "EXTERNAL", direction: "DEBIT", amount: 1 }])).toThrow(/ownerId/);
    expect(() => assertBalanced([{ account: "EXTERNAL", ownerId: "x", direction: "DEBIT", amount: 1 }, { account: "USER_BALANCE", ownerId: buyer, direction: "CREDIT", amount: 1 }])).toThrow(/must not have ownerId/);
  });
  it("rejects single-entry postings", () => {
    expect(() => assertBalanced([{ account: "EXTERNAL", direction: "DEBIT", amount: 1 }])).toThrow(LedgerError);
  });
});

describe("posting builders", () => {
  it("purchase: buyer debit == seller hold + platform fee", () => {
    const lines = purchaseLines(item(199_900, 1000));
    const t = totals(lines);
    expect(t.debit).toBe(199_900);
    expect(t.credit).toBe(199_900);
    expect(lines.find((l) => l.account === "SELLER_HOLD")!.amount).toBe(179_910);
    expect(lines.find((l) => l.account === "PLATFORM_FEE")!.amount).toBe(19_990);
  });

  it("purchase with 0% commission omits the zero fee line (ledger forbids zero amounts)", () => {
    const lines = purchaseLines(item(50_000, 0));
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.account === "PLATFORM_FEE")).toBe(false);
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it("purchase rejects inconsistent snapshots", () => {
    expect(() => purchaseLines({ buyerId: buyer, sellerId: seller, total: 100, sellerEarning: 80, commissionAmount: 10 })).toThrow(LedgerError);
  });

  it("refund debits HOLD before release and AVAILABLE after release; always balanced", () => {
    const base = item(99_900, 800);
    const held = refundLines({ ...base, holdReleased: false });
    const released = refundLines({ ...base, holdReleased: true });
    expect(held.find((l) => l.direction === "DEBIT" && l.ownerId === seller)!.account).toBe("SELLER_HOLD");
    expect(released.find((l) => l.direction === "DEBIT" && l.ownerId === seller)!.account).toBe("SELLER_AVAILABLE");
    for (const lines of [held, released]) {
      expect(totals(lines).debit).toBe(totals(lines).credit);
      expect(lines.find((l) => l.account === "USER_BALANCE")).toMatchObject({ direction: "CREDIT", amount: 99_900 });
    }
  });

  it("purchase followed by refund nets to zero on every account", () => {
    const base = item(123_457, 1250);
    const all = [...purchaseLines(base), ...refundLines({ ...base, holdReleased: false })];
    for (const acct of ["USER_BALANCE", "SELLER_HOLD", "PLATFORM_FEE"] as const) {
      expect(balanceOfLines(all.filter((l) => l.account === acct))).toBe(0);
    }
  });

  it("hold release / payout / payout reversal are balanced mirrors", () => {
    expect(totals(holdReleaseLines(seller, 5000)).debit).toBe(5000);
    expect(balanceOfLines([...payoutLines(seller, 7000), ...payoutReversalLines(seller, 7000)].filter((l) => l.account === "SELLER_AVAILABLE"))).toBe(0);
    expect(balanceOfLines([...payoutLines(seller, 7000), ...payoutReversalLines(seller, 7000)].filter((l) => l.account === "EXTERNAL"))).toBe(0);
  });

  it("empty (all zero) postings yield no lines", () => {
    expect(topupLines(buyer, 0)).toEqual([]);
  });
});

describe("balance math", () => {
  it("EXTERNAL grows on DEBIT (money in), other accounts on CREDIT", () => {
    const lines = topupLines(buyer, 10_000);
    expect(balanceOfLines(lines.filter((l) => l.account === "EXTERNAL"))).toBe(10_000);
    expect(balanceOfLines(lines.filter((l) => l.account === "USER_BALANCE"))).toBe(10_000);
  });

  it("a full order flow keeps the books balanced and conserves money", () => {
    // gateway pays 1 000 ₽ -> buyer balance, then purchase of two items
    const a = item(60_000, 1000);
    const b = item(40_000, 800);
    const all = [...topupLines(buyer, 100_000), ...purchaseLines(a), ...purchaseLines(b)];
    expect(totals(all).debit).toBe(totals(all).credit);
    expect(balanceOfLines(all.filter((l) => l.account === "USER_BALANCE"))).toBe(0);
    const hold = balanceOfLines(all.filter((l) => l.account === "SELLER_HOLD"));
    const fee = balanceOfLines(all.filter((l) => l.account === "PLATFORM_FEE"));
    const external = balanceOfLines(all.filter((l) => l.account === "EXTERNAL"));
    expect(hold + fee).toBe(external);
    expect(external).toBe(100_000);
  });
});

describe("cacheDeltas", () => {
  it("nets owned-account changes per owner and drops zeros", () => {
    const lines = [...topupLines(buyer, 100_000), ...purchaseLines(item(100_000, 1000))];
    const d = cacheDeltas(lines);
    expect(d.userBalance.size).toBe(0); // +100k then -100k
    expect(d.sellerHold.get(seller)).toBe(90_000);
    expect(d.sellerAvailable.size).toBe(0);
  });

  it("reports a negative balance delta for a pure purchase (balance payment)", () => {
    const d = cacheDeltas(purchaseLines(item(25_000, 1000)));
    expect(d.userBalance.get(buyer)).toBe(-25_000);
  });

  it("refund credits the buyer and debits the seller hold", () => {
    const d = cacheDeltas(refundLines({ ...item(10_000, 1000), holdReleased: false }));
    expect(d.userBalance.get(buyer)).toBe(10_000);
    expect(d.sellerHold.get(seller)).toBe(-9_000);
  });
});
