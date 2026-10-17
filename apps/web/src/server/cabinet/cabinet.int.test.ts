/**
 * Integration tests for the cabinet services (zone C) against a REAL seeded PostgreSQL + Redis.
 * Skipped unless INTEGRATION_DATABASE_URL is set (it MUTATES data): run `bash scripts/test-int-cabinet.sh`
 * (creates + reseeds the throw-away `asapawge_test` DB). The worker is intentionally unreachable.
 */
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

const URL = process.env.INTEGRATION_DATABASE_URL;
const d = describe.skipIf(!URL);

type Prisma = typeof import("@asap/db").prisma;
let prisma: Prisma;
let svc: {
  apiKeys: typeof import("./api-keys");
  stock: typeof import("./stock");
  sellerOrders: typeof import("./seller-orders");
  reviews: typeof import("./reviews");
  disputes: typeof import("./disputes");
  payouts: typeof import("./payouts");
  products: typeof import("./products");
  account: typeof import("./account");
  stats: typeof import("./seller-stats");
  ledger: typeof import("@/server/ledger");
  password: typeof import("@/server/auth/password");
  shared: typeof import("@asap/shared");
};

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${seq++}`;

async function mkUser(role: "USER" | "SELLER" | "ADMIN" = "USER") {
  return prisma.user.create({ data: { email: `c-${uniq()}@test.local`, name: "Cab Test", role }, select: { id: true, email: true, role: true } });
}
async function mkSeller(status: "VERIFIED" | "PENDING" = "VERIFIED") {
  const u = await mkUser("SELLER");
  const profile = await prisma.sellerProfile.create({ data: { userId: u.id, shopName: `Shop ${uniq()}`, slug: `shop-${uniq()}`, status } });
  return { user: { id: u.id, email: u.email, name: "Cab Test", image: null, role: "SELLER" as const, balance: 0 }, profile: profile as never, canWrite: true, verified: status === "VERIFIED" };
}
let categoryId = "";
async function mkProduct(sellerId: string, deliveryMode: "AUTO_STOCK" | "MANUAL" = "AUTO_STOCK", status: "ACTIVE" | "DRAFT" = "ACTIVE") {
  return prisma.product.create({
    data: { sellerId, categoryId, title: `Prod ${uniq()}`, slug: `prod-${uniq()}`, description: "d".repeat(40), type: "KEY", deliveryMode, status, price: 10_000 },
    select: { id: true },
  });
}
/** A PAID order with one item of `productId` (status PAID, item PENDING) */
async function mkOrder(buyerId: string, sellerId: string, productId: string, status: "PAID" | "DELIVERED" = "PAID") {
  return prisma.order.create({
    data: {
      number: `AG-T-${uniq()}`.slice(0, 20), buyerId, email: "b@test.local", status, subtotal: 10_000, total: 10_000, paidAt: new Date(), deliveredAt: status === "DELIVERED" ? new Date() : null,
      items: { create: { productId, sellerId, title: "Item", unitPrice: 10_000, quantity: 1, total: 10_000, commissionBps: 1000, commissionAmount: 1000, sellerEarning: 9000, status: status === "DELIVERED" ? "DELIVERED" : "PENDING", deliveredAt: status === "DELIVERED" ? new Date() : null } },
    },
    select: { id: true, items: { select: { id: true } } },
  });
}

beforeAll(async () => {
  if (!URL) return;
  process.env.DATABASE_URL = URL;
  process.env.STOCK_ENCRYPTION_KEY ??= "ZGV2LW9ubHktc3RvY2sta2V5LTMyLWJ5dGVzLWxvbiE=";
  process.env.WORKER_URL = "http://127.0.0.1:9";
  ({ prisma } = await import("@asap/db"));
  svc = {
    apiKeys: await import("./api-keys"),
    stock: await import("./stock"),
    sellerOrders: await import("./seller-orders"),
    reviews: await import("./reviews"),
    disputes: await import("./disputes"),
    payouts: await import("./payouts"),
    products: await import("./products"),
    account: await import("./account"),
    stats: await import("./seller-stats"),
    ledger: await import("@/server/ledger"),
    password: await import("@/server/auth/password"),
    shared: await import("@asap/shared"),
  };
  const cat = await prisma.category.findFirstOrThrow({ where: { isActive: true, children: { none: {} } }, select: { id: true } });
  categoryId = cat.id;
});

d("API keys", () => {
  it("shows the key once, stores only its hash, enforces role scopes and ownership", async () => {
    const u = await mkUser("USER");
    const other = await mkUser("USER");
    const bad = await svc.apiKeys.createApiKey(u, { name: "x-key", scopes: ["seller:products"] });
    expect(bad.ok).toBe(false);
    const res = await svc.apiKeys.createApiKey(u, { name: "my bot", scopes: ["catalog:read", "orders:read"], expiresInDays: 30 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(svc.shared.isApiKeyFormat(res.data.key)).toBe(true);
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(row.hash).toBe(createHash("sha256").update(res.data.key).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(res.data.key);
    expect(row.role).toBe("USER");
    expect(row.expiresAt).not.toBeNull();
    const list = await svc.apiKeys.listApiKeys(u.id);
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(row.hash);
    expect((await svc.apiKeys.revokeApiKey(other, res.data.id)).ok).toBe(false); // not the owner
    expect((await svc.apiKeys.revokeApiKey(u, res.data.id)).ok).toBe(true);
    expect((await svc.apiKeys.revokeApiKey(u, res.data.id)).ok).toBe(false); // already revoked
    expect((await svc.apiKeys.listApiKeys(u.id))[0]!.state).toBe("revoked");
  });
});

d("Stock", () => {
  it("encrypts, dedupes, scopes to the owner and only deletes unsold keys", async () => {
    const s = await mkSeller();
    const intruder = await mkSeller();
    const p = await mkProduct(s.user.id);
    const up = await svc.stock.uploadStock(s, { productId: p.id, items: ["KEY-AAA", "KEY-AAA", "KEY-BBB", "   ", "x".repeat(5000)] });
    expect(up.ok && up.data).toMatchObject({ added: 2, duplicatesInBatch: 1, rejected: 2 });
    const again = await svc.stock.uploadStock(s, { productId: p.id, items: ["KEY-AAA", "KEY-CCC"] });
    expect(again.ok && again.data).toMatchObject({ added: 1 });
    const rows = await prisma.stockItem.findMany({ where: { productId: p.id }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !r.payloadEnc.includes("KEY-"))).toBe(true);
    expect(rows.map((r) => svc.shared.decryptStock(r.payloadEnc)).sort()).toEqual(["KEY-AAA", "KEY-BBB", "KEY-CCC"]);
    expect((await svc.stock.uploadStock(intruder, { productId: p.id, items: ["EVIL"] })).ok).toBe(false);
    expect((await svc.stock.deleteUnsoldStock(intruder, { productId: p.id, all: true })).ok).toBe(false);
    // sold + reserved keys survive "delete all"
    await prisma.stockItem.update({ where: { id: rows[0]!.id }, data: { status: "SOLD", soldAt: new Date() } });
    await prisma.stockItem.update({ where: { id: rows[1]!.id }, data: { status: "RESERVED", reservedUntil: new Date(Date.now() + 60_000) } });
    const del = await svc.stock.deleteUnsoldStock(s, { productId: p.id, all: true });
    expect(del.ok && del.data.deleted).toBe(1);
    expect(await prisma.stockItem.count({ where: { productId: p.id } })).toBe(2);
    const overview = await svc.stock.getStockOverview(p.id, []);
    expect(overview.total).toEqual({ AVAILABLE: 0, RESERVED: 1, SOLD: 1 });
    expect(svc.stock.maskSecret("ABCD-EFGH-IJKL")).toBe("ABCD••••••JKL");
  });

  it("requires a variant for products with variants", async () => {
    const s = await mkSeller();
    const p = await mkProduct(s.user.id);
    const v = await prisma.productVariant.create({ data: { productId: p.id, title: "1 month", price: 5000 } });
    expect((await svc.stock.uploadStock(s, { productId: p.id, items: ["V-1"] })).ok).toBe(false);
    const ok = await svc.stock.uploadStock(s, { productId: p.id, variantId: v.id, items: ["V-1"] });
    expect(ok.ok).toBe(true);
    expect((await prisma.stockItem.findFirstOrThrow({ where: { productId: p.id } })).variantId).toBe(v.id);
  });
});

d("Manual delivery, reviews, disputes", () => {
  it("delivers a MANUAL item only for its seller, advances the order and notifies the buyer", async () => {
    const s = await mkSeller();
    const other = await mkSeller();
    const buyer = await mkUser();
    const p = await mkProduct(s.user.id, "MANUAL");
    const o = await mkOrder(buyer.id, s.user.id, p.id);
    const itemId = o.items[0]!.id;
    expect((await svc.sellerOrders.deliverManualItem(other, { orderItemId: itemId, message: "hack" })).ok).toBe(false);
    expect((await svc.sellerOrders.deliverManualItem(s, { orderItemId: itemId, message: "" })).ok).toBe(false);
    const res = await svc.sellerOrders.deliverManualItem(s, { orderItemId: itemId, message: "login:pass" });
    expect(res.ok && res.data.orderStatus).toBe("DELIVERED");
    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("DELIVERED");
    expect(item.holdReleaseAt).not.toBeNull();
    expect((item.deliveryData as { message: string }).message).toBe("login:pass");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("DELIVERED");
    expect(await prisma.notification.count({ where: { userId: buyer.id, type: "ORDER_DELIVERED" } })).toBe(1);
    expect((await svc.sellerOrders.deliverManualItem(s, { orderItemId: itemId, message: "again" })).ok).toBe(false); // already delivered
    // AUTO products cannot be hand-delivered
    const auto = await mkProduct(s.user.id, "AUTO_STOCK");
    const o2 = await mkOrder(buyer.id, s.user.id, auto.id);
    expect((await svc.sellerOrders.deliverManualItem(s, { orderItemId: o2.items[0]!.id, message: "x" })).ok).toBe(false);
  });

  it("allows one review per delivered item, only for the buyer, and updates ratings", async () => {
    const s = await mkSeller();
    const buyer = await mkUser();
    const stranger = await mkUser();
    const p = await mkProduct(s.user.id);
    const pending = await mkOrder(buyer.id, s.user.id, p.id, "PAID");
    expect((await svc.reviews.createReview(buyer.id, { orderItemId: pending.items[0]!.id, rating: 5 })).ok).toBe(false); // not delivered yet
    const o = await mkOrder(buyer.id, s.user.id, p.id, "DELIVERED");
    const itemId = o.items[0]!.id;
    expect((await svc.reviews.createReview(stranger.id, { orderItemId: itemId, rating: 5 })).ok).toBe(false);
    expect((await svc.reviews.createReview(buyer.id, { orderItemId: itemId, rating: 9 })).ok).toBe(false);
    expect((await svc.reviews.createReview(buyer.id, { orderItemId: itemId, rating: 4, text: "ok" })).ok).toBe(true);
    expect((await svc.reviews.createReview(buyer.id, { orderItemId: itemId, rating: 5 })).ok).toBe(false);
    const prod = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(prod.ratingAvg).toBe(4);
    expect(prod.ratingCount).toBe(1);
    expect((await prisma.sellerProfile.findUniqueOrThrow({ where: { userId: s.user.id } })).rating).toBe(4);
  });

  it("runs the dispute lifecycle with access control", async () => {
    const s = await mkSeller();
    const buyer = await mkUser();
    const stranger = await mkUser();
    const admin = await mkUser("ADMIN");
    const p = await mkProduct(s.user.id);
    const o = await mkOrder(buyer.id, s.user.id, p.id, "DELIVERED");
    const itemId = o.items[0]!.id;
    expect((await svc.disputes.openDispute(stranger, { orderItemId: itemId, reason: "not mine at all" })).ok).toBe(false);
    expect((await svc.disputes.openDispute(buyer, { orderItemId: itemId, reason: "short" })).ok).toBe(false);
    const opened = await svc.disputes.openDispute(buyer, { orderItemId: itemId, reason: "The key does not activate" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const id = opened.data.disputeId;
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("DISPUTED");
    expect((await svc.disputes.openDispute(buyer, { orderItemId: itemId, reason: "once more please" })).ok).toBe(false);
    // access
    expect(await svc.disputes.getDisputeView(stranger, id)).toBeNull();
    expect(await svc.disputes.listDisputeMessages(stranger, id)).toBeNull();
    expect((await svc.disputes.postDisputeMessage(stranger, { disputeId: id, body: "hi" })).ok).toBe(false);
    expect((await svc.disputes.getDisputeView({ id: s.user.id, role: "SELLER" }, id))?.viewerRole).toBe("SELLER");
    // chat
    const sellerMsg = await svc.disputes.postDisputeMessage({ id: s.user.id, role: "SELLER" }, { disputeId: id, body: "Please try again" });
    expect(sellerMsg.ok).toBe(true);
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id } })).status).toBe("SELLER_REPLIED");
    await svc.disputes.postDisputeMessage({ id: buyer.id, role: "USER" }, { disputeId: id, body: "Still broken" });
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id } })).status).toBe("OPEN");
    const all = await svc.disputes.listDisputeMessages({ id: buyer.id, role: "USER" }, id);
    expect(all?.messages.map((m) => m.authorRole)).toEqual(["USER", "SYSTEM", "SELLER", "USER"]);
    const after = await svc.disputes.listDisputeMessages({ id: buyer.id, role: "USER" }, id, all!.messages[2]!.createdAt);
    expect(after!.messages.length).toBeGreaterThanOrEqual(2);
    expect(after!.messages.at(-1)!.body).toBe("Still broken");
    // escalate + admin joins
    expect((await svc.disputes.escalateDispute({ id: buyer.id, role: "USER" }, id)).ok).toBe(true);
    expect((await prisma.dispute.findUniqueOrThrow({ where: { id } })).status).toBe("ESCALATED");
    expect((await svc.disputes.postDisputeMessage({ id: admin.id, role: "ADMIN" }, { disputeId: id, body: "Admin here" })).ok).toBe(true);
    // buyer closes -> order returns to DELIVERED, chat is locked
    expect((await svc.disputes.closeDisputeByBuyer({ id: stranger.id }, id)).ok).toBe(false);
    expect((await svc.disputes.closeDisputeByBuyer({ id: buyer.id }, id)).ok).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("DELIVERED");
    expect((await svc.disputes.postDisputeMessage({ id: buyer.id, role: "USER" }, { disputeId: id, body: "late" })).ok).toBe(false);
  });

  it("refuses disputes after the 14-day window", async () => {
    const s = await mkSeller();
    const buyer = await mkUser();
    const p = await mkProduct(s.user.id);
    const o = await mkOrder(buyer.id, s.user.id, p.id, "DELIVERED");
    await prisma.orderItem.update({ where: { id: o.items[0]!.id }, data: { deliveredAt: new Date(Date.now() - 20 * 86_400_000) } });
    expect((await svc.disputes.openDispute(buyer, { orderItemId: o.items[0]!.id, reason: "too late to complain" })).ok).toBe(false);
  });
});

d("Payouts", () => {
  async function fund(sellerId: string, amount: number) {
    await prisma.$transaction((tx) =>
      svc.ledger.postLedger(tx, {
        kind: "ADJUSTMENT",
        memo: "int test funds",
        lines: [
          { account: "EXTERNAL", direction: "DEBIT", amount },
          { account: "SELLER_AVAILABLE", ownerId: sellerId, direction: "CREDIT", amount },
        ],
      }),
    );
  }
  const details = { card: "4111 1111 1111 1111" };

  it("posts the ledger atomically, guards overdraw, validates details and supports cancel", async () => {
    const s = await mkSeller();
    const other = await mkSeller();
    await fund(s.user.id, 500_000);
    expect((await svc.payouts.requestPayout(s, { amount: 50_000, method: "CARD", details })).ok).toBe(false); // below minimum
    expect((await svc.payouts.requestPayout(s, { amount: 200_000, method: "CARD", details: { card: "4111 1111 1111 1112" } })).ok).toBe(false); // bad Luhn
    expect((await svc.payouts.requestPayout(s, { amount: 900_000, method: "CARD", details })).ok).toBe(false); // more than available
    expect((await prisma.sellerProfile.findUniqueOrThrow({ where: { userId: s.user.id } })).availableBalance).toBe(500_000);
    const res = await svc.payouts.requestPayout(s, { amount: 200_000, method: "CARD", details });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((await prisma.sellerProfile.findUniqueOrThrow({ where: { userId: s.user.id } })).availableBalance).toBe(300_000);
    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: res.data.payoutId } });
    expect(payout).toMatchObject({ status: "REQUESTED", amount: 200_000, method: "CARD" });
    expect(svc.payouts.maskPayoutDetails("CARD", payout.details)).toBe("•••• 1111");
    expect(await prisma.ledgerEntry.count({ where: { payoutId: payout.id, kind: "PAYOUT" } })).toBe(2);
    // cancel: only the owner, once
    expect((await svc.payouts.cancelPayout(other, payout.id)).ok).toBe(false);
    expect((await svc.payouts.cancelPayout(s, payout.id)).ok).toBe(true);
    expect((await svc.payouts.cancelPayout(s, payout.id)).ok).toBe(false);
    expect((await prisma.sellerProfile.findUniqueOrThrow({ where: { userId: s.user.id } })).availableBalance).toBe(500_000);
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe("CANCELLED");
    const integrity = await svc.ledger.verifyLedgerIntegrity();
    expect(JSON.stringify(integrity)).not.toContain(s.user.id);
  });

  it("does not let concurrent requests overdraw the balance", async () => {
    const s = await mkSeller();
    await fund(s.user.id, 300_000);
    const results = await Promise.all([1, 2, 3].map(() => svc.payouts.requestPayout(s, { amount: 200_000, method: "YOOMONEY", details: { wallet: "41001234567890" } })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await prisma.sellerProfile.findUniqueOrThrow({ where: { userId: s.user.id } })).availableBalance).toBe(100_000);
  });
});

d("Products", () => {
  const base = {
    title: "Test Game Key",
    type: "KEY" as const,
    deliveryMode: "AUTO_STOCK" as const,
    description: "A long enough description for the moderation rules to pass.",
    price: 99_900,
    intent: "draft" as const,
  };
  it("creates drafts, submits for moderation, validates images/types and enforces ownership", async () => {
    const s = await mkSeller();
    const intruder = await mkSeller();
    const input = { ...base, categoryId };
    expect((await svc.products.saveProduct(s, null, { ...input, images: ["https://evil.example.com/a.png"] })).ok).toBe(false);
    expect((await svc.products.saveProduct(s, null, { ...input, type: "TOPUP", platform: "STEAM" })).ok).toBe(false);
    expect((await svc.products.saveProduct(s, null, { ...input, categoryId: "nope" })).ok).toBe(false);
    const draft = await svc.products.saveProduct(s, null, { ...input, images: ["https://picsum.photos/seed/a/600/800"], instructions: "1. Open Steam\n2. Activate", tags: ["steam", "steam"] });
    expect(draft.ok && draft.data.status).toBe("DRAFT");
    if (!draft.ok) return;
    const id = draft.data.id;
    let row = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(row.coverImage).toBe("https://picsum.photos/seed/a/600/800");
    expect(row.tags).toEqual(["steam"]);
    expect((row.attributes as { activation: string[] }).activation).toEqual(["Open Steam", "Activate"]);
    expect(row.sellerId).toBe(s.user.id);
    // another seller cannot edit it
    expect((await svc.products.saveProduct(intruder, id, { ...input, title: "Hijack!" })).ok).toBe(false);
    expect((await svc.products.archiveProduct(intruder, id)).ok).toBe(false);
    expect((await svc.products.deleteProduct(intruder, id)).ok).toBe(false);
    // submit -> PENDING_REVIEW (worker down => not queued)
    const sub = await svc.products.saveProduct(s, id, { ...input, intent: "submit" });
    expect(sub.ok && sub.data).toMatchObject({ status: "PENDING_REVIEW", queued: false });
    // unverified sellers cannot submit
    const pend = await mkSeller("PENDING");
    expect((await svc.products.saveProduct(pend, null, { ...input, intent: "submit" })).ok).toBe(false);
    expect((await svc.products.saveProduct(pend, null, { ...input, intent: "draft" })).ok).toBe(true);
    // ACTIVE: price-only edit stays ACTIVE, content edit goes back to review
    await prisma.product.update({ where: { id }, data: { status: "ACTIVE", title: input.title, description: input.description, images: ["https://picsum.photos/seed/a/600/800"], attributes: { activation: ["Open Steam", "Activate"] }, tags: ["steam"] } });
    const price = await svc.products.saveProduct(s, id, { ...input, images: ["https://picsum.photos/seed/a/600/800"], instructions: "Open Steam\nActivate", price: 88_800 });
    expect(price.ok && price.data.status).toBe("ACTIVE");
    row = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(row.price).toBe(88_800);
    const content = await svc.products.saveProduct(s, id, { ...input, images: ["https://picsum.photos/seed/a/600/800"], instructions: "Open Steam\nActivate", title: "Renamed Game Key" });
    expect(content.ok && content.data.status).toBe("PENDING_REVIEW");
  });

  it("keeps Product.price = min active variant price and soft-deletes variants with history", async () => {
    const s = await mkSeller();
    const input = { ...base, categoryId, price: 100 };
    const made = await svc.products.saveProduct(s, null, { ...input, variants: [{ title: "3 мес", price: 30_000, oldPrice: 40_000 }, { title: "1 мес", price: 12_000 }, { title: "off", price: 1_000, isActive: false }] });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    let p = await prisma.product.findUniqueOrThrow({ where: { id: made.data.id }, include: { variants: { orderBy: { sortOrder: "asc" } } } });
    expect(p.price).toBe(12_000);
    expect(p.variants).toHaveLength(3);
    expect(p.oldPrice).toBeNull(); // cheapest variant has no old price
    // remove "1 мес" (has a sold order => deactivated), remove "off" (clean => deleted)
    const keep = p.variants.find((v) => v.title === "3 мес")!;
    const sold = p.variants.find((v) => v.title === "1 мес")!;
    const buyer = await mkUser();
    const o = await mkOrder(buyer.id, s.user.id, p.id);
    await prisma.orderItem.update({ where: { id: o.items[0]!.id }, data: { variantId: sold.id } });
    const upd = await svc.products.saveProduct(s, p.id, { ...input, variants: [{ id: keep.id, title: "3 мес", price: 30_000, oldPrice: 40_000 }] });
    expect(upd.ok).toBe(true);
    p = await prisma.product.findUniqueOrThrow({ where: { id: p.id }, include: { variants: true } });
    expect(p.price).toBe(30_000);
    expect(p.oldPrice).toBe(40_000);
    expect(p.variants.map((v) => [v.title, v.isActive]).sort()).toEqual([["1 мес", false], ["3 мес", true]]);
    // product with orders cannot be deleted
    expect((await svc.products.deleteProduct(s, p.id)).ok).toBe(false);
    expect((await svc.products.archiveProduct(s, p.id)).ok).toBe(true);
    expect((await svc.products.restoreProduct(s, p.id)).ok).toBe(true);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("DRAFT");
  });
});

d("Account", () => {
  it("handles seller applications and password changes", async () => {
    const u = await mkUser("USER");
    const hash = await svc.password.hashPassword("OldPass123");
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: hash } });
    const me = { id: u.id, role: "USER" as const, email: u.email };
    expect((await svc.account.applyForSeller(me, { shopName: "ab", description: "short" })).ok).toBe(false);
    expect((await svc.account.applyForSeller(me, { shopName: "Mega Keys", description: "We sell licensed game keys bought directly from publishers." })).ok).toBe(true);
    const prof = await prisma.sellerProfile.findUniqueOrThrow({ where: { userId: u.id } });
    expect(prof.status).toBe("PENDING");
    expect((await svc.account.applyForSeller(me, { shopName: "Mega Keys", description: "We sell licensed game keys bought directly from publishers." })).ok).toBe(false);
    expect((await svc.account.applyForSeller({ ...me, role: "SELLER" }, { shopName: "Mega Keys 2", description: "We sell licensed game keys bought directly from publishers." })).ok).toBe(false);

    expect((await svc.account.changePassword(me, { current: "wrong", next: "NewPass123", confirm: "NewPass123" })).ok).toBe(false);
    expect((await svc.account.changePassword(me, { current: "OldPass123", next: "NewPass123", confirm: "Mismatch1" })).ok).toBe(false);
    expect((await svc.account.changePassword(me, { current: "OldPass123", next: "short", confirm: "short" })).ok).toBe(false);
    expect((await svc.account.changePassword(me, { current: "OldPass123", next: "NewPass123", confirm: "NewPass123" })).ok).toBe(true);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await svc.password.verifyPassword(fresh.passwordHash!, "NewPass123")).toBe(true);
    expect(await svc.password.verifyPassword(fresh.passwordHash!, "OldPass123")).toBe(false);
  });
});

d("Seller stats", () => {
  it("builds a 30-day sales report that matches the database", async () => {
    const seller = await prisma.user.findFirstOrThrow({ where: { email: "seller@asapawge.gg" }, select: { id: true } });
    const report = await svc.stats.getSalesReport(seller.id, 30);
    expect(report.series).toHaveLength(30);
    expect(report.totals.revenue).toBe(report.series.reduce((a, p) => a + p.revenue, 0));
    const from = new Date(Date.parse(`${report.series[0]!.date}T00:00:00+03:00`));
    const agg = await prisma.orderItem.aggregate({
      where: { sellerId: seller.id, status: { not: "REFUNDED" }, order: { paidAt: { gte: from }, status: { in: ["PAID", "PROCESSING", "DELIVERED", "DISPUTED"] } } },
      _sum: { total: true, sellerEarning: true },
    });
    expect(report.totals.revenue).toBe(agg._sum.total ?? 0);
    expect(report.totals.earning).toBe(agg._sum.sellerEarning ?? 0);
    expect(report.last7.revenue).toBeLessThanOrEqual(report.totals.revenue);
    const att = await svc.stats.getSellerAttention(seller.id);
    expect(att.lowStock.every((p) => p.available < 5)).toBe(true);
  });
});
