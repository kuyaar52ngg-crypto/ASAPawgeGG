import { describe, expect, it, vi } from "vitest";
import { PlategaProvider, mapPlategaStatus, type PlategaConfig } from "./platega";
import { RollyPayProvider, mapRollyStatus, type RollyPayConfig } from "./rollypay";
import { SANDBOX_SIGNATURE_HEADER, SandboxProvider, buildSandboxWebhook } from "./sandbox";
import { hmacSha256Hex } from "./signature";
import { ProviderError, WebhookPayloadError, WebhookVerificationError } from "./types";

const plategaCfg: PlategaConfig = {
  merchantId: "m-123",
  secret: "platega-secret",
  apiUrl: "https://app.platega.test",
  createPath: "/transaction/process",
  statusPath: "/transaction/{id}",
  merchantHeader: "X-MerchantId",
  secretHeader: "X-Secret",
  methodSbp: 2,
  methodCard: 10,
};
const rollyCfg: RollyPayConfig = {
  apiKey: "rp-key",
  secret: "rp-secret",
  apiUrl: "https://api.rollypay.test",
  createPath: "/v1/invoices",
  statusPath: "/v1/invoices/{id}",
  authHeader: "Authorization",
  signatureHeader: "x-signature",
};
const createInput = {
  payment: { id: "pay_1", amount: 199_990, currency: "RUB", purpose: "ORDER" as const, userId: "u1", method: "sbp" as const },
  order: { id: "ord_1", number: "AG-260101-ABCD", email: "a@b.c" },
  description: "Заказ AG-260101-ABCD",
  returnUrl: "https://shop.test/checkout/success?order=ord_1",
  failUrl: "https://shop.test/checkout/fail?order=ord_1",
};
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("PlategaProvider", () => {
  it("createPayment: sends merchant headers + RUB amount, parses transactionId/redirect", async () => {
    const f = vi.fn(async () => jsonResponse({ transactionId: "tr-9", redirect: "https://pay.platega.test/tr-9", status: "PENDING" }));
    const p = new PlategaProvider({ ...plategaCfg, fetch: f as unknown as typeof fetch });
    const res = await p.createPayment(createInput);
    expect(res).toMatchObject({ externalId: "tr-9", paymentUrl: "https://pay.platega.test/tr-9" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://app.platega.test/transaction/process");
    expect((init.headers as Record<string, string>)["X-MerchantId"]).toBe("m-123");
    expect((init.headers as Record<string, string>)["X-Secret"]).toBe("platega-secret");
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({ paymentMethod: 2, paymentDetails: { amount: 1999.9, currency: "RUB" }, payload: "ord_1", return: createInput.returnUrl, failedUrl: createInput.failUrl });
  });

  it("createPayment: card uses the card method id; top-ups send the payment id as payload", async () => {
    const f = vi.fn(async () => jsonResponse({ transactionId: "t", redirect: "https://x" }));
    const p = new PlategaProvider({ ...plategaCfg, fetch: f as unknown as typeof fetch });
    await p.createPayment({ ...createInput, order: null, payment: { ...createInput.payment, method: "card", purpose: "BALANCE_TOPUP" } });
    const sent = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.paymentMethod).toBe(10);
    expect(sent.payload).toBe("pay_1");
  });

  it("createPayment: surfaces provider errors and incomplete responses", async () => {
    const bad = new PlategaProvider({ ...plategaCfg, fetch: (async () => jsonResponse({ message: "denied" }, 401)) as unknown as typeof fetch });
    await expect(bad.createPayment(createInput)).rejects.toBeInstanceOf(ProviderError);
    const empty = new PlategaProvider({ ...plategaCfg, fetch: (async () => jsonResponse({})) as unknown as typeof fetch });
    await expect(empty.createPayment(createInput)).rejects.toThrow(/transactionId/);
  });

  const hdr = (over: Record<string, string> = {}) => new Headers({ "X-MerchantId": "m-123", "X-Secret": "platega-secret", ...over });
  const p = new PlategaProvider(plategaCfg);

  it("verifyWebhook: valid CONFIRMED callback -> PAID in kopecks", () => {
    const ev = p.verifyWebhook(JSON.stringify({ id: "tr-9", amount: 1999.9, currency: "RUB", status: "CONFIRMED", payload: "ord_1" }), hdr());
    expect(ev).toMatchObject({ externalId: "tr-9", status: "PAID", amount: 199_990, reference: "ord_1", eventId: "tr-9:CONFIRMED" });
  });
  it("verifyWebhook: CANCELED -> CANCELLED with its own event id", () => {
    const ev = p.verifyWebhook(JSON.stringify({ id: "tr-9", status: "CANCELED" }), hdr());
    expect(ev.status).toBe("CANCELLED");
    expect(ev.eventId).toBe("tr-9:CANCELED");
    expect(ev.amount).toBeUndefined();
  });
  it("verifyWebhook: rejects wrong / missing credentials", () => {
    const body = JSON.stringify({ id: "tr-9", status: "CONFIRMED" });
    expect(() => p.verifyWebhook(body, hdr({ "X-Secret": "wrong" }))).toThrow(WebhookVerificationError);
    expect(() => p.verifyWebhook(body, new Headers())).toThrow(WebhookVerificationError);
  });
  it("verifyWebhook: bad JSON / missing id are payload errors (after auth)", () => {
    expect(() => p.verifyWebhook("not json", hdr())).toThrow(WebhookPayloadError);
    expect(() => p.verifyWebhook("{}", hdr())).toThrow(WebhookPayloadError);
  });
  it("isConfigured only with both credentials", () => {
    expect(p.isConfigured()).toBe(true);
    expect(new PlategaProvider({ ...plategaCfg, secret: "" }).isConfigured()).toBe(false);
  });
  it("status mapping", () => {
    expect(mapPlategaStatus("CONFIRMED")).toBe("PAID");
    expect(mapPlategaStatus("canceled")).toBe("CANCELLED");
    expect(mapPlategaStatus("PENDING")).toBe("PENDING");
    expect(mapPlategaStatus(undefined)).toBe("PENDING");
  });
  it("getStatus reads the status endpoint", async () => {
    const f = vi.fn(async () => jsonResponse({ status: "CONFIRMED", amount: 10 }));
    const res = await new PlategaProvider({ ...plategaCfg, fetch: f as unknown as typeof fetch }).getStatus("tr 9");
    expect(res).toMatchObject({ status: "PAID", amount: 1000 });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("https://app.platega.test/transaction/tr%209");
  });
});

describe("RollyPayProvider", () => {
  const p = new RollyPayProvider(rollyCfg);
  const sign = (body: string, secret = "rp-secret") => hmacSha256Hex(secret, body);

  it("createPayment: Bearer auth, RUB amount, tolerant response parsing", async () => {
    const f = vi.fn(async () => jsonResponse({ data: { invoice_id: "inv-7", pay_url: "https://pay.rollypay.test/inv-7" } }));
    const res = await new RollyPayProvider({ ...rollyCfg, fetch: f as unknown as typeof fetch }).createPayment(createInput);
    expect(res).toMatchObject({ externalId: "inv-7", paymentUrl: "https://pay.rollypay.test/inv-7" });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer rp-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ amount: 1999.9, currency: "RUB", order_id: "pay_1" });
  });

  it("custom auth header carries the bare key", async () => {
    const f = vi.fn(async () => jsonResponse({ id: "1", url: "https://x" }));
    await new RollyPayProvider({ ...rollyCfg, authHeader: "X-Api-Key", fetch: f as unknown as typeof fetch }).createPayment(createInput);
    expect(((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>)["X-Api-Key"]).toBe("rp-key");
  });

  it("verifyWebhook: valid HMAC over the raw body", () => {
    const body = JSON.stringify({ id: "inv-7", order_id: "pay_1", status: "paid", amount: 1999.9 });
    const ev = p.verifyWebhook(body, new Headers({ "x-signature": sign(body) }));
    expect(ev).toMatchObject({ externalId: "inv-7", status: "PAID", amount: 199_990, reference: "pay_1" });
  });
  it("verifyWebhook: rejects bad / missing / re-serialised-body signatures", () => {
    const body = JSON.stringify({ id: "inv-7", status: "paid", amount: 5 });
    expect(() => p.verifyWebhook(body, new Headers({ "x-signature": sign(body, "other") }))).toThrow(WebhookVerificationError);
    expect(() => p.verifyWebhook(body, new Headers())).toThrow(WebhookVerificationError);
    expect(() => p.verifyWebhook(JSON.stringify(JSON.parse(body), null, 2), new Headers({ "x-signature": sign(body) }))).toThrow(WebhookVerificationError);
  });
  it("status mapping", () => {
    expect(mapRollyStatus("paid")).toBe("PAID");
    expect(mapRollyStatus("EXPIRED")).toBe("CANCELLED");
    expect(mapRollyStatus("failed")).toBe("FAILED");
    expect(mapRollyStatus("created")).toBe("PENDING");
  });
});

describe("SandboxProvider", () => {
  const secret = "sandbox-secret";
  const p = new SandboxProvider({ secret, appUrl: "http://localhost:3000", enabled: true });

  it("createPayment points to the sandbox checkout page", async () => {
    expect(await p.createPayment(createInput)).toMatchObject({ externalId: "sbx_pay_1", paymentUrl: "http://localhost:3000/checkout/sandbox/pay_1" });
  });
  it("round-trips a signed webhook", () => {
    const wh = buildSandboxWebhook(secret, { eventId: "e1", externalId: "sbx_pay_1", status: "PAID", amount: 199_990 });
    const ev = p.verifyWebhook(wh.body, new Headers(wh.headers));
    expect(ev).toMatchObject({ eventId: "e1", externalId: "sbx_pay_1", status: "PAID", amount: 199_990 });
  });
  it("rejects forged signatures and malformed bodies", () => {
    const wh = buildSandboxWebhook("not-the-secret", { eventId: "e1", externalId: "x", status: "PAID" });
    expect(() => p.verifyWebhook(wh.body, new Headers(wh.headers))).toThrow(WebhookVerificationError);
    const body = JSON.stringify({ eventId: "e1", externalId: "x", status: "REFUND_ME" });
    expect(() => p.verifyWebhook(body, new Headers({ [SANDBOX_SIGNATURE_HEADER]: hmacSha256Hex(secret, body) }))).toThrow(WebhookPayloadError);
  });
  it("can be disabled", () => {
    expect(new SandboxProvider({ secret, appUrl: "x", enabled: false }).isConfigured()).toBe(false);
  });
});
