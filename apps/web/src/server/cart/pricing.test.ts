import { describe, expect, it } from "vitest";
import { quoteSteamTopup } from "@asap/shared";
import { resolveUnitPrice, supportsCustomTopup } from "./pricing";

const keyProduct = { type: "KEY", price: 189_900, variants: [] };
const subscription = { type: "SUBSCRIPTION", price: 50_000, variants: [{ id: "v1", price: 50_000 }, { id: "v2", price: 140_000 }, { id: "v3", price: 90_000, isActive: false }] };
const steam = {
  type: "TOPUP",
  price: 52_000,
  variants: [
    { id: "s500", price: 52_000, attributes: { amountRub: 500 } },
    { id: "s1000", price: 104_000, attributes: { amountRub: 1000 } },
  ],
};
const steamKzt = { type: "TOPUP", price: 46_000, variants: [{ id: "k1", price: 46_000, attributes: { amountKzt: 2500 } }] };

describe("resolveUnitPrice", () => {
  it("plain product uses Product.price", () => {
    expect(resolveUnitPrice(keyProduct, null, null)).toEqual({ ok: true, unitPrice: 189_900, variantId: null });
  });
  it("variant price wins and must be an ACTIVE variant of the product", () => {
    expect(resolveUnitPrice(subscription, "v2", null)).toMatchObject({ ok: true, unitPrice: 140_000, variantId: "v2" });
    expect(resolveUnitPrice(subscription, "v3", null).ok).toBe(false); // inactive
    expect(resolveUnitPrice(subscription, "nope", null).ok).toBe(false);
  });
  it("a product with variants requires choosing one", () => {
    expect(resolveUnitPrice(subscription, null, null)).toEqual({ ok: false, error: "Выберите вариант товара" });
  });
  it("custom Steam amount is priced server-side with the fee (amount + fee)", () => {
    const r = resolveUnitPrice(steam, null, { steamLogin: "abc", amountKopecks: 123_400 }, 5);
    const q = quoteSteamTopup(123_400, 5);
    expect(r).toEqual({ ok: true, unitPrice: q.total, variantId: null, topupAmountKopecks: 123_400, topupFee: q.fee });
    expect(q.total).toBe(123_400 + 6_170);
  });
  it("custom amount is refused for non-RUB variant sets and out-of-range sums; a chosen variant ignores the amount", () => {
    expect(supportsCustomTopup(steam)).toBe(true);
    expect(supportsCustomTopup(steamKzt)).toBe(false);
    expect(resolveUnitPrice(steamKzt, null, { amountKopecks: 123_400 }).ok).toBe(false);
    expect(resolveUnitPrice(steam, null, { amountKopecks: 100 as number }).ok).toBe(false);
    expect(resolveUnitPrice(steam, "s500", { amountKopecks: 999_900 })).toMatchObject({ ok: true, unitPrice: 52_000 });
  });
  it("a tampered client price cannot exist: only DB values are used", () => {
    expect(resolveUnitPrice(keyProduct, null, { amountKopecks: 10_000 })).toMatchObject({ unitPrice: 189_900 });
  });
});
