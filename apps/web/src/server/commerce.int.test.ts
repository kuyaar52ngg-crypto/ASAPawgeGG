/**
 * Integration tests for the commerce core against a REAL PostgreSQL (seeded) + Redis.
 * Skipped unless INTEGRATION_DATABASE_URL is set — NEVER point it at a database you care about (it mutates data
 * and expects a freshly seeded DB). Easiest: `bash scripts/test-int.sh` (creates + reseeds `asapawge_test`, then runs this file).
 *
 * The worker is NOT expected to run: fulfilment goes through the in-process fallback (that is part of what is verified).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hmacSha256Hex } from "./payments/signature";

const URL = process.env.INTEGRATION_DATABASE_URL;
const d = describe.skipIf(!URL);

type Mods = {
  prisma: typeof import("@asap/db").prisma;
  cart: typeof import("./cart/service");
  orders: typeof import("./orders");
  initiate: typeof import("./payments/initiate");
  webhook: typeof import("./payments/webhook");
  sandbox: typeof import("./payments/sandbox");
  ledger: typeof import("./ledger");
  reconcile: typeof import("./payments/reconcile");
  redis: typeof import("@/lib/redis");
};
let m: Mods;
/** Fake Platega + RollyPay API (records requests) so the REAL HTTP adapters are exercised end to end. */
let fake: Server;
const fakeCalls: { url: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }[] = [];
let fakeSeq = 0;

const SECRET = "int-test-sandbox-secret";

async function setup(): Promise<Mods> {
  process.env.DATABASE_URL = URL!;
  process.env.STOCK_ENCRYPTION_KEY ??= "ZGV2LW9ubHktc3RvY2sta2V5LTMyLWJ5dGVzLWxvbiE=";
  process.env.SANDBOX_WEBHOOK_SECRET = SECRET;
  process.env.WORKER_URL = "http://127.0.0.1:9"; // unreachable on purpose -> inline fulfilment fallback
  process.env.APP_URL = "http://localhost:3000";
  fake = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      fakeCalls.push({ url: req.url ?? "", headers: req.headers, body });
      res.setHeader("content-type", "application/json");
      const id = `fake-${++fakeSeq}`;
      if (req.url?.startsWith("/transaction/process")) return void res.end(JSON.stringify({ transactionId: id, redirect: `https://pay.platega.example/${id}`, status: "PENDING" }));
      if (req.url?.startsWith("/v1/invoices")) return void res.end(JSON.stringify({ id, payment_url: `https://pay.rollypay.example/${id}` }));
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  Object.assign(process.env, { PLATEGA_MERCHANT_ID: "int-merchant", PLATEGA_SECRET: "int-platega-secret", PLATEGA_API_URL: base, ROLLYPAY_API_KEY: "int-rp-key", ROLLYPAY_SECRET: "int-rp-secret", ROLLYPAY_API_URL: base });
  const { prisma } = await import("@asap/db");
  return {
    prisma,
    cart: await import("./cart/service"),
    orders: await import("./orders"),
    initiate: await import("./payments/initiate"),
    webhook: await import("./payments/webhook"),
    sandbox: await import("./payments/sandbox"),
    ledger: await import("./ledger"),
    reconcile: await import("./payments/reconcile"),
    redis: await import("@/lib/redis"),
  };
}

let seq = 0;
async function newUser(balance = 0) {
  const email = `int-${Date.now()}-${seq++}@test.local`;
  const u = await m.prisma.user.create({ data: { email, name: "Int Test", role: "USER" }, select: { id: true, email: true } });
  if (balance > 0) {
    await m.prisma.$transaction(async (tx) => {
      await m.ledger.postLedger(tx, { kind: "TOPUP", lines: (await import("./ledger/accounts")).topupLines(u.id, balance), memo: "int test funds" });
    });
  }
  return u;
}

/** A simple AUTO_STOCK product without variants and enough stock. */
async function keyProduct(title?: string) {
  if (title) return m.prisma.product.findFirstOrThrow({ where: { title, status: "ACTIVE" } });
  // the plain key product with the most stock left
  const rows = await m.prisma.stockItem.groupBy({ by: ["productId"], where: { status: "AVAILABLE", variantId: null, product: { status: "ACTIVE", deliveryMode: "AUTO_STOCK", variants: { none: {} } } }, _count: { _all: true }, orderBy: { _count: { productId: "desc" } }, take: 1 });
  return m.prisma.product.findUniqueOrThrow({ where: { id: rows[0]!.productId } });
}
const stockCount = (productId: string, status: "AVAILABLE" | "RESERVED" | "SOLD", variantId: string | null = null) => m.prisma.stockItem.count({ where: { productId, variantId, status } });

async function orderFor(userId: string, email: string, lines: { productId: string; variantId?: string | null; quantity?: number; meta?: unknown }[], promoCode?: string) {
  await m.prisma.cartItem.deleteMany({ where: { cart: { userId } } });
  for (const l of lines) {
    const r = await m.cart.addItem({ userId }, { productId: l.productId, variantId: l.variantId ?? null, quantity: l.quantity ?? 1, meta: l.meta });
    if (!r.ok) throw new Error("addItem failed: " + r.error);
  }
  return m.orders.createOrderFromCart({ userId, email, promoCode });
}

function signed(externalId: string, status: "PAID" | "FAILED" | "CANCELLED", amount?: number, eventId = `evt-${Math.random().toString(36).slice(2)}`) {
  const wh = m.sandbox.buildSandboxWebhook(SECRET, { eventId, externalId, status, amount });
  return { body: wh.body, headers: new Headers(wh.headers), eventId };
}

async function expectLedgerHealthy() {
  const r = await m.ledger.verifyLedgerIntegrity();
  expect(r.unbalancedTx).toEqual([]);
  expect(r.userBalanceMismatches).toEqual([]);
  expect(r.sellerMismatches).toEqual([]);
}

d("commerce core (real DB)", () => {
  beforeAll(async () => {
    m = await setup();
  }, 30_000);
  afterAll(async () => {
    await m?.prisma.$disconnect();
    await m?.redis.redis.quit().catch(() => {});
    await new Promise((r) => fake?.close(r));
  });

  it("seed ledger is healthy before we start", async () => {
    await expectLedgerHealthy();
  });

  it("balance purchase: reserve -> atomic debit -> PAID -> inline fulfilment -> DELIVERED with decryptable key", async () => {
    const buyer = await newUser(500_000);
    const p = await keyProduct();
    const availBefore = await stockCount(p.id, "AVAILABLE");

    const order = await orderFor(buyer.id, buyer.email, [{ productId: p.id }]);
    expect(order.total).toBe(p.price);
    expect(await stockCount(p.id, "AVAILABLE")).toBe(availBefore - 1);
    const reserved = await m.prisma.stockItem.findMany({ where: { orderItem: { orderId: order.id } } });
    expect(reserved).toHaveLength(1);
    expect(reserved[0]!.status).toBe("RESERVED");
    expect(reserved[0]!.reservedUntil!.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);

    const items = await m.prisma.orderItem.findMany({ where: { orderId: order.id } });
    expect(items[0]!.commissionAmount + items[0]!.sellerEarning).toBe(items[0]!.total);

    const holdBefore = (await m.prisma.sellerProfile.findUniqueOrThrow({ where: { userId: p.sellerId } })).holdBalance;
    const res = await m.initiate.startOrderPayment({ orderId: order.id, userId: buyer.id, choice: "BALANCE" });
    expect(res.ok).toBe(true);

    const paid = await m.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(paid.status).toBe("DELIVERED"); // worker unreachable -> in-process fallback delivered it
    expect(paid.paidAt).toBeTruthy();
    expect(paid.deliveredAt).toBeTruthy();
    expect(paid.items[0]!.status).toBe("DELIVERED");
    expect(paid.items[0]!.holdReleaseAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await m.prisma.stockItem.count({ where: { orderItemId: items[0]!.id, status: "SOLD" } })).toBe(1);

    const user = await m.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } });
    expect(user.balance).toBe(500_000 - order.total);
    const hold = (await m.prisma.sellerProfile.findUniqueOrThrow({ where: { userId: p.sellerId } })).holdBalance;
    expect(hold - holdBefore).toBe(items[0]!.sellerEarning);

    const delivery = await m.orders.getOrderDelivery(order.id, buyer.id);
    expect(delivery![0]!.secrets).toHaveLength(1);
    expect(delivery![0]!.secrets[0]!.length).toBeGreaterThan(5);
    expect(await m.orders.getOrderDelivery(order.id, "someone-else")).toBeNull(); // ownership

    // idempotent: paying again is refused, nothing moves
    const again = await m.initiate.startOrderPayment({ orderId: order.id, userId: buyer.id, choice: "BALANCE" });
    expect(again.ok).toBe(false);
    expect((await m.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance).toBe(500_000 - order.total);
    await expectLedgerHealthy();
  }, 30_000);

  it("balance purchase with insufficient funds fails atomically and leaves the order PENDING with stock reserved", async () => {
    const buyer = await newUser(100); // 1 ₽
    const p = await keyProduct();
    const order = await orderFor(buyer.id, buyer.email, [{ productId: p.id }]);
    const res = await m.initiate.startOrderPayment({ orderId: order.id, userId: buyer.id, choice: "BALANCE" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Недостаточно/);
    const o = await m.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("PENDING");
    expect(await m.prisma.ledgerEntry.count({ where: { orderId: order.id } })).toBe(0);
    expect(await m.prisma.payment.count({ where: { orderId: order.id } })).toBe(0);
    expect((await m.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance).toBe(100);

    // cancelling frees the reservation
    const cancelled = await m.orders.cancelOrder(order.id, { buyerId: buyer.id });
    expect(cancelled.ok).toBe(true);
    expect(await m.prisma.stockItem.count({ where: { orderItemId: { not: null }, orderItem: { orderId: order.id } } })).toBe(0);
    expect((await m.orders.cancelOrder(order.id, { buyerId: buyer.id })).ok).toBe(false);
    expect((await m.orders.cancelOrder(order.id, { buyerId: "intruder" })).ok).toBe(false);
  }, 30_000);

  it("two concurrent balance payments of the same funds cannot both succeed", async () => {
    const p = await keyProduct();
    const buyer = await newUser(p.price + 50); // enough for exactly one order
    const o1 = await orderFor(buyer.id, buyer.email, [{ productId: p.id }]);
    const o2 = await m.orders.createOrderFromCart({ userId: buyer.id, email: buyer.email }).catch(() => null); // cart still holds the item
    const orders = [o1, o2].filter(Boolean) as { id: string }[];
    const results = await Promise.all(orders.map((o) => m.initiate.startOrderPayment({ orderId: o.id, userId: buyer.id, choice: "BALANCE" })));
    expect(results.filter((r) => r.ok).length).toBe(1);
    expect((await m.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance).toBe(50);
    await expectLedgerHealthy();
  }, 30_000);

  it("SKIP LOCKED reservation: last key goes to exactly one of two simultaneous checkouts", async () => {
    const p = await keyProduct("Palworld");
    // leave exactly one AVAILABLE item
    const avail = await m.prisma.stockItem.findMany({ where: { productId: p.id, status: "AVAILABLE" }, select: { id: true } });
    if (avail.length > 1) await m.prisma.stockItem.updateMany({ where: { id: { in: avail.slice(1).map((s) => s.id) } }, data: { status: "SOLD", soldAt: new Date() } });
    const [a, b] = [await newUser(), await newUser()];
    for (const u of [a, b]) {
      await m.prisma.cartItem.deleteMany({ where: { cart: { userId: u.id } } });
      const r = await m.cart.addItem({ userId: u.id }, { productId: p.id, quantity: 1 });
      expect(r.ok).toBe(true);
    }
    const settled = await Promise.allSettled([m.orders.createOrderFromCart({ userId: a.id, email: a.email }), m.orders.createOrderFromCart({ userId: b.id, email: b.email })]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const failed = settled.find((s) => s.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(m.orders.CheckoutError);
    expect((failed.reason as { code: string }).code).toBe("OUT_OF_STOCK");
    expect(await stockCount(p.id, "RESERVED")).toBeGreaterThanOrEqual(1);
    expect(await stockCount(p.id, "AVAILABLE")).toBe(0);
    // cart refuses to add when nothing is left
    const late = await m.cart.addItem({ userId: a.id }, { productId: p.id, quantity: 1 });
    expect(late.ok).toBe(false);
  }, 30_000);

  it("sandbox gateway: signed webhook pays the order once; duplicates and forgeries are handled", async () => {
    const buyer = await newUser();
    const p = await keyProduct("Elden Ring");
    const order = await orderFor(buyer.id, buyer.email, [{ productId: p.id }], "WELCOME10");
    expect(order.discount).toBe(Math.floor(order.subtotal / 10));
    expect(order.total).toBe(order.subtotal - order.discount);

    const start = await m.initiate.startOrderPayment({ orderId: order.id, userId: buyer.id, choice: "SANDBOX" });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.redirectUrl).toContain(`/checkout/sandbox/${start.paymentId}`);
    const payment = await m.prisma.payment.findUniqueOrThrow({ where: { id: start.paymentId } });
    expect(payment).toMatchObject({ provider: "SANDBOX", status: "PENDING", amount: order.total, orderId: order.id });
    expect(payment.externalId).toBe(`sbx_${payment.id}`);

    // forged signature
    const forged = m.sandbox.buildSandboxWebhook("wrong", { eventId: "x1", externalId: payment.externalId!, status: "PAID", amount: order.total });
    expect((await m.webhook.handleWebhook("SANDBOX", forged.body, new Headers(forged.headers))).status).toBe(401);
    expect((await m.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");

    // wrong amount is refused and nothing is posted
    const wrong = signed(payment.externalId!, "PAID", order.total - 1);
    const wr = await m.webhook.handleWebhook("SANDBOX", wrong.body, wrong.headers);
    expect(wr.status).toBe(422);
    expect((await m.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
    expect(await m.prisma.ledgerEntry.count({ where: { orderId: order.id } })).toBe(0);

    // the real thing
    const ok = signed(payment.externalId!, "PAID", order.total);
    expect((await m.webhook.handleWebhook("SANDBOX", ok.body, ok.headers)).status).toBe(200);
    let o = await m.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("DELIVERED");
    const entries = await m.prisma.ledgerEntry.count({ where: { orderId: order.id } });
    expect(entries).toBeGreaterThan(0);
    const promoUsed = (await m.prisma.promoCode.findUniqueOrThrow({ where: { code: "WELCOME10" } })).usedCount;

    // exact replay -> 200 duplicate, no new postings
    const replay = await m.webhook.handleWebhook("SANDBOX", ok.body, ok.headers);
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    // a different event id for the same payment -> still no double posting
    const second = signed(payment.externalId!, "PAID", order.total);
    expect((await m.webhook.handleWebhook("SANDBOX", second.body, second.headers)).status).toBe(200);
    expect(await m.prisma.ledgerEntry.count({ where: { orderId: order.id } })).toBe(entries);
    expect((await m.prisma.promoCode.findUniqueOrThrow({ where: { code: "WELCOME10" } })).usedCount).toBe(promoUsed);

    // gateway money passed through the buyer balance: net zero
    expect((await m.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance).toBe(0);
    o = await m.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("DELIVERED");

    // concurrent identical deliveries are serialised
    const order2 = await orderFor(buyer.id, buyer.email, [{ productId: (await keyProduct("Hogwarts Legacy")).id }]);
    const s2 = await m.initiate.startOrderPayment({ orderId: order2.id, userId: buyer.id, choice: "SANDBOX" });
    if (!s2.ok) throw new Error(s2.error);
    const pay2 = await m.prisma.payment.findUniqueOrThrow({ where: { id: s2.paymentId } });
    const evs = [signed(pay2.externalId!, "PAID", order2.total), signed(pay2.externalId!, "PAID", order2.total), signed(pay2.externalId!, "PAID", order2.total)];
    await Promise.all(evs.map((e) => m.webhook.handleWebhook("SANDBOX", e.body, e.headers)));
    expect((await m.prisma.ledgerEntry.groupBy({ by: ["txId"], where: { orderId: order2.id, kind: "PURCHASE" } })).length).toBe(1); // one posting (3 entries)
    expect((await m.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance).toBe(0);
    await expectLedgerHealthy();
  }, 40_000);

  it("declined sandbox payment leaves the order PENDING (retry possible); late money for a cancelled order is credited to the balance", async () => {
    const buyer = await newUser();
    const p = await keyProduct("Stardew Valley");
    const order = await orderFor(buyer.id, buyer.email, [{ productId: p.id }]);
    const start = await m.initiate.startOrderPayment({ orderId: order.id, userId: buyer.id, choice: "SANDBOX" });
    if (!start.ok) throw new Error(start.error);
    const pay = await m.prisma.payment.findUniqueOrThrow({ where: { id: start.paymentId } });

    const declined = signed(pay.externalId!, "FAILED");
    expect((await m.webhook.handleWebhook("SANDBOX", declined.body, declined.headers)).status).toBe(200);
    expect((await m.prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe("FAILED");
    expect((await m.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");

    // retry with another attempt, then the user abandons: order cancelled, the (new) payment cancelled
    const retry = await m.initiate.startOrderPayment({ orderId: order.id, userId: buyer.id, choice: "SANDBOX" });
    if (!retry.ok) throw new Error(retry.error);
    const pay2 = await m.prisma.payment.findUniqueOrThrow({ where: { id: retry.paymentId } });
    await m.orders.cancelOrder(order.id, { buyerId: buyer.id });
    expect((await m.prisma.payment.findUniqueOrThrow({ where: { id: pay2.id } })).status).toBe("CANCELLED");

    // ...but the provider still captured the money -> it must not be lost
    const late = signed(pay2.externalId!, "PAID", order.total);
    expect((await m.webhook.handleWebhook("SANDBOX", late.body, late.headers)).status).toBe(200);
    expect((await m.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
    expect((await m.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance).toBe(order.total);
    await expectLedgerHealthy();
  }, 30_000);

  it("Platega adapter over real HTTP: create -> callback with merchant headers -> PAID; cancel callback; forged headers", async () => {
    const buyer = await newUser();
    const p = await keyProduct("Windows 11 Pro — ключ активации");
    const order = await orderFor(buyer.id, buyer.email, [{ productId: p.id }]);
    const res = await m.initiate.startOrderPayment({ orderId: order.id, userId: buyer.id, choice: "PLATEGA_SBP" });
    expect(res).toMatchObject({ ok: true, redirectUrl: expect.stringContaining("https://pay.platega.example/fake-") });
    const call = fakeCalls.filter((c) => c.url.startsWith("/transaction/process")).at(-1)!;
    expect(call.headers["x-merchantid"]).toBe("int-merchant");
    expect(call.headers["x-secret"]).toBe("int-platega-secret");
    expect(call.body).toMatchObject({ paymentMethod: 2, paymentDetails: { amount: order.total / 100, currency: "RUB" }, payload: order.id });
    const pay = await m.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(pay).toMatchObject({ provider: "PLATEGA", status: "PENDING", method: "sbp" });

    const body = JSON.stringify({ id: pay.externalId, amount: order.total / 100, currency: "RUB", status: "CONFIRMED", payload: order.id });
    const hdr = (secret: string) => new Headers({ "X-MerchantId": "int-merchant", "X-Secret": secret });
    expect((await m.webhook.handleWebhook("PLATEGA", body, hdr("wrong"))).status).toBe(401);
    expect((await m.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
    expect((await m.webhook.handleWebhook("PLATEGA", body, hdr("int-platega-secret"))).status).toBe(200);
    expect((await m.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("DELIVERED");
    expect((await m.prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe("PAID");
    expect((await m.webhook.handleWebhook("PLATEGA", body, hdr("int-platega-secret"))).body.duplicate).toBe(true);

    // CANCELED callback marks the payment, the order stays payable
    const o2 = await orderFor(buyer.id, buyer.email, [{ productId: p.id }]);
    const r2 = await m.initiate.startOrderPayment({ orderId: o2.id, userId: buyer.id, choice: "PLATEGA_CARD" });
    expect(r2.ok).toBe(true);
    const pay2 = await m.prisma.payment.findFirstOrThrow({ where: { orderId: o2.id } });
    expect(fakeCalls.filter((c) => c.url.startsWith("/transaction/process")).at(-1)!.body.paymentMethod).toBe(10);
    const cancel = JSON.stringify({ id: pay2.externalId, status: "CANCELED", payload: o2.id });
    expect((await m.webhook.handleWebhook("PLATEGA", cancel, hdr("int-platega-secret"))).status).toBe(200);
    expect((await m.prisma.payment.findUniqueOrThrow({ where: { id: pay2.id } })).status).toBe("CANCELLED");
    expect((await m.prisma.order.findUniqueOrThrow({ where: { id: o2.id } })).status).toBe("PENDING");
    await expectLedgerHealthy();
  }, 30_000);

  it("RollyPay adapter over real HTTP: Bearer create -> HMAC-signed callback -> PAID", async () => {
    const buyer = await newUser();
    const p = await keyProduct("Microsoft Office 2021 Professional Plus");
    const order = await orderFor(buyer.id, buyer.email, [{ productId: p.id }]);
    const res = await m.initiate.startOrderPayment({ orderId: order.id, userId: buyer.id, choice: "ROLLYPAY" });
    expect(res).toMatchObject({ ok: true, redirectUrl: expect.stringContaining("https://pay.rollypay.example/fake-") });
    const call = fakeCalls.filter((c) => c.url.startsWith("/v1/invoices")).at(-1)!;
    expect(call.headers.authorization).toBe("Bearer int-rp-key");
    const pay = await m.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(call.body).toMatchObject({ order_id: pay.id, currency: "RUB", amount: order.total / 100 });

    const body = JSON.stringify({ id: pay.externalId, order_id: pay.id, status: "paid", amount: order.total / 100 });
    expect((await m.webhook.handleWebhook("ROLLYPAY", body, new Headers({ "x-signature": hmacSha256Hex("not-it", body) }))).status).toBe(401);
    expect((await m.webhook.handleWebhook("ROLLYPAY", body + " ", new Headers({ "x-signature": hmacSha256Hex("int-rp-secret", body) }))).status).toBe(401); // body altered after signing
    expect((await m.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
    expect((await m.webhook.handleWebhook("ROLLYPAY", body, new Headers({ "x-signature": hmacSha256Hex("int-rp-secret", body) }))).status).toBe(200);
    expect((await m.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("DELIVERED");
    await expectLedgerHealthy();
  }, 30_000);

  it("balance top-up through the gateway pipeline", async () => {
    const buyer = await newUser();
    const start = await m.initiate.startBalanceTopup({ userId: buyer.id, amount: 250_000, choice: "SANDBOX" });
    if (!start.ok) throw new Error(start.error);
    const pay = await m.prisma.payment.findUniqueOrThrow({ where: { id: start.paymentId } });
    expect(pay.purpose).toBe("BALANCE_TOPUP");
    const ev = signed(pay.externalId!, "PAID", 250_000);
    expect((await m.webhook.handleWebhook("SANDBOX", ev.body, ev.headers)).status).toBe(200);
    expect((await m.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance).toBe(250_000);
    expect((await m.initiate.startBalanceTopup({ userId: buyer.id, amount: 1000, choice: "BALANCE" })).ok).toBe(false);
    const dup = await m.webhook.handleWebhook("SANDBOX", ev.body, ev.headers);
    expect(dup.body.duplicate).toBe(true);
    expect((await m.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance).toBe(250_000);
    await expectLedgerHealthy();
  }, 30_000);

  it("variants, Steam top-up input and manual delivery", async () => {
    const buyer = await newUser(2_000_000);
    const steam = await m.prisma.product.findFirstOrThrow({ where: { type: "TOPUP", status: "ACTIVE" }, include: { variants: { where: { isActive: true }, orderBy: { price: "asc" } } } });
    // no variant -> refused
    expect((await m.cart.addItem({ userId: buyer.id }, { productId: steam.id, quantity: 1 })).ok).toBe(false);
    // bad login -> refused
    expect((await m.cart.addItem({ userId: buyer.id }, { productId: steam.id, variantId: steam.variants[0]!.id, quantity: 1, meta: { steamLogin: "a b!" } })).ok).toBe(false);
    // missing input lets the item in the cart but blocks checkout
    await m.prisma.cartItem.deleteMany({ where: { cart: { userId: buyer.id } } });
    expect((await m.cart.addItem({ userId: buyer.id }, { productId: steam.id, variantId: steam.variants[0]!.id, quantity: 1 })).ok).toBe(true);
    expect((await m.cart.getCartView({ userId: buyer.id })).checkoutReady).toBe(false);
    await expect(m.orders.createOrderFromCart({ userId: buyer.id, email: buyer.email })).rejects.toMatchObject({ code: "INPUT_REQUIRED" });

    const order = await orderFor(buyer.id, buyer.email, [{ productId: steam.id, variantId: steam.variants[0]!.id, meta: { steamLogin: "int_steam_user" } }]);
    const item = await m.prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.unitPrice).toBe(steam.variants[0]!.price);
    expect(item.meta).toEqual({ steamLogin: "int_steam_user" });
    expect((await m.initiate.startOrderPayment({ orderId: order.id, userId: buyer.id, choice: "BALANCE" })).ok).toBe(true);
    const after = await m.prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.status).toBe("DELIVERED"); // STEAM_TOPUP_PROVIDER=mock => mock supplier result, labelled sandbox
    expect(after.deliveryData).toMatchObject({ provider: "mock", sandbox: true, steamLogin: "int_steam_user" });

    // custom wallet amount without a variant: priced from the DB with the service fee, meta keeps the credited amount
    const { quoteSteamTopup } = await import("@asap/shared");
    const custom = await orderFor(buyer.id, buyer.email, [{ productId: steam.id, meta: { steamLogin: "int_custom_user", amountKopecks: 123_400 } }]);
    const customItem = await m.prisma.orderItem.findFirstOrThrow({ where: { orderId: custom.id } });
    const fee = Number((await m.prisma.setting.findUnique({ where: { key: "steam_topup_fee_percent" } }))?.value ?? 5);
    expect(customItem.unitPrice).toBe(quoteSteamTopup(123_400, fee).total);
    expect(customItem.variantId).toBeNull();
    expect(customItem.meta).toEqual({ steamLogin: "int_custom_user", amountKopecks: 123_400 });
    expect((await m.initiate.startOrderPayment({ orderId: custom.id, userId: buyer.id, choice: "BALANCE" })).ok).toBe(true);
    expect((await m.prisma.orderItem.findUniqueOrThrow({ where: { id: customItem.id } })).deliveryData).toMatchObject({ provider: "mock", amountRub: 1234, steamLogin: "int_custom_user" });
    // tampered amounts are rejected at add time
    await m.prisma.cartItem.deleteMany({ where: { cart: { userId: buyer.id } } });
    expect((await m.cart.addItem({ userId: buyer.id }, { productId: steam.id, quantity: 1, meta: { steamLogin: "int_custom_user", amountKopecks: 5 } })).ok).toBe(false);

    const manual = await m.prisma.product.findFirstOrThrow({ where: { deliveryMode: "MANUAL", status: "ACTIVE" }, include: { variants: { where: { isActive: true } } } });
    const mo = await orderFor(buyer.id, buyer.email, [{ productId: manual.id, variantId: manual.variants[0]?.id ?? null, meta: { buyerInput: "UID 123456789" } }]);
    expect((await m.initiate.startOrderPayment({ orderId: mo.id, userId: buyer.id, choice: "BALANCE" })).ok).toBe(true);
    const mOrder = await m.prisma.order.findUniqueOrThrow({ where: { id: mo.id }, include: { items: true } });
    expect(mOrder.status).toBe("PROCESSING");
    expect(mOrder.items[0]!.status).toBe("PROCESSING");
    expect(mOrder.items[0]!.meta).toEqual({ buyerInput: "UID 123456789" });
    await expectLedgerHealthy();
  }, 40_000);

  it("admin refund returns money to the buyer balance, books the ledger and is idempotent", async () => {
    const buyer = await newUser(1_000_000);
    const admin = await m.prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const p = await keyProduct();
    const order = await orderFor(buyer.id, buyer.email, [{ productId: p.id, quantity: 2 }]);
    expect((await m.initiate.startOrderPayment({ orderId: order.id, userId: buyer.id, choice: "BALANCE" })).ok).toBe(true);
    const holdBefore = (await m.prisma.sellerProfile.findUniqueOrThrow({ where: { userId: p.sellerId } })).holdBalance;
    const feeBefore = await m.ledger.getBalance("PLATFORM_FEE");
    expect((await m.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance).toBe(1_000_000 - order.total);

    // non-admins are rejected even if the caller forgot to check
    expect((await m.orders.refundOrder(order.id, { actor: { id: buyer.id } })).ok).toBe(false);

    const r = await m.orders.refundOrder(order.id, { actor: { id: admin.id }, reason: "test" });
    expect(r).toMatchObject({ ok: true, amount: order.total, orderStatus: "REFUNDED" });
    expect((await m.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance).toBe(1_000_000);
    const item = await m.prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect((await m.prisma.sellerProfile.findUniqueOrThrow({ where: { userId: p.sellerId } })).holdBalance).toBe(holdBefore - item.sellerEarning);
    expect(await m.ledger.getBalance("PLATFORM_FEE")).toBe(feeBefore - item.commissionAmount);
    expect((await m.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("REFUNDED");
    expect((await m.prisma.auditLog.findFirst({ where: { action: "order.refund", entityId: order.id } }))?.actorId).toBe(admin.id);

    expect((await m.orders.refundOrder(order.id, { actor: { id: admin.id } })).ok).toBe(false);
    expect((await m.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance).toBe(1_000_000);
    await expectLedgerHealthy();
  }, 40_000);

  it("expiry: stale PENDING orders are cancelled and stock/expired reservations are released", async () => {
    const buyer = await newUser();
    const p = await keyProduct();
    const order = await orderFor(buyer.id, buyer.email, [{ productId: p.id }]);
    await m.prisma.order.update({ where: { id: order.id }, data: { createdAt: new Date(Date.now() - 31 * 60_000) } });
    const cancelled = await m.orders.expirePendingOrders();
    expect(cancelled).toBeGreaterThanOrEqual(1);
    expect((await m.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
    expect(await m.prisma.stockItem.count({ where: { orderItem: { orderId: order.id } } })).toBe(0);

    // an orphaned expired reservation is freed by the cron helper; a paid reservation (reservedUntil NULL) never is
    const stray = await m.prisma.stockItem.findFirstOrThrow({ where: { productId: p.id, status: "AVAILABLE" } });
    await m.prisma.stockItem.update({ where: { id: stray.id }, data: { status: "RESERVED", reservedUntil: new Date(Date.now() - 60_000) } });
    expect(await m.orders.releaseExpiredReservations()).toBeGreaterThanOrEqual(1);
    expect((await m.prisma.stockItem.findUniqueOrThrow({ where: { id: stray.id } })).status).toBe("AVAILABLE");
  }, 30_000);

  it("a paid order whose reservation expired is re-reserved, otherwise the money goes to the balance", async () => {
    const buyer = await newUser();
    const p = await keyProduct("Cyberpunk 2077");
    const order = await orderFor(buyer.id, buyer.email, [{ productId: p.id }]);
    const start = await m.initiate.startOrderPayment({ orderId: order.id, userId: buyer.id, choice: "SANDBOX" });
    if (!start.ok) throw new Error(start.error);
    const pay = await m.prisma.payment.findUniqueOrThrow({ where: { id: start.paymentId } });
    // simulate the cron having freed the reservation while the buyer was paying
    await m.prisma.stockItem.updateMany({ where: { orderItem: { orderId: order.id } }, data: { status: "AVAILABLE", reservedUntil: null, orderItemId: null } });
    const ev = signed(pay.externalId!, "PAID", order.total);
    expect((await m.webhook.handleWebhook("SANDBOX", ev.body, ev.headers)).status).toBe(200);
    expect((await m.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("DELIVERED"); // stock was still there -> re-reserved
    await expectLedgerHealthy();
  }, 30_000);

  it("cart: guest merge, stock-aware quantities, ownership", async () => {
    const user = await newUser();
    const other = await newUser();
    const p = await keyProduct();
    const token = m.cart.newGuestToken();
    const g1 = await m.cart.addItem({ guestToken: token }, { productId: p.id, quantity: 2 });
    expect(g1).toMatchObject({ ok: true });
    await m.cart.addItem({ userId: user.id }, { productId: p.id, quantity: 1 });
    expect(await m.cart.mergeGuestCart(user.id, token)).toBe(1);
    const view = await m.cart.getCartView({ userId: user.id });
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]!.quantity).toBe(3);
    expect((await m.cart.getCartView({ guestToken: token })).lines).toHaveLength(0);
    expect(await m.cart.mergeGuestCart(user.id, token)).toBe(0); // idempotent

    const lineId = view.lines[0]!.id;
    expect((await m.cart.setQuantity({ userId: other.id }, lineId, 5)).ok).toBe(false); // not theirs
    expect((await m.cart.removeItem({ userId: other.id }, lineId)).ok).toBe(false);
    expect((await m.cart.setQuantity({ userId: user.id }, lineId, 999)).ok).toBe(false);
    const avail = await stockCount(p.id, "AVAILABLE");
    expect((await m.cart.setQuantity({ userId: user.id }, lineId, avail + 1)).ok).toBe(false);
    expect((await m.cart.setQuantity({ userId: user.id }, lineId, 0)).ok).toBe(true);
    expect((await m.cart.getCartView({ userId: user.id })).lines).toHaveLength(0);

    // sellers cannot buy their own products
    expect((await m.cart.addItem({ userId: p.sellerId }, { productId: p.id, quantity: 1 })).ok).toBe(false);
    // inactive products cannot be added
    const draft = await m.prisma.product.findFirstOrThrow({ where: { status: { not: "ACTIVE" } } });
    expect((await m.cart.addItem({ userId: user.id }, { productId: draft.id, quantity: 1 })).ok).toBe(false);
  }, 30_000);

  it("promo validation: expired/inactive/min order/per-user limit", async () => {
    const buyer = await newUser();
    const check = (code: string, subtotal: number) => m.orders.validatePromo(code, buyer.id, subtotal, 1);
    expect((await check("NOPE", 100_000)).ok).toBe(false);
    expect((await check("EXPIRED20", 100_000)).ok).toBe(false);
    expect((await check("SUMMER500", 100_000)).error).toMatch(/от/);
    const ok = await check("welcome10", 100_000);
    expect(ok).toMatchObject({ ok: true, discount: 10_000 });
    const sum = await check("SUMMER500", 400_000);
    expect(sum).toMatchObject({ ok: true, discount: 50_000 });
    // per-user limit: after a (pending) order with the code the same user cannot reuse it
    const p = await keyProduct("Windows 11 Pro — ключ активации");
    await orderFor(buyer.id, buyer.email, [{ productId: p.id }], "WELCOME10");
    expect((await check("WELCOME10", 100_000)).ok).toBe(false);
  }, 30_000);

  it("final ledger audit after the whole suite", async () => {
    await expectLedgerHealthy();
  });
});
