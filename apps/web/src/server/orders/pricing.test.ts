import { describe, expect, it } from "vitest";
import { splitCommission } from "@asap/shared";
import { MIN_LINE_TOTAL_KOPECKS, allocateDiscount, computeItemMoney, computePromoDiscount, resolveCommissionBps } from "./pricing";

describe("resolveCommissionBps", () => {
  it("prefers the seller override (even 0) over the default", () => {
    expect(resolveCommissionBps(800, 1000)).toBe(800);
    expect(resolveCommissionBps(0, 1000)).toBe(0);
    expect(resolveCommissionBps(null, 1000)).toBe(1000);
    expect(resolveCommissionBps(undefined, 1250)).toBe(1250);
  });
  it("clamps garbage into 0..10000", () => {
    expect(resolveCommissionBps(null, 99_999)).toBe(10_000);
    expect(resolveCommissionBps(null, -5)).toBe(0);
    expect(resolveCommissionBps(null, 12.4 as number)).toBe(12);
  });
});

describe("computeItemMoney (commission is taken from the post-discount total)", () => {
  it("10% of 1 999 ₽", () => {
    const m = computeItemMoney(199_900, 0, 1000);
    expect(m).toMatchObject({ total: 199_900, commissionAmount: 19_990, sellerEarning: 179_910 });
  });
  it("discount share reduces both total and commission base", () => {
    const m = computeItemMoney(100_000, 10_000, 1000);
    expect(m.total).toBe(90_000);
    expect(m.commissionAmount).toBe(9_000);
    expect(m.sellerEarning).toBe(81_000);
  });
  it("rounds the fee half-up and keeps fee + earning === total", () => {
    for (const total of [1, 5, 99, 101, 12_345, 99_999]) {
      for (const bps of [0, 1, 333, 800, 1000, 1250, 10_000]) {
        const m = computeItemMoney(total, 0, bps);
        expect(m.commissionAmount + m.sellerEarning).toBe(m.total);
        expect(m.commissionAmount).toBe(splitCommission(total, bps).fee);
      }
    }
    expect(computeItemMoney(5, 0, 1000).commissionAmount).toBe(1); // 0.5 -> 1
  });
});

describe("allocateDiscount", () => {
  it("sums exactly to the discount", () => {
    expect(allocateDiscount([10_000, 20_000, 30_000], 6_001).reduce((s, x) => s + x, 0)).toBe(6_001);
  });
  it("is proportional (floor) with leftovers to the largest lines", () => {
    expect(allocateDiscount([100, 100, 100], 100)).toEqual([34, 33, 33]);
    expect(allocateDiscount([1000, 3000], 400)).toEqual([100, 300]);
  });
  it("no discount -> zeros; discount is capped at subtotal − 1 kopeck per line", () => {
    expect(allocateDiscount([500, 500], 0)).toEqual([0, 0]);
    const capped = allocateDiscount([500, 500], 5_000);
    expect(capped.reduce((s, x) => s + x, 0)).toBe(998);
    expect(capped.every((s, i) => s < [500, 500][i]!)).toBe(true);
  });
  it("never produces a negative or oversized share (randomised)", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
    for (let n = 0; n < 500; n++) {
      const lines = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => 100 + Math.floor(rnd() * 500_000));
      const subtotal = lines.reduce((s, x) => s + x, 0);
      const discount = Math.floor(rnd() * subtotal);
      const shares = allocateDiscount(lines, discount);
      const maxAllowed = subtotal - lines.length;
      expect(shares.reduce((s, x) => s + x, 0)).toBe(Math.min(discount, maxAllowed));
      shares.forEach((s, i) => {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(lines[i]! - s).toBeGreaterThanOrEqual(1);
      });
    }
  });
});

describe("computePromoDiscount", () => {
  const welcome = { type: "PERCENT" as const, value: 10, minOrder: 0 };
  const summer = { type: "FIXED" as const, value: 50_000, minOrder: 300_000 };

  it("PERCENT floors (WELCOME10)", () => {
    expect(computePromoDiscount(welcome, 199_999)).toBe(19_999);
    expect(computePromoDiscount(welcome, 100_000)).toBe(10_000);
  });
  it("FIXED respects minOrder and the subtotal (SUMMER500)", () => {
    expect(computePromoDiscount(summer, 299_999)).toBe(0);
    expect(computePromoDiscount(summer, 300_000)).toBe(50_000);
    expect(computePromoDiscount({ type: "FIXED", value: 900_000, minOrder: 0 }, 100_000)).toBe(100_000 - MIN_LINE_TOTAL_KOPECKS);
  });
  it("maxDiscount caps percent promos", () => {
    expect(computePromoDiscount({ type: "PERCENT", value: 50, minOrder: 0, maxDiscount: 20_000 }, 1_000_000)).toBe(20_000);
  });
  it("an order can never become free", () => {
    expect(computePromoDiscount({ type: "PERCENT", value: 100, minOrder: 0 }, 1_000, 2)).toBe(1_000 - 2 * MIN_LINE_TOTAL_KOPECKS);
    expect(computePromoDiscount({ type: "PERCENT", value: 100, minOrder: 0 }, 150, 2)).toBe(0);
  });
});
