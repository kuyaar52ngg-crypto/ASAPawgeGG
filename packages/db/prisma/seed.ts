/**
 * Database seed (Russian demo data). Idempotent: wipes ALL tables first.
 * Run: pnpm db:seed
 *
 * Demo accounts:
 *   admin@asapawge.gg  / Admin123!   (ADMIN)
 *   seller@asapawge.gg / Seller123!  (SELLER, "Digital Hub")
 *   gamekeys@asapawge.gg / Seller123! (SELLER, "GameKeys Store")
 *   subzone@asapawge.gg / Seller123!  (SELLER, "SubZone")
 *   user@asapawge.gg   / User123!    (USER, balance 5000 RUB)
 */
import { randomUUID } from "node:crypto";
import "./load-env";
import { hash } from "@node-rs/argon2";

import { prisma } from "../src/client";
import type { Prisma } from "../src/generated/client";
import {
  DEFAULT_COMMISSION_BPS,
  DEFAULT_HOLD_DAYS,
  SETTING_KEYS,
  encryptStock,
  generateOrderNumber,
  parseStockKey,
  slugify,
  splitCommission,
  stockFingerprint,
} from "@asap/shared";
import { CATEGORIES, PRODUCTS, REVIEW_TEXTS, type SeedProduct, type SeedVariant } from "./seed-data/catalog";
import type { OrderStatus } from "../src/generated/enums";

// ───────────── helpers ─────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260101);
const rint = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]!;
const chance = (p: number) => rnd() < p;
function weighted<T>(items: readonly T[], weight: (t: T) => number): T {
  const total = items.reduce((s, i) => s + weight(i), 0);
  let r = rnd() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1]!;
}
const newId = () => "c" + randomUUID().replace(/-/g, "").slice(0, 24);
const rub = (n: number) => Math.round(n * 100);
const DAY = 86_400_000;
const now = new Date();
const daysAgo = (d: number, jitterHours = 0) => new Date(now.getTime() - d * DAY - Math.floor(rnd() * jitterHours * 3_600_000));
const addMs = (d: Date, ms: number) => new Date(d.getTime() + ms);
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
async function chunked<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}
function randomKey(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = () => Array.from({ length: 5 }, () => A[Math.floor(rnd() * A.length)]).join("");
  return `${part()}-${part()}-${part()}`;
}
function randomLogin(): string {
  const names = ["alex", "max", "kate", "ivan", "olga", "dima", "nika", "ruslan", "vika", "pavel", "sasha", "gamer"];
  return `${pick(names)}_${rint(100, 99999)}`;
}
function randomPassword(): string {
  const A = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 12 }, () => A[Math.floor(rnd() * A.length)]).join("");
}
function stockPayload(p: SeedProduct): string {
  switch (p.type) {
    case "ACCOUNT":
      return `${randomLogin()}@mail.com:${randomPassword()}`;
    case "SUBSCRIPTION":
      return p.title.includes("ChatGPT") || p.title.includes("Netflix") || p.title.includes("Spotify") || p.title.includes("NordVPN")
        ? `${randomLogin()}@mail.com:${randomPassword()}`
        : p.title.includes("Discord")
          ? `https://discord.gift/${randomPassword()}${rint(10, 99)}`
          : randomKey();
    default:
      return randomKey();
  }
}

async function main() {
  console.log("🌱 Seeding ASAPawge GG …");
  parseStockKey(); // fail fast if STOCK_ENCRYPTION_KEY is missing

  // ───────── wipe ─────────
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);

  // ───────── settings ─────────
  const settings: [string, unknown][] = [
    [SETTING_KEYS.commissionDefaultBps, DEFAULT_COMMISSION_BPS],
    [SETTING_KEYS.holdDays, DEFAULT_HOLD_DAYS],
    [SETTING_KEYS.aiProvider, "mock"],
    [SETTING_KEYS.aiModel, ""],
    [SETTING_KEYS.aiAutoPublish, 80],
    [SETTING_KEYS.paymentsEnabled, { PLATEGA: true, ROLLYPAY: true, BALANCE: true, SANDBOX: true }],
    [SETTING_KEYS.ymId, ""],
    [SETTING_KEYS.maintenance, false],
    [SETTING_KEYS.supportContacts, { telegram: "https://t.me/asapawge_support", email: "support@asapawge.gg" }],
    [SETTING_KEYS.steamTopupFeePercent, 4], // matches seeded Steam variant prices (500 ₽ -> 520 ₽)
  ];
  await prisma.setting.createMany({ data: settings.map(([key, value]) => ({ key, value: value as never })) });

  // ───────── users ─────────
  const pw = async (p: string) => hash(p);
  const [adminHash, sellerHash, userHash, buyerHash] = await Promise.all([pw("Admin123!"), pw("Seller123!"), pw("User123!"), pw("Buyer123!")]);

  const admin = await prisma.user.create({
    data: { email: "admin@asapawge.gg", name: "Администратор", role: "ADMIN", passwordHash: adminHash, emailVerified: daysAgo(120), createdAt: daysAgo(120) },
  });
  const sellerDefs = [
    { email: "seller@asapawge.gg", name: "Алексей Петров", shop: "Digital Hub", bps: 1000, desc: "Официальные ключи, подписки и софт. Работаем с 2021 года, более 10 000 успешных продаж." },
    { email: "gamekeys@asapawge.gg", name: "Игорь Смирнов", shop: "GameKeys Store", bps: 800, desc: "Игровые ключи Steam, пополнение кошельков, внутриигровая валюта. Моментальная выдача 24/7." },
    { email: "subzone@asapawge.gg", name: "Мария Волкова", shop: "SubZone", bps: null as number | null, desc: "Подписки и подарочные карты для всех регионов. Подбираем лучшие цены каждый день." },
  ];
  const sellers = [] as { user: Awaited<ReturnType<typeof prisma.user.create>>; bps: number }[];
  for (const [i, s] of sellerDefs.entries()) {
    const user = await prisma.user.create({
      data: {
        email: s.email, name: s.name, role: "SELLER", passwordHash: sellerHash, emailVerified: daysAgo(100), createdAt: daysAgo(100 - i * 5),
        sellerProfile: {
          create: {
            shopName: s.shop, slug: slugify(s.shop), description: s.desc, status: "VERIFIED", commissionBps: s.bps, verifiedAt: daysAgo(95),
            avatar: `/api/art/${slugify(s.shop)}-avatar/avatar`,
            payoutDetails: { method: "CARD", card: "4276 **** **** 1234" },
          },
        },
      },
    });
    sellers.push({ user, bps: s.bps ?? DEFAULT_COMMISSION_BPS });
  }
  const mainUser = await prisma.user.create({
    data: { email: "user@asapawge.gg", name: "Тестовый Покупатель", role: "USER", passwordHash: userHash, emailVerified: daysAgo(30), createdAt: daysAgo(30) },
  });

  // Other buyers (created later, after we know their first order date)
  const buyerNames = ["Дмитрий К.", "Анна С.", "Максим Л.", "Екатерина Н.", "Иван П.", "Ольга Т.", "Никита В.", "Юлия М.", "Артём Б.", "Софья Д.", "Кирилл Р.", "Алина Ж.", "Павел Ч.", "Мария Ш.", "Владислав Е.", "Дарья Ф."];
  const buyers = buyerNames.map((name, i) => ({ id: newId(), name, email: `buyer${i + 1}@example.com` }));

  // ───────── categories ─────────
  const catIdBySlug = new Map<string, string>();
  for (const [i, c] of CATEGORIES.filter((c) => !c.parent).entries()) {
    const row = await prisma.category.create({ data: { name: c.name, slug: c.slug, icon: c.icon, description: c.description, sortOrder: i } });
    catIdBySlug.set(c.slug, row.id);
  }
  for (const [i, c] of CATEGORIES.filter((c) => c.parent).entries()) {
    const row = await prisma.category.create({
      data: { name: c.name, slug: c.slug, icon: c.icon, description: c.description, parentId: catIdBySlug.get(c.parent!)!, sortOrder: i },
    });
    catIdBySlug.set(c.slug, row.id);
  }

  // ───────── products ─────────
  interface P {
    seed: SeedProduct;
    id: string;
    slug: string;
    sellerIdx: 0 | 1 | 2;
    variants: { id: string; title: string; price: number; oldPrice?: number; seed: SeedVariant }[];
    price: number; // kopecks
    active: boolean;
  }
  const products: P[] = [];
  const usedSlugs = new Set<string>();
  for (const sp of PRODUCTS) {
    let slug = slugify(sp.title);
    while (usedSlugs.has(slug)) slug += "-2";
    usedSlugs.add(slug);
    const id = newId();
    const status = sp.status ?? "ACTIVE";
    const variants = (sp.variants ?? []).map((vr) => ({ id: newId(), title: vr.title, price: rub(vr.price), oldPrice: vr.oldPrice ? rub(vr.oldPrice) : undefined, seed: vr }));
    const minVariant = variants.length ? variants.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
    const price = minVariant ? minVariant.price : rub(sp.price);
    const oldPrice = minVariant ? minVariant.oldPrice : sp.oldPrice ? rub(sp.oldPrice) : undefined;
    const regionTxt = sp.region ? `Регион активации: ${sp.region}. ` : "";
    const deliveryTxt =
      sp.delivery === "AUTO_STOCK"
        ? "Выдача автоматическая и мгновенная — данные появятся на странице заказа сразу после оплаты."
        : sp.delivery === "AUTO_PROVIDER"
          ? "Исполнение автоматическое через поставщика, обычно занимает 1–5 минут."
          : "Исполняется продавцом вручную, обычно в течение 15–30 минут. Статус можно отслеживать в личном кабинете.";
    const description = `${sp.blurb}\n\n${regionTxt}${deliveryTxt}\n\nГарантия: если товар не подошёл — откройте спор в карточке заказа, поддержка и модераторы площадки помогут решить вопрос. Деньги продавцу переводятся только после подтверждения.`;
    const images = [`/api/art/${slug}/1`, `/api/art/${slug}/2`, `/api/art/${slug}/3`];
    const publishedAt = status === "ACTIVE" || status === "ARCHIVED" ? daysAgo(rint(65, 95)) : null;
    await prisma.product.create({
      data: {
        id, slug, title: sp.title, shortDescription: sp.blurb.slice(0, 160), description, type: sp.type, deliveryMode: sp.delivery, status,
        sellerId: sellers[sp.seller]!.user.id, categoryId: catIdBySlug.get(sp.category)!,
        price, oldPrice: oldPrice ?? null, platform: sp.platform ?? null, region: sp.region ?? null,
        coverImage: `/api/art/${slug}/cover`, images, tags: sp.tags ?? [], isFeatured: sp.featured ?? false,
        moderationNote: sp.moderationNote ?? null, publishedAt, createdAt: publishedAt ?? daysAgo(rint(1, 10)),
        aiModeration: status === "PENDING_REVIEW" ? { score: 72, verdict: "review", reasons: ["Требуется проверка описания"] } : status === "REJECTED" ? { score: 5, verdict: "reject", reasons: ["Запрещённая категория услуг"] } : undefined,
        variants: { create: variants.map((vr, i) => ({ id: vr.id, title: vr.title, price: vr.price, oldPrice: vr.oldPrice ?? null, sortOrder: i, attributes: (vr.seed.attributes ?? undefined) as never, providerSku: vr.seed.providerSku ?? null })) },
      },
    });
    products.push({ seed: sp, id, slug, sellerIdx: sp.seller, variants, price, active: status === "ACTIVE" });
  }
  const activeProducts = products.filter((p) => p.active);
  console.log(`  products: ${products.length} (active ${activeProducts.length})`);

  // ───────── order planning ─────────
  const startDay = 60;
  const promo = await prisma.promoCode.create({ data: { code: "WELCOME10", type: "PERCENT", value: 10, minOrder: rub(500), maxUses: 1000, perUserLimit: 1, expiresAt: addMs(now, 90 * DAY) } });
  await prisma.promoCode.create({ data: { code: "SUMMER500", type: "FIXED", value: rub(500), minOrder: rub(3000), maxUses: 200, perUserLimit: 1, expiresAt: addMs(now, 30 * DAY) } });
  await prisma.promoCode.create({ data: { code: "EXPIRED20", type: "PERCENT", value: 20, maxUses: 50, expiresAt: daysAgo(10), isActive: false } });

  type PlanItem = { p: P; variant: P["variants"][number] | null; qty: number; unit: number; total: number; stockIds: string[]; id: string; bps: number; fee: number; earning: number; status: "DELIVERED" | "FAILED" | "REFUNDED" | "PENDING" | "PROCESSING"; steamLogin?: string };
  type PlanOrder = {
    id: string; number: string; buyer: string; email: string; createdAt: Date; status: OrderStatus; method: "BALANCE" | "PLATEGA" | "ROLLYPAY" | "SANDBOX";
    items: PlanItem[]; subtotal: number; discount: number; total: number; promo: boolean; paidAt?: Date; deliveredAt?: Date; paymentId: string;
  };
  const orders: PlanOrder[] = [];
  const usedNumbers = new Set<string>();
  const buyerPool = [{ id: mainUser.id, email: mainUser.email, w: 3 }, ...buyers.map((b) => ({ id: b.id, email: b.email, w: 1 + Math.floor(rnd() * 3) }))];

  for (let d = startDay; d >= 0; d--) {
    const dow = daysAgo(d).getUTCDay();
    const growth = 1.6 + (startDay - d) * 0.07;
    const weekend = dow === 0 || dow === 6 ? 1.35 : 1;
    const count = Math.max(1, Math.round(growth * weekend + (rnd() - 0.5) * 3));
    for (let k = 0; k < count; k++) {
      const createdAt = d === 0 ? new Date(now.getTime() - Math.floor(rnd() * 20 * 3_600_000)) : new Date(daysAgo(d).getTime() - Math.floor(rnd() * 12 * 3_600_000) + 6 * 3_600_000);
      if (createdAt > now) continue;
      const buyer = weighted(buyerPool, (b) => b.w);
      // main user only orders in last 25 days (account is 30 days old)
      if (buyer.id === mainUser.id && d > 25) continue;
      const nItems = weighted([1, 2, 3], (n) => (n === 1 ? 70 : n === 2 ? 22 : 8));
      const items: PlanItem[] = [];
      const chosen = new Set<string>();
      for (let i = 0; i < nItems; i++) {
        const p = weighted(activeProducts, (x) => x.seed.weight ?? 1);
        if (chosen.has(p.id)) continue;
        chosen.add(p.id);
        const variant = p.variants.length ? weighted(p.variants, (vv) => 1 / Math.sqrt(vv.price)) : null;
        const qty = chance(0.9) ? 1 : rint(2, 3);
        const unit = variant ? variant.price : p.price;
        const seller = sellers[p.sellerIdx]!;
        items.push({ p, variant, qty, unit, total: unit * qty, stockIds: [], id: newId(), bps: seller.bps, fee: 0, earning: 0, status: "PENDING",
          steamLogin: p.seed.type === "TOPUP" ? randomLogin() : undefined });
      }
      const subtotal = items.reduce((s, i) => s + i.total, 0);
      const usePromo = subtotal >= rub(500) && chance(0.08);
      const discount = usePromo ? Math.floor(subtotal * 0.1) : 0;
      let allocated = 0;
      items.forEach((it, idx) => {
        const share = idx === items.length - 1 ? discount - allocated : Math.floor((discount * it.total) / subtotal);
        allocated += share;
        it.total -= share;
        const { fee, net } = splitCommission(it.total, it.bps);
        it.fee = fee;
        it.earning = net;
      });
      const total = subtotal - discount;
      // status
      const ageH = (now.getTime() - createdAt.getTime()) / 3_600_000;
      let status: PlanOrder["status"];
      const r = rnd();
      if (ageH < 0.5) status = r < 0.6 ? "PENDING" : "PAID";
      else if (r < 0.04) status = "CANCELLED";
      else if (r < 0.055) status = "FAILED";
      else if (r < 0.085 && buyer.id !== mainUser.id) status = "REFUNDED";
      else if (r < 0.105 && ageH > 24) status = "DISPUTED";
      else status = "DELIVERED";
      const method = buyer.id === mainUser.id ? pick(["PLATEGA", "ROLLYPAY", "SANDBOX"] as const) : pick(["BALANCE", "BALANCE", "PLATEGA", "PLATEGA", "ROLLYPAY", "ROLLYPAY", "SANDBOX"] as const);
      let number = generateOrderNumber(createdAt);
      while (usedNumbers.has(number)) number = generateOrderNumber(createdAt);
      usedNumbers.add(number);
      orders.push({ id: newId(), number, buyer: buyer.id, email: buyer.email, createdAt, status, method, items, subtotal, discount, total, promo: usePromo, paymentId: newId() });
    }
  }
  orders.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // timestamps + item statuses
  for (const o of orders) {
    const paid = !["PENDING", "CANCELLED", "FAILED"].includes(o.status);
    if (paid) o.paidAt = addMs(o.createdAt, rint(20, 180) * 1000);
    for (const it of o.items) {
      if (o.status === "DELIVERED" || o.status === "DISPUTED") it.status = "DELIVERED";
      else if (o.status === "REFUNDED") it.status = "REFUNDED";
      else if (o.status === "FAILED") it.status = "FAILED";
      else if (o.status === "PAID") it.status = "PROCESSING";
      else it.status = "PENDING";
    }
    if (o.status === "DELIVERED" || o.status === "DISPUTED" || o.status === "REFUNDED") {
      const manual = o.items.some((i) => i.p.seed.delivery === "MANUAL");
      o.deliveredAt = addMs(o.paidAt!, manual ? rint(5, 40) * 60_000 : rint(5, 240) * 1000);
    }
  }

  // ───────── stock ─────────
  const demand = new Map<string, number>(); // key: productId|variantId
  const keyOf = (productId: string, variantId?: string | null) => `${productId}|${variantId ?? ""}`;
  for (const o of orders) for (const it of o.items) {
    if (it.p.seed.delivery === "AUTO_STOCK" && ["DELIVERED", "REFUNDED"].includes(it.status)) demand.set(keyOf(it.p.id, it.variant?.id), (demand.get(keyOf(it.p.id, it.variant?.id)) ?? 0) + it.qty);
  }
  const stockRows: Prisma.StockItemCreateManyInput[] = [];
  const availableStock = new Map<string, string[]>(); // key -> pool of unsold stock ids (for assigning to orders)
  const fingerprints = new Set<string>();
  let stockTotal = 0;
  for (const p of products) {
    if (p.seed.delivery !== "AUTO_STOCK") continue;
    if (p.seed.status === "PENDING_REVIEW" || p.seed.status === "REJECTED" || p.seed.status === "DRAFT") continue;
    const targets: (P["variants"][number] | null)[] = p.variants.length ? p.variants : [null];
    for (const vr of targets) {
      const k = keyOf(p.id, vr?.id);
      const sold = demand.get(k) ?? 0;
      const extra = p.seed.extraStock ?? rint(6, 18);
      const pool: string[] = [];
      for (let i = 0; i < sold + extra; i++) {
        let plain = stockPayload(p.seed);
        while (fingerprints.has(p.id + stockFingerprint(plain))) plain = stockPayload(p.seed);
        fingerprints.add(p.id + stockFingerprint(plain));
        const id = newId();
        pool.push(id);
        stockRows.push({ id, productId: p.id, variantId: vr?.id ?? null, payloadEnc: encryptStock(plain), fingerprint: stockFingerprint(plain), status: "AVAILABLE", createdAt: daysAgo(rint(0, 70)) });
      }
      availableStock.set(k, pool);
      stockTotal += pool.length;
    }
  }
  // Make a couple of popular products out of stock to exercise the UI
  const outOfStockSlugs = ["starfield"];
  const stockById = new Map(stockRows.map((s) => [s.id!, s]));
  // Assign sold stock to order items
  for (const o of orders) for (const it of o.items) {
    if (!(it.p.seed.delivery === "AUTO_STOCK" && ["DELIVERED", "REFUNDED"].includes(it.status))) continue;
    const pool = availableStock.get(keyOf(it.p.id, it.variant?.id))!;
    for (let q = 0; q < it.qty; q++) {
      const sid = pool.shift()!;
      it.stockIds.push(sid);
      const row = stockById.get(sid)!;
      row.status = "SOLD";
      row.orderItemId = it.id;
      row.soldAt = o.deliveredAt;
    }
  }
  for (const slug of outOfStockSlugs) {
    const p = products.find((x) => x.slug === slug);
    if (!p) continue;
    for (const row of stockRows) if (row.productId === p.id && row.status === "AVAILABLE") row.status = "SOLD", row.soldAt = daysAgo(1);
  }
  // A few reserved items (in-flight checkout)
  for (const row of stockRows.filter((r) => r.status === "AVAILABLE").slice(0, 3)) {
    row.status = "RESERVED";
    row.reservedUntil = addMs(now, 10 * 60_000);
  }
  console.log(`  stock items planned: ${stockTotal}`);

  // ───────── create buyers (after first order) ─────────
  const firstOrderAt = new Map<string, Date>();
  for (const o of orders) if (!firstOrderAt.has(o.buyer)) firstOrderAt.set(o.buyer, o.createdAt);
  const extraNewUsers = Array.from({ length: 14 }, (_, i) => ({ id: newId(), name: `Новый пользователь ${i + 1}`, email: `newbie${i + 1}@example.com`, createdAt: daysAgo(rint(0, 58), 12) }));
  await prisma.user.createMany({
    data: [
      ...buyers.map((b) => ({ id: b.id, email: b.email, name: b.name, passwordHash: buyerHash, role: "USER" as const, emailVerified: now, createdAt: addMs(firstOrderAt.get(b.id) ?? daysAgo(rint(5, 40)), -rint(5, 600) * 60_000) })),
      ...extraNewUsers.map((u) => ({ ...u, passwordHash: buyerHash, role: "USER" as const, emailVerified: u.createdAt })),
    ],
  });

  // ───────── persist orders, items, payments, ledger ─────────
  const ledger: Prisma.LedgerEntryCreateManyInput[] = [];
  const payments: Prisma.PaymentCreateManyInput[] = [];
  const orderRows: Prisma.OrderCreateManyInput[] = [];
  const itemRows: Prisma.OrderItemCreateManyInput[] = [];
  const bal = new Map<string, number>(); // user balances
  const balOf = (id: string) => bal.get(id) ?? 0;
  const setBal = (id: string, v: number) => bal.set(id, v);
  const sellerHold = new Map<string, number>();
  const sellerAvail = new Map<string, number>();
  const addTo = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const holdDays = DEFAULT_HOLD_DAYS;
  const push = (e: Omit<Prisma.LedgerEntryCreateManyInput, "id"> & { id?: string }) => ledger.push({ id: newId(), ...e });
  const tx = (kind: Prisma.LedgerEntryCreateManyInput["kind"], at: Date, base: Partial<Prisma.LedgerEntryCreateManyInput>, lines: { account: Prisma.LedgerEntryCreateManyInput["account"]; ownerId?: string | null; direction: "DEBIT" | "CREDIT"; amount: number; orderItemId?: string }[]) => {
    const txId = "tx_" + newId();
    for (const l of lines) if (l.amount > 0) push({ txId, kind, createdAt: at, ...base, account: l.account, ownerId: l.ownerId ?? null, direction: l.direction, amount: l.amount, orderItemId: l.orderItemId });
  };
  // Pre-compute per-buyer BALANCE spend to emit balance top-ups first
  const mainTopupAt = daysAgo(24);
  tx("TOPUP", mainTopupAt, { memo: "Пополнение баланса" }, [
    { account: "EXTERNAL", direction: "DEBIT", amount: rub(5000) },
    { account: "USER_BALANCE", ownerId: mainUser.id, direction: "CREDIT", amount: rub(5000) },
  ]);
  setBal(mainUser.id, rub(5000));
  payments.push({ id: newId(), userId: mainUser.id, provider: "SANDBOX", purpose: "BALANCE_TOPUP", externalId: "sbx_topup_" + newId(), status: "PAID", amount: rub(5000), method: "card", paidAt: mainTopupAt, createdAt: mainTopupAt, raw: { sandbox: true } });

  const releasable: { it: PlanItem; o: PlanOrder }[] = [];
  for (const o of orders) {
    const paid = !!o.paidAt;
    const sellerOf = (it: PlanItem) => sellers[it.p.sellerIdx]!.user.id;
    orderRows.push({
      id: o.id, number: o.number, buyerId: o.buyer, email: o.email, status: o.status, subtotal: o.subtotal, discount: o.discount, total: o.total,
      promoCodeId: o.promo ? promo.id : null, fraudScore: rint(1, 25), ip: `203.0.113.${rint(1, 254)}`, userAgent: "Mozilla/5.0 (seed)",
      paidAt: o.paidAt ?? null, deliveredAt: o.deliveredAt ?? null, cancelledAt: o.status === "CANCELLED" ? addMs(o.createdAt, 30 * 60_000) : null, createdAt: o.createdAt, updatedAt: o.deliveredAt ?? o.paidAt ?? o.createdAt,
    });
    for (const it of o.items) {
      const delivered = !!o.deliveredAt && ["DELIVERED", "REFUNDED"].includes(it.status);
      const holdReleaseAt = delivered && o.status !== "REFUNDED" ? addMs(o.deliveredAt!, holdDays * DAY) : null;
      const isProvider = it.p.seed.delivery === "AUTO_PROVIDER";
      const isManual = it.p.seed.delivery === "MANUAL";
      itemRows.push({
        id: it.id, orderId: o.id, productId: it.p.id, variantId: it.variant?.id ?? null, sellerId: sellerOf(it), title: it.p.seed.title, variantTitle: it.variant?.title ?? null,
        unitPrice: it.unit, quantity: it.qty, total: it.total, commissionBps: it.bps, commissionAmount: it.fee, sellerEarning: it.earning, status: it.status,
        meta: it.steamLogin ? { steamLogin: it.steamLogin } : isManual ? { note: "UID/логин указан при заказе" } : undefined,
        deliveryData: delivered && isProvider ? { provider: "mock", status: "completed", steamLogin: it.steamLogin, txId: "mock_" + newId().slice(0, 10) } : delivered && isManual ? { message: "Выполнено продавцом. Спасибо за покупку!" } : undefined,
        deliveredAt: delivered ? o.deliveredAt : null, holdReleaseAt, holdReleased: false, createdAt: o.createdAt,
      });
    }
    // payment + ledger
    if (paid) {
      const buyerId = o.buyer;
      const payAt = o.paidAt!;
      if (o.method === "BALANCE") {
        if (balOf(buyerId) < o.total) {
          const topup = Math.ceil((o.total - balOf(buyerId)) / rub(500)) * rub(500) + rub(rint(0, 4) * 500);
          const topAt = addMs(payAt, -rint(5, 30) * 60_000);
          tx("TOPUP", topAt, { memo: "Пополнение баланса" }, [
            { account: "EXTERNAL", direction: "DEBIT", amount: topup },
            { account: "USER_BALANCE", ownerId: buyerId, direction: "CREDIT", amount: topup },
          ]);
          payments.push({ id: newId(), userId: buyerId, provider: pick(["PLATEGA", "ROLLYPAY", "SANDBOX"] as const), purpose: "BALANCE_TOPUP", externalId: "topup_" + newId(), status: "PAID", amount: topup, method: "card", paidAt: topAt, createdAt: topAt, raw: { seed: true } });
          addTo(bal, buyerId, topup);
        }
        payments.push({ id: o.paymentId, orderId: o.id, userId: buyerId, provider: "BALANCE", purpose: "ORDER", externalId: "bal_" + o.id, status: "PAID", amount: o.total, paidAt: payAt, createdAt: o.createdAt });
      } else {
        const ext = o.method === "SANDBOX" ? "sbx_" + newId() : o.method === "PLATEGA" ? "plt_" + newId() : "rp_" + newId();
        payments.push({ id: o.paymentId, orderId: o.id, userId: buyerId, provider: o.method, purpose: "ORDER", externalId: ext, status: "PAID", amount: o.total, method: pick(["card", "sbp", "sbp"]), paidAt: payAt, createdAt: o.createdAt, raw: { seed: true, status: "CONFIRMED" } });
        tx("TOPUP", payAt, { orderId: o.id, paymentId: o.paymentId, memo: `Оплата заказа ${o.number}` }, [
          { account: "EXTERNAL", direction: "DEBIT", amount: o.total },
          { account: "USER_BALANCE", ownerId: buyerId, direction: "CREDIT", amount: o.total },
        ]);
        addTo(bal, buyerId, o.total);
      }
      // purchase postings per item
      for (const it of o.items) {
        const sid = sellerOf(it);
        tx("PURCHASE", payAt, { orderId: o.id, orderItemId: it.id, memo: `Покупка: ${it.p.seed.title}` }, [
          { account: "USER_BALANCE", ownerId: buyerId, direction: "DEBIT", amount: it.total },
          { account: "SELLER_HOLD", ownerId: sid, direction: "CREDIT", amount: it.earning },
          { account: "PLATFORM_FEE", direction: "CREDIT", amount: it.fee },
        ]);
        addTo(bal, buyerId, -it.total);
        addTo(sellerHold, sid, it.earning);
      }
      if (o.status === "REFUNDED") {
        const refAt = addMs(o.deliveredAt ?? payAt, rint(1, 48) * 3_600_000);
        for (const it of o.items) {
          const sid = sellerOf(it);
          tx("REFUND", refAt, { orderId: o.id, orderItemId: it.id, memo: `Возврат: ${o.number}` }, [
            { account: "SELLER_HOLD", ownerId: sid, direction: "DEBIT", amount: it.earning },
            { account: "PLATFORM_FEE", direction: "DEBIT", amount: it.fee },
            { account: "USER_BALANCE", ownerId: o.buyer, direction: "CREDIT", amount: it.total },
          ]);
          addTo(sellerHold, sid, -it.earning);
          addTo(bal, o.buyer, it.total);
        }
      } else if (o.status === "DELIVERED") {
        for (const it of o.items) {
          const relAt = addMs(o.deliveredAt!, holdDays * DAY);
          if (relAt <= now) releasable.push({ it, o });
        }
      }
    } else if (o.status === "PENDING" || o.status === "CANCELLED" || o.status === "FAILED") {
      payments.push({ id: o.paymentId, orderId: o.id, userId: o.buyer, provider: o.method === "BALANCE" ? "SANDBOX" : o.method, purpose: "ORDER", externalId: "pend_" + newId(), status: o.status === "PENDING" ? "PENDING" : o.status === "FAILED" ? "FAILED" : "EXPIRED", amount: o.total, createdAt: o.createdAt, paymentUrl: o.status === "PENDING" ? `/checkout/sandbox/${o.paymentId}` : null });
    }
  }
  // hold releases
  const releasedItemIds = new Set<string>();
  for (const { it, o } of releasable) {
    const sid = sellers[it.p.sellerIdx]!.user.id;
    tx("HOLD_RELEASE", addMs(o.deliveredAt!, holdDays * DAY), { orderId: o.id, orderItemId: it.id, memo: "Освобождение холда" }, [
      { account: "SELLER_HOLD", ownerId: sid, direction: "DEBIT", amount: it.earning },
      { account: "SELLER_AVAILABLE", ownerId: sid, direction: "CREDIT", amount: it.earning },
    ]);
    addTo(sellerHold, sid, -it.earning);
    addTo(sellerAvail, sid, it.earning);
    releasedItemIds.add(it.id);
  }
  for (const row of itemRows) if (releasedItemIds.has(row.id!)) row.holdReleased = true;

  // payouts
  const payoutRows: Prisma.PayoutCreateManyInput[] = [];
  const payoutPlans = [
    { idx: 0, status: "PAID" as const, share: 0.5, at: daysAgo(12), method: "CARD", details: { card: "4276 **** **** 1234" } },
    { idx: 1, status: "PAID" as const, share: 0.4, at: daysAgo(9), method: "SBP", details: { phone: "+7 *** *** 12 34", bank: "Тинькофф" } },
    { idx: 1, status: "REQUESTED" as const, share: 0.3, at: daysAgo(1), method: "SBP", details: { phone: "+7 *** *** 12 34", bank: "Тинькофф" } },
  ];
  for (const pp of payoutPlans) {
    const sid = sellers[pp.idx]!.user.id;
    const amount = Math.floor(((sellerAvail.get(sid) ?? 0) * pp.share) / 10_000) * 10_000;
    if (amount < rub(1000)) continue;
    const id = newId();
    payoutRows.push({ id, sellerId: sid, amount, fee: 0, status: pp.status, method: pp.method, details: pp.details, createdAt: pp.at, processedAt: pp.status === "PAID" ? addMs(pp.at, 4 * 3_600_000) : null, processedById: pp.status === "PAID" ? admin.id : null });
    tx("PAYOUT", pp.at, { payoutId: id, memo: "Вывод средств" }, [
      { account: "SELLER_AVAILABLE", ownerId: sid, direction: "DEBIT", amount },
      { account: "EXTERNAL", direction: "CREDIT", amount },
    ]);
    addTo(sellerAvail, sid, -amount);
  }

  await chunked(orderRows, 500, (c) => prisma.order.createMany({ data: c }));
  await chunked(itemRows, 500, (c) => prisma.orderItem.createMany({ data: c }));
  // stock is inserted after order items exist (sold items reference orderItemId)
  await chunked(stockRows, 1000, (c) => prisma.stockItem.createMany({ data: c }));
  await chunked(payments, 500, (c) => prisma.payment.createMany({ data: c }));
  await chunked(payoutRows, 100, (c) => prisma.payout.createMany({ data: c }));
  await chunked(ledger, 1000, (c) => prisma.ledgerEntry.createMany({ data: c }));
  console.log(`  orders: ${orderRows.length}, items: ${itemRows.length}, payments: ${payments.length}, ledger entries: ${ledger.length}`);

  // ───────── reviews ─────────
  const reviewRows: Prisma.ReviewCreateManyInput[] = [];
  for (const o of orders) {
    if (o.status !== "DELIVERED") continue;
    for (const it of o.items) {
      if (!chance(0.38)) continue;
      const at = addMs(o.deliveredAt!, rint(1, 48) * 3_600_000);
      if (at > now) continue;
      const rating = weighted([5, 4, 3, 2, 1], (r) => ({ 5: 70, 4: 18, 3: 6, 2: 3, 1: 3 })[r]!);
      const text = rating >= 4 ? pick(REVIEW_TEXTS.positive) : rating === 3 ? pick(REVIEW_TEXTS.neutral) : pick(REVIEW_TEXTS.negative);
      const replied = chance(0.4);
      reviewRows.push({
        id: newId(), orderItemId: it.id, productId: it.p.id, sellerId: sellers[it.p.sellerIdx]!.user.id, buyerId: o.buyer, rating, text: chance(0.9) ? text : null,
        reply: replied ? pick(REVIEW_TEXTS.replies) : null, repliedAt: replied ? addMs(at, rint(1, 12) * 3_600_000) : null, status: "PUBLISHED", createdAt: at,
      });
    }
  }
  await chunked(reviewRows, 500, (c) => prisma.review.createMany({ data: c }));

  // product + seller aggregates
  const sold = new Map<string, number>();
  for (const o of orders) if (["DELIVERED", "DISPUTED", "PAID", "PROCESSING"].includes(o.status)) for (const it of o.items) addTo(sold, it.p.id, it.qty);
  const sellerSales = new Map<string, number>();
  for (const o of orders) if (["DELIVERED", "DISPUTED"].includes(o.status)) for (const it of o.items) addTo(sellerSales, sellers[it.p.sellerIdx]!.user.id, it.qty);
  const prodRating = new Map<string, number[]>();
  const sellerRating = new Map<string, number[]>();
  for (const r of reviewRows) {
    (prodRating.get(r.productId) ?? prodRating.set(r.productId, []).get(r.productId)!).push(r.rating);
    (sellerRating.get(r.sellerId) ?? sellerRating.set(r.sellerId, []).get(r.sellerId)!).push(r.rating);
  }
  const avg = (a: number[]) => Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10;
  for (const p of products) {
    const rs = prodRating.get(p.id) ?? [];
    await prisma.product.update({ where: { id: p.id }, data: { salesCount: (sold.get(p.id) ?? 0) + (p.active ? rint(20, 400) : 0), viewCount: p.active ? rint(300, 9000) : 0, ratingAvg: rs.length ? avg(rs) : 0, ratingCount: rs.length } });
  }
  for (const s of sellers) {
    const sid = s.user.id;
    const rs = sellerRating.get(sid) ?? [];
    await prisma.sellerProfile.update({ where: { userId: sid }, data: { rating: rs.length ? avg(rs) : 0, ratingCount: rs.length, salesCount: (sellerSales.get(sid) ?? 0) + rint(100, 900), holdBalance: sellerHold.get(sid) ?? 0, availableBalance: sellerAvail.get(sid) ?? 0 } });
  }
  // cached user balances
  for (const [id, v] of bal) if (v !== 0) await prisma.user.update({ where: { id }, data: { balance: v } });
  const mainBal = (await prisma.user.findUnique({ where: { id: mainUser.id } }))!.balance;
  if (mainBal !== rub(5000)) throw new Error(`user@ balance should be 500000 kopecks, got ${mainBal}`);

  // ───────── disputes ─────────
  const disputed = orders.filter((o) => o.status === "DISPUTED").slice(0, 3);
  const refunded = orders.filter((o) => o.status === "REFUNDED").slice(0, 1);
  const disputeTexts = [
    ["Ключ не активируется, пишет что уже использован.", "Здравствуйте! Проверил — ключ выдан впервые. Попробуйте активировать через клиент Steam, не через сайт.", "Пробовал через клиент, та же ошибка."],
    ["Пополнение так и не пришло на кошелёк.", "Заказ в обработке у поставщика, проверяю статус.", "Прошло уже 3 часа, прошу вернуть деньги."],
    ["Подписка оформлена на другой регион, не как в описании.", "Уточню детали у поставщика и вернусь с ответом.", "Жду ответа."],
  ];
  for (const [i, o] of [...disputed, ...refunded].entries()) {
    const it = o.items[0]!;
    const sellerId = sellers[it.p.sellerIdx]!.user.id;
    const [reason, sellerMsg, buyerMsg] = disputeTexts[i % disputeTexts.length]!;
    const resolved = o.status === "REFUNDED";
    const dispute = await prisma.dispute.create({
      data: {
        orderId: o.id, orderItemId: it.id, buyerId: o.buyer, sellerId, reason: reason!, status: resolved ? "RESOLVED_REFUND" : i === 0 ? "ESCALATED" : "SELLER_REPLIED",
        aiSuggestion: { recommendation: resolved ? "refund" : "ask_more_info", confidence: 0.64, summary: "Покупатель сообщает о проблеме с активацией. Рекомендуется запросить скриншот ошибки." },
        resolution: resolved ? "Возврат на баланс покупателя по решению модератора." : null, resolvedById: resolved ? admin.id : null, resolvedAt: resolved ? addMs(o.deliveredAt ?? o.createdAt, 2 * DAY) : null,
        createdAt: addMs(o.deliveredAt ?? o.createdAt, 3_600_000),
        messages: {
          create: [
            { authorId: o.buyer, authorRole: "USER", body: reason!, createdAt: addMs(o.deliveredAt ?? o.createdAt, 3_600_000) },
            { authorId: sellerId, authorRole: "SELLER", body: sellerMsg!, createdAt: addMs(o.deliveredAt ?? o.createdAt, 2 * 3_600_000) },
            { authorId: o.buyer, authorRole: "USER", body: buyerMsg!, createdAt: addMs(o.deliveredAt ?? o.createdAt, 3 * 3_600_000) },
            { authorRole: "AI", body: "AI-ассистент: рекомендуем запросить скриншот ошибки и проверить регион аккаунта покупателя.", createdAt: addMs(o.deliveredAt ?? o.createdAt, 3 * 3_600_000 + 60_000) },
          ],
        },
      },
    });
    void dispute;
  }

  // ───────── favorites, notifications, ai/audit logs ─────────
  await prisma.favorite.createMany({ data: activeProducts.slice(0, 6).map((p) => ({ userId: mainUser.id, productId: p.id })) });
  const mainOrders = orders.filter((o) => o.buyer === mainUser.id && o.status === "DELIVERED").slice(-3);
  await prisma.notification.createMany({
    data: [
      ...mainOrders.map((o) => ({ userId: mainUser.id, type: "ORDER_DELIVERED" as const, title: `Заказ ${o.number} выдан`, body: "Ключи доступны на странице заказа.", link: `/account/orders/${o.id}`, readAt: chance(0.5) ? now : null, createdAt: o.deliveredAt! })),
      { userId: mainUser.id, type: "SYSTEM" as const, title: "Добро пожаловать в ASAPawge GG!", body: "Используйте промокод WELCOME10 на первый заказ.", link: "/catalog", createdAt: mainUser.createdAt },
      { userId: sellers[0]!.user.id, type: "PRODUCT_APPROVED" as const, title: "Товар опубликован", body: "Ваш товар прошёл модерацию.", link: "/seller/products", createdAt: daysAgo(3) },
      { userId: sellers[2]!.user.id, type: "PAYOUT_UPDATE" as const, title: "Выплата отправлена", body: "Выплата обработана администратором.", link: "/seller/payouts", createdAt: daysAgo(9) },
    ],
  });
  const aiProducts = products.filter((p) => p.active).slice(0, 6);
  await prisma.aiLog.createMany({
    data: [
      ...aiProducts.map((p, i) => ({ provider: "mock", model: "mock-moderator-1", task: "moderation", input: { productId: p.id, title: p.seed.title } as never, output: { score: 90 + i, verdict: "approve" } as never, tokensIn: rint(300, 900), tokensOut: rint(40, 120), latencyMs: rint(80, 400), ok: true, createdAt: daysAgo(rint(20, 60)) })),
      ...Array.from({ length: 5 }, () => ({ provider: "mock", model: "mock-chat-1", task: "support_chat", input: { message: "Где мой ключ?" } as never, output: { reply: "Ключ доступен на странице заказа в личном кабинете." } as never, tokensIn: rint(100, 400), tokensOut: rint(30, 150), latencyMs: rint(100, 600), ok: true, createdAt: daysAgo(rint(0, 10)) })),
    ],
  });
  await prisma.auditLog.createMany({
    data: [
      { actorId: admin.id, action: "seller.verify", entityType: "SellerProfile", entityId: sellers[0]!.user.id, after: { status: "VERIFIED" }, ip: "127.0.0.1", createdAt: daysAgo(95) },
      { actorId: admin.id, action: "product.approve", entityType: "Product", entityId: aiProducts[0]!.id, before: { status: "PENDING_REVIEW" }, after: { status: "ACTIVE" }, ip: "127.0.0.1", createdAt: daysAgo(60) },
      { actorId: admin.id, action: "product.reject", entityType: "Product", entityId: products.find((p) => p.seed.status === "REJECTED")!.id, before: { status: "PENDING_REVIEW" }, after: { status: "REJECTED" }, ip: "127.0.0.1", createdAt: daysAgo(4) },
      { actorId: admin.id, action: "payout.paid", entityType: "Payout", entityId: payoutRows[0]?.id, after: { status: "PAID" }, ip: "127.0.0.1", createdAt: daysAgo(12) },
      { actorId: admin.id, action: "settings.update", entityType: "Setting", entityId: SETTING_KEYS.commissionDefaultBps, before: { value: 1200 }, after: { value: DEFAULT_COMMISSION_BPS }, ip: "127.0.0.1", createdAt: daysAgo(30) },
    ],
  });

  // ───────── analytics events + daily metrics ─────────
  const events: Prisma.AnalyticsEventCreateManyInput[] = [];
  const paths = ["/", "/catalog", "/steam", "/catalog?category=podpiski"];
  const sessionsByDay = new Map<string, Set<string>>();
  const funnelByDay = new Map<string, Record<string, number>>();
  const bumpF = (day: string, name: string) => {
    const f = funnelByDay.get(day) ?? funnelByDay.set(day, {}).get(day)!;
    f[name] = (f[name] ?? 0) + 1;
  };
  const addSess = (day: string, s: string) => (sessionsByDay.get(day) ?? sessionsByDay.set(day, new Set()).get(day)!).add(s);
  const ev = (name: string, at: Date, sessionId: string, extra: Partial<Prisma.AnalyticsEventCreateManyInput> = {}) => {
    events.push({ id: newId(), name, sessionId, createdAt: at, ...extra });
    bumpF(dayKey(at), name);
    addSess(dayKey(at), sessionId);
  };
  const ordersByDay = new Map<string, number>();
  for (const o of orders) ordersByDay.set(dayKey(o.createdAt), (ordersByDay.get(dayKey(o.createdAt)) ?? 0) + 1);
  for (let d = startDay; d >= 0; d--) {
    const base = daysAgo(d);
    const key = dayKey(base);
    const nSess = 18 + (ordersByDay.get(key) ?? 0) * 7 + rint(0, 10);
    for (let s = 0; s < nSess; s++) {
      const sid = "s_" + newId().slice(0, 12);
      const at = addMs(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate())), rint(0, 86_000) * 1000);
      if (at > now) continue;
      ev("page_view", at, sid, { path: pick(paths), referrer: pick(["", "https://yandex.ru", "https://google.com", "https://t.me", "https://vk.com"]) || null });
      if (chance(0.62)) {
        const p = weighted(activeProducts, (x) => x.seed.weight ?? 1);
        ev("view_item", addMs(at, 20_000), sid, { path: `/product/${p.slug}`, properties: { productId: p.id } });
        if (chance(0.17)) {
          ev("add_to_cart", addMs(at, 60_000), sid, { path: `/product/${p.slug}`, properties: { productId: p.id } });
          if (chance(0.45)) ev("begin_checkout", addMs(at, 120_000), sid, { path: "/checkout" });
        }
      }
      if (chance(0.08)) ev("search", addMs(at, 10_000), sid, { path: "/search", properties: { q: pick(["steam", "spotify", "chatgpt", "gta", "xbox"]) } });
    }
  }
  for (const o of orders) {
    const sid = "o_" + o.id.slice(0, 12);
    ev("add_to_cart", addMs(o.createdAt, -240_000), sid, { userId: o.buyer });
    ev("begin_checkout", addMs(o.createdAt, -60_000), sid, { userId: o.buyer, path: "/checkout" });
    if (o.paidAt) ev("purchase", o.paidAt, sid, { userId: o.buyer, properties: { orderId: o.id, value: o.total / 100, currency: "RUB" } });
  }
  for (const u of [...buyers.map((b) => ({ id: b.id, at: addMs(firstOrderAt.get(b.id) ?? daysAgo(10), -3_600_000) })), ...extraNewUsers.map((u) => ({ id: u.id, at: u.createdAt }))]) {
    ev("sign_up", u.at, "u_" + u.id.slice(0, 12), { userId: u.id });
  }
  await chunked(events, 5000, (c) => prisma.analyticsEvent.createMany({ data: c }));
  console.log(`  analytics events: ${events.length}`);

  // daily metrics
  const userCreated = new Map<string, number>();
  const allUsers = await prisma.user.findMany({ select: { id: true, createdAt: true } });
  for (const u of allUsers) userCreated.set(dayKey(u.createdAt), (userCreated.get(dayKey(u.createdAt)) ?? 0) + 1);
  const metricRows: Prisma.DailyMetricCreateManyInput[] = [];
  for (let d = startDay; d >= 0; d--) {
    const day = daysAgo(d);
    const key = dayKey(day);
    const created = orders.filter((o) => dayKey(o.createdAt) === key);
    const paidOrders = orders.filter((o) => o.paidAt && dayKey(o.paidAt) === key && !["PENDING", "CANCELLED", "FAILED"].includes(o.status));
    const refundsToday = orders.filter((o) => o.status === "REFUNDED" && o.paidAt && dayKey(o.paidAt) === key);
    const gmv = paidOrders.filter((o) => o.status !== "REFUNDED").reduce((s, o) => s + o.total, 0);
    const revenue = paidOrders.filter((o) => o.status !== "REFUNDED").reduce((s, o) => s + o.items.reduce((a, i) => a + i.fee, 0), 0);
    const active = new Set<string>(orders.filter((o) => dayKey(o.createdAt) === key).map((o) => o.buyer));
    const topMap = new Map<string, { productId: string; title: string; revenue: number; qty: number }>();
    for (const o of paidOrders) for (const it of o.items) {
      const t = topMap.get(it.p.id) ?? { productId: it.p.id, title: it.p.seed.title, revenue: 0, qty: 0 };
      t.revenue += it.total;
      t.qty += it.qty;
      topMap.set(it.p.id, t);
    }
    metricRows.push({
      date: new Date(key + "T00:00:00.000Z"), gmv, platformRevenue: revenue, ordersCreated: created.length, ordersPaid: paidOrders.length,
      newUsers: userCreated.get(key) ?? 0, activeUsers: active.size + Math.floor((sessionsByDay.get(key)?.size ?? 0) * 0.15), sessions: sessionsByDay.get(key)?.size ?? 0,
      refunds: refundsToday.reduce((s, o) => s + o.total, 0), avgOrderValue: paidOrders.length ? Math.round(gmv / paidOrders.length) : 0,
      data: { funnel: funnelByDay.get(key) ?? {}, topProducts: [...topMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5) } as never,
    });
  }
  await prisma.dailyMetric.createMany({ data: metricRows });

  // ───────── summary ─────────
  const [u, p, o, st, l] = await Promise.all([prisma.user.count(), prisma.product.count(), prisma.order.count(), prisma.stockItem.count(), prisma.ledgerEntry.count()]);
  console.log(`✅ Done: users=${u} products=${p} orders=${o} stock=${st} ledger=${l}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
