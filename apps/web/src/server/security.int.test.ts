/**
 * Adversarial-review regression tests against a REAL PostgreSQL (see commerce.int.test.ts for how to run: `bash scripts/test-int.sh`).
 * Covers races and abuse paths found during the security review: promo over-use, double refund, stock hoarding,
 * suspended sellers, DB-level ledger guards, forged client analytics.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL = process.env.INTEGRATION_DATABASE_URL;
const d = describe.skipIf(!URL);

type Mods = {
  prisma: typeof import("@asap/db").prisma;
  cart: typeof import("./cart/service");
  orders: typeof import("./orders");
  initiate: typeof import("./payments/initiate");
  ledger: typeof import("./ledger");
  ingest: typeof import("./analytics/ingest");
  redis: typeof import("@/lib/redis");
};
let m: Mods;
let seq = 0;

async function setup(): Promise<Mods> {
  process.env.DATABASE_URL = URL!;
  process.env.STOCK_ENCRYPTION_KEY ??= "ZGV2LW9ubHktc3RvY2sta2V5LTMyLWJ5dGVzLWxvbiE=";
  process.env.WORKER_URL = "http://127.0.0.1:9"; // unreachable -> inline fulfilment
  process.env.APP_URL = "http://localhost:3000";
  const { prisma } = await import("@asap/db");
  return {
    prisma,
    cart: await import("./cart/service"),
    orders: await import("./orders"),
    initiate: await import("./payments/initiate"),
    ledger: await import("./ledger"),
    ingest: await import("./analytics/ingest"),
    redis: await import("@/lib/redis"),
  };
}

async function newUser(balance = 0) {
  const email = `sec-${Date.now()}-${seq++}@test.local`;
  const u = await m.prisma.user.create({ data: { email, name: "Sec Test", role: "USER" }, select: { id: true, email: true } });
  if (balance > 0) {
    await m.prisma.$transaction(async (tx) => {
      await m.ledger.postLedger(tx, { kind: "TOPUP", lines: (await import("./ledger/accounts")).topupLines(u.id, balance), memo: "sec test funds" });
    });
  }
  return u;
}

/** An ACTIVE AUTO_STOCK product with plenty of stock, from a seller that is not suspended. */
async function keyProduct(skip = 0) {
  const rows = await m.prisma.stockItem.groupBy({
    by: ["productId"],
    where: { status: "AVAILABLE", variantId: null, product: { status: "ACTIVE", deliveryMode: "AUTO_STOCK", variants: { none: {} }, seller: { sellerProfile: { status: "VERIFIED" } } } },
    _count: { _all: true },
    orderBy: { _count: { productId: "desc" } },
    skip,
    take: 1,
  });
  return m.prisma.product.findUniqueOrThrow({ where: { id: rows[0]!.productId } });
}

async function cartOrder(user: { id: string; email: string }, productId: string, promoCode?: string, quantity = 1) {
  await m.prisma.cartItem.deleteMany({ where: { cart: { userId: user.id } } });
  const r = await m.cart.addItem({ userId: user.id }, { productId, quantity });
  if (!r.ok) throw new Error(r.error);
  return m.orders.createOrderFromCart({ userId: user.id, email: user.email, promoCode });
}

async function expectLedgerHealthy() {
  const r = await m.ledger.verifyLedgerIntegrity();
  expect(r.unbalancedTx).toEqual([]);
  expect(r.userBalanceMismatches).toEqual([]);
  expect(r.sellerMismatches).toEqual([]);
}

d("security regressions (real DB)", () => {
  beforeAll(async () => {
    m = await setup();
  }, 30_000);
  afterAll(async () => {
    await m?.prisma.$disconnect();
    await m?.redis.redis.quit().catch(() => {});
  });

  it("promo with maxUses=1: parallel checkouts cannot both get the discount", async () => {
    const code = `RACE${Date.now().toString(36).toUpperCase()}`;
    await m.prisma.promoCode.create({ data: { code, type: "PERCENT", value: 10, maxUses: 1, perUserLimit: 1 } });
    const p = await keyProduct();
    const users = await Promise.all([newUser(), newUser(), newUser()]);
    const settled = await Promise.allSettled(users.map((u) => cartOrder(u, p.id, code)));
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
    expect(rejected).toHaveLength(2);
    for (const r of rejected) expect((r.reason as { code?: string }).code).toBe("PROMO");
    expect(await m.prisma.order.count({ where: { promoCode: { code } } })).toBe(1);
  }, 40_000);

  it("same user, parallel checkouts with a per-user-limited promo: only one order gets it", async () => {
    const code = `ONCE${Date.now().toString(36).toUpperCase()}`;
    await m.prisma.promoCode.create({ data: { code, type: "FIXED", value: 10_000, perUserLimit: 1 } });
    const p = await keyProduct();
    const u = await newUser();
    await m.prisma.cartItem.deleteMany({ where: { cart: { userId: u.id } } });
    expect((await m.cart.addItem({ userId: u.id }, { productId: p.id, quantity: 1 })).ok).toBe(true);
    const settled = await Promise.allSettled([1, 2, 3].map(() => m.orders.createOrderFromCart({ userId: u.id, email: u.email, promoCode: code })));
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
  }, 40_000);

  it("concurrent admin refunds of one order pay the buyer exactly once", async () => {
    const buyer = await newUser(2_000_000);
    const admin = await m.prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const p = await keyProduct();
    const order = await cartOrder(buyer, p.id, undefined, 2);
    expect((await m.initiate.startOrderPayment({ orderId: order.id, userId: buyer.id, choice: "BALANCE" })).ok).toBe(true);
    expect((await m.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance).toBe(2_000_000 - order.total);
    const results = await Promise.all([1, 2, 3].map(() => m.orders.refundOrder(order.id, { actor: { id: admin.id }, reason: "race" })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await m.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).balance).toBe(2_000_000);
    const item = await m.prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(await m.prisma.ledgerEntry.count({ where: { orderItemId: item.id, kind: "REFUND", account: "USER_BALANCE" } })).toBe(1);
    await expectLedgerHealthy();
  }, 40_000);

  it("DB guard: a second REFUND / PURCHASE posting for the same order item is rejected by a unique index", async () => {
    const buyer = await newUser(1_000_000);
    const admin = await m.prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const p = await keyProduct();
    const order = await cartOrder(buyer, p.id);
    expect((await m.initiate.startOrderPayment({ orderId: order.id, userId: buyer.id, choice: "BALANCE" })).ok).toBe(true);
    const item = await m.prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    // second PURCHASE posting for the same item
    await expect(
      m.prisma.ledgerEntry.create({ data: { txId: `dup-${Date.now()}`, kind: "PURCHASE", account: "USER_BALANCE", ownerId: buyer.id, direction: "DEBIT", amount: 1, orderItemId: item.id, orderId: order.id } }),
    ).rejects.toThrow();
    expect((await m.orders.refundOrder(order.id, { actor: { id: admin.id } })).ok).toBe(true);
    await expect(
      m.prisma.ledgerEntry.create({ data: { txId: `dup2-${Date.now()}`, kind: "REFUND", account: "USER_BALANCE", ownerId: buyer.id, direction: "CREDIT", amount: 1, orderItemId: item.id, orderId: order.id } }),
    ).rejects.toThrow();
    // zero / negative money is refused by CHECK constraints
    await expect(m.prisma.payment.create({ data: { userId: buyer.id, provider: "SANDBOX", purpose: "BALANCE_TOPUP", status: "CREATED", amount: 0 } })).rejects.toThrow();
    await expectLedgerHealthy();
  }, 40_000);

  it("stock hoarding guard: a buyer cannot keep more than MAX_PENDING_ORDERS unpaid orders", async () => {
    const buyer = await newUser();
    const p = await keyProduct();
    for (let i = 0; i < m.orders.MAX_PENDING_ORDERS; i++) await cartOrder(buyer, p.id);
    await expect(cartOrder(buyer, p.id)).rejects.toBeInstanceOf(m.orders.CheckoutError);
  }, 60_000);

  it("products of a suspended / rejected seller cannot be bought", async () => {
    const p = await keyProduct(1);
    const buyer = await newUser();
    await m.prisma.cartItem.deleteMany({ where: { cart: { userId: buyer.id } } });
    expect((await m.cart.addItem({ userId: buyer.id }, { productId: p.id, quantity: 1 })).ok).toBe(true);
    await m.prisma.sellerProfile.update({ where: { userId: p.sellerId }, data: { status: "SUSPENDED" } });
    try {
      await expect(m.orders.createOrderFromCart({ userId: buyer.id, email: buyer.email })).rejects.toBeInstanceOf(m.orders.CheckoutError);
    } finally {
      await m.prisma.sellerProfile.update({ where: { userId: p.sellerId }, data: { status: "VERIFIED" } });
    }
  }, 30_000);

  it("client analytics cannot forge server facts or someone else's purchase", async () => {
    const buyer = await newUser(1_000_000);
    const other = await newUser();
    const p = await keyProduct();
    const order = await cartOrder(buyer, p.id);
    const ua = "Mozilla/5.0 (X11; Linux x86_64) Chrome/120";
    const body = (name: string, properties?: Record<string, unknown>) => ({ name, path: "/", properties }) as never;
    // server-owned events are refused outright
    expect((await m.ingest.ingestClientEvent({ body: body("sign_up"), sessionId: "sess-sec-0001", userId: buyer.id, userAgent: ua })).stored).toBe(false);
    expect((await m.ingest.ingestClientEvent({ body: body("topup_balance", { value: 1e6 }), sessionId: "sess-sec-0001", userId: buyer.id, userAgent: ua })).stored).toBe(false);
    // purchase for an UNPAID order, for an anonymous visitor, and for someone else's order is refused
    expect((await m.ingest.ingestClientEvent({ body: body("purchase", { orderId: order.id, value: 1 }), sessionId: "sess-sec-0001", userId: buyer.id, userAgent: ua })).stored).toBe(false);
    expect((await m.ingest.ingestClientEvent({ body: body("purchase", { orderId: order.id, value: 1 }), sessionId: "sess-sec-0002", userId: null, userAgent: ua })).stored).toBe(false);
    expect((await m.initiate.startOrderPayment({ orderId: order.id, userId: buyer.id, choice: "BALANCE" })).ok).toBe(true);
    expect((await m.ingest.ingestClientEvent({ body: body("purchase", { orderId: order.id, value: 1 }), sessionId: "sess-sec-0003", userId: other.id, userAgent: ua })).stored).toBe(false);
  }, 40_000);

  it("ledger is still healthy after the adversarial suite", async () => {
    await expectLedgerHealthy();
  });
});
