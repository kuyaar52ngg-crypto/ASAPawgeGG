import { describe, expect, it } from "vitest";
import { quoteSteamTopup } from "./steam";

describe("quoteSteamTopup", () => {
  it("matches seeded Steam variant prices at 4%", () => {
    expect(quoteSteamTopup(50_000, 4)).toEqual({ amount: 50_000, fee: 2_000, total: 52_000, feePercent: 4 });
    expect(quoteSteamTopup(500_000, 4).total).toBe(520_000);
  });
  it("rounds the fee half up", () => {
    expect(quoteSteamTopup(10_050, 5).fee).toBe(503); // 502.5 -> 503
  });
  it("rejects out-of-range and fractional kopecks", () => {
    expect(() => quoteSteamTopup(5_000, 4)).toThrow(RangeError);
    expect(() => quoteSteamTopup(2_000_000, 4)).toThrow(RangeError);
    expect(() => quoteSteamTopup(10_000.5, 4)).toThrow(RangeError);
  });
  it("falls back to the default fee for invalid percent", () => {
    expect(quoteSteamTopup(100_000, Number.NaN).feePercent).toBe(5);
  });
});
