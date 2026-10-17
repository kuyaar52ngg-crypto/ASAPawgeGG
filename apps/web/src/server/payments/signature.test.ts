import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hmacSha256Hex, safeEqual, verifyHeaderCredentials, verifyHmacSignature } from "./signature";

const secret = "whsec_test_secret";
const body = JSON.stringify({ id: "inv_1", status: "paid", amount: 199.9 });

describe("verifyHmacSignature", () => {
  it("accepts the correct hex signature (any case, with or without sha256= prefix)", () => {
    const sig = hmacSha256Hex(secret, body);
    expect(verifyHmacSignature({ secret, rawBody: body, signature: sig })).toBe(true);
    expect(verifyHmacSignature({ secret, rawBody: body, signature: sig.toUpperCase() })).toBe(true);
    expect(verifyHmacSignature({ secret, rawBody: body, signature: `sha256=${sig}` })).toBe(true);
  });
  it("accepts a base64 signature", () => {
    const b64 = createHmac("sha256", secret).update(body).digest("base64");
    expect(verifyHmacSignature({ secret, rawBody: body, signature: b64 })).toBe(true);
  });
  it("rejects a tampered body, wrong secret, missing or garbage signature", () => {
    const sig = hmacSha256Hex(secret, body);
    expect(verifyHmacSignature({ secret, rawBody: body.replace("199.9", "1.9"), signature: sig })).toBe(false);
    expect(verifyHmacSignature({ secret: "other", rawBody: body, signature: sig })).toBe(false);
    expect(verifyHmacSignature({ secret, rawBody: body, signature: null })).toBe(false);
    expect(verifyHmacSignature({ secret, rawBody: body, signature: "" })).toBe(false);
    expect(verifyHmacSignature({ secret, rawBody: body, signature: "zzzz" })).toBe(false);
    expect(verifyHmacSignature({ secret, rawBody: body, signature: sig.slice(0, -2) })).toBe(false);
  });
  it("never accepts anything when the secret is empty", () => {
    expect(verifyHmacSignature({ secret: "", rawBody: body, signature: hmacSha256Hex("", body) })).toBe(false);
  });
  it("is sensitive to whitespace changes in the raw body", () => {
    const sig = hmacSha256Hex(secret, body);
    expect(verifyHmacSignature({ secret, rawBody: ` ${body}`, signature: sig })).toBe(false);
  });
});

describe("safeEqual", () => {
  it("compares strings of different length without throwing", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("a", "")).toBe(false);
  });
});

describe("verifyHeaderCredentials", () => {
  const expected = { idHeader: "X-MerchantId", id: "merchant-1", secretHeader: "X-Secret", secret: "s3cret" };
  it("requires both headers to match", () => {
    expect(verifyHeaderCredentials(new Headers({ "x-merchantid": "merchant-1", "x-secret": "s3cret" }), expected)).toBe(true);
    expect(verifyHeaderCredentials(new Headers({ "x-merchantid": "merchant-1", "x-secret": "nope" }), expected)).toBe(false);
    expect(verifyHeaderCredentials(new Headers({ "x-merchantid": "other", "x-secret": "s3cret" }), expected)).toBe(false);
    expect(verifyHeaderCredentials(new Headers(), expected)).toBe(false);
  });
  it("rejects when the server has no credentials configured", () => {
    expect(verifyHeaderCredentials(new Headers({ "x-merchantid": "", "x-secret": "" }), { ...expected, id: "", secret: "" })).toBe(false);
  });
});
