import { describe, expect, it } from "vitest";
import { hasRequiredInput, metaKey, parseItemMeta, requiredInput } from "./meta";

describe("requiredInput", () => {
  it("Steam top-ups need a login, manual products a note, keys nothing", () => {
    expect(requiredInput({ type: "TOPUP", deliveryMode: "AUTO_PROVIDER", platform: "STEAM" })).toBe("steamLogin");
    expect(requiredInput({ type: "TOPUP", deliveryMode: "AUTO_PROVIDER", platform: "MOBILE" })).toBe("buyerInput");
    expect(requiredInput({ type: "CURRENCY", deliveryMode: "MANUAL", platform: null })).toBe("buyerInput");
    expect(requiredInput({ type: "KEY", deliveryMode: "AUTO_STOCK", platform: "STEAM" })).toBeNull();
  });
});

describe("parseItemMeta", () => {
  it("whitelists keys and trims", () => {
    expect(parseItemMeta({ steamLogin: " my_login ", evil: "x" })).toEqual({ ok: true, meta: { steamLogin: "my_login" } });
  });
  it("rejects invalid Steam logins", () => {
    expect(parseItemMeta({ steamLogin: "a b" }).ok).toBe(false);
    expect(parseItemMeta({ steamLogin: "ab" }).ok).toBe(false);
    expect(parseItemMeta({ steamLogin: "<script>" }).ok).toBe(false);
  });
  it("keeps the custom Steam amount (kopecks) within the allowed range", () => {
    expect(parseItemMeta({ steamLogin: "abc", amountKopecks: 150_000 })).toEqual({ ok: true, meta: { steamLogin: "abc", amountKopecks: 150_000 } });
    expect(parseItemMeta({ steamLogin: "abc", amountKopecks: 5_000 }).ok).toBe(false);
    expect(parseItemMeta({ steamLogin: "abc", amountKopecks: 99_999_999 }).ok).toBe(false);
    expect(parseItemMeta({ steamLogin: "abc", amountKopecks: 1000.5 }).ok).toBe(false);
  });
  it("empty -> null", () => {
    expect(parseItemMeta(null)).toEqual({ ok: true, meta: null });
    expect(parseItemMeta({})).toEqual({ ok: true, meta: null });
  });
});

describe("hasRequiredInput / metaKey", () => {
  it("checks the required key", () => {
    expect(hasRequiredInput("steamLogin", { steamLogin: "abc" })).toBe(true);
    expect(hasRequiredInput("steamLogin", {})).toBe(false);
    expect(hasRequiredInput("buyerInput", { steamLogin: "abc" })).toBe(false);
    expect(hasRequiredInput(null, null)).toBe(true);
  });
  it("merges identical lines only", () => {
    expect(metaKey({ steamLogin: "abc" })).toBe(metaKey({ steamLogin: "abc", junk: 1 }));
    expect(metaKey({ steamLogin: "abc" })).not.toBe(metaKey({ steamLogin: "abd" }));
    expect(metaKey({ steamLogin: "abc", amountKopecks: 10_000 })).not.toBe(metaKey({ steamLogin: "abc", amountKopecks: 20_000 }));
    expect(metaKey(null)).toBe(metaKey({}));
  });
});
