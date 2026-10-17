import "server-only";
import { Prisma, prisma } from "@asap/db";
import { cached, redis } from "@/lib/redis";
import { deltaPct, eachDay, isoDate, parsePeriod, periodWindow, ratioPct, startOfUtcDay, type PeriodWindow } from "./range";
import type {
  CategorySlice,
  DashboardMetrics,
  DayPoint,
  FunnelStep,
  Kpi,
  PaymentSlice,
  PeriodDays,
  RetentionRow,
  TopProduct,
  TopSeller,
} from "./types";
import { PERIOD_OPTIONS } from "./types";

/**
 * Admin dashboard metrics. Definitions follow docs/CONTRACTS.md §14:
 *   GMV      = Σ Order.total with paidAt in the day and status ∉ {PENDING, CANCELLED, FAILED, REFUNDED}
 *   revenue  = Σ OrderItem.commissionAmount of those orders (refunded items excluded) = platform fee
 * Everything is computed by SQL aggregates (prisma.$queryRaw), cached in Redis for 5 minutes. Money fields are always live (a
 * snapshot taken yesterday would still count an order that was refunded today); sessions are read from the `DailyMetric`
 * snapshots written by the worker for closed days and computed live for today / days without a snapshot. DAU is always live: it must
 * share its definition (distinct user-or-anonymous-session ids) with the live MAU figure so that the stickiness ratio is meaningful.
 */

export const METRICS_TTL_SEC = 300;
const cacheKey = (days: number) => `admin:metrics:v1:${days}`;

const EXCLUDED_STATUSES = Prisma.sql`('PENDING','CANCELLED','FAILED','REFUNDED')`;

/** Raw SQL aggregates come back as bigint / Decimal / number / null depending on the cast — normalise. */
export function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v as { toString(): string });
  return Number.isFinite(n) ? n : 0;
}
function dateKey(v: unknown): string {
  if (v instanceof Date) return isoDate(v);
  return String(v).slice(0, 10);
}

const PAYMENT_LABELS: Record<string, string> = {
  PLATEGA: "Platega",
  ROLLYPAY: "RollyPay",
  BALANCE: "Баланс сайта",
  SANDBOX: "Тестовая оплата",
};

const FUNNEL_STEPS: { key: FunnelStep["key"]; label: string }[] = [
  { key: "page_view", label: "Визиты" },
  { key: "view_item", label: "Просмотры товаров" },
  { key: "add_to_cart", label: "Добавили в корзину" },
  { key: "begin_checkout", label: "Начали оформление" },
  { key: "purchase", label: "Оплатили" },
];

// ───────────────────────── SQL pieces ─────────────────────────

async function paidOrdersByDay(from: Date, to: Date) {
  const rows = await prisma.$queryRaw<{ d: Date; gmv: number; orders: bigint }[]>(Prisma.sql`
    SELECT date_trunc('day', o."paidAt")::date AS d, COALESCE(SUM(o.total),0)::float8 AS gmv, COUNT(*) AS orders
    FROM "Order" o
    WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} AND o.status NOT IN ${EXCLUDED_STATUSES}
    GROUP BY 1`);
  return new Map(rows.map((r) => [dateKey(r.d), { gmv: num(r.gmv), orders: num(r.orders) }]));
}

async function revenueByDay(from: Date, to: Date) {
  const rows = await prisma.$queryRaw<{ d: Date; fee: number }[]>(Prisma.sql`
    SELECT date_trunc('day', o."paidAt")::date AS d, COALESCE(SUM(oi."commissionAmount"),0)::float8 AS fee
    FROM "Order" o JOIN "OrderItem" oi ON oi."orderId" = o.id
    WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} AND o.status NOT IN ${EXCLUDED_STATUSES} AND oi.status <> 'REFUNDED'
    GROUP BY 1`);
  return new Map(rows.map((r) => [dateKey(r.d), num(r.fee)]));
}

async function createdOrdersByDay(from: Date, to: Date) {
  const rows = await prisma.$queryRaw<{ d: Date; c: bigint }[]>(Prisma.sql`
    SELECT date_trunc('day', o."createdAt")::date AS d, COUNT(*) AS c FROM "Order" o
    WHERE o."createdAt" >= ${from} AND o."createdAt" < ${to} GROUP BY 1`);
  return new Map(rows.map((r) => [dateKey(r.d), num(r.c)]));
}

async function newUsersByDay(from: Date, to: Date) {
  const rows = await prisma.$queryRaw<{ d: Date; c: bigint }[]>(Prisma.sql`
    SELECT date_trunc('day', u."createdAt")::date AS d, COUNT(*) AS c FROM "User" u
    WHERE u."createdAt" >= ${from} AND u."createdAt" < ${to} GROUP BY 1`);
  return new Map(rows.map((r) => [dateKey(r.d), num(r.c)]));
}

/** Orders that were paid in [from,to) (any final status) and how many of them ended up REFUNDED. */
async function refundStats(from: Date, to: Date) {
  const rows = await prisma.$queryRaw<{ paid: bigint; refunded: bigint }[]>(Prisma.sql`
    SELECT COUNT(*) AS paid, COUNT(*) FILTER (WHERE o.status = 'REFUNDED') AS refunded
    FROM "Order" o WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to}`);
  return { paid: num(rows[0]?.paid), refunded: num(rows[0]?.refunded) };
}

async function activeSellers(from: Date, to: Date) {
  const rows = await prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`
    SELECT COUNT(DISTINCT oi."sellerId") AS c
    FROM "Order" o JOIN "OrderItem" oi ON oi."orderId" = o.id
    WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} AND o.status NOT IN ${EXCLUDED_STATUSES} AND oi.status <> 'REFUNDED'`);
  return num(rows[0]?.c);
}

/** Per-day distinct visitors (user id or anonymous session) and distinct sessions, live from AnalyticsEvent. */
async function trafficByDay(from: Date, to: Date) {
  const rows = await prisma.$queryRaw<{ d: Date; dau: bigint; sessions: bigint }[]>(Prisma.sql`
    SELECT date_trunc('day', e."createdAt")::date AS d,
           COUNT(DISTINCT COALESCE(e."userId", e."sessionId")) AS dau,
           COUNT(DISTINCT e."sessionId") AS sessions
    FROM "AnalyticsEvent" e
    WHERE e."createdAt" >= ${from} AND e."createdAt" < ${to}
    GROUP BY 1`);
  return new Map(rows.map((r) => [dateKey(r.d), { dau: num(r.dau), sessions: num(r.sessions) }]));
}

async function snapshots(from: Date, to: Date) {
  const rows = await prisma.dailyMetric.findMany({ where: { date: { gte: from, lt: to } }, select: { date: true, sessions: true } });
  return new Map(rows.map((r) => [isoDate(r.date), r]));
}

async function categoryBreakdown(from: Date, to: Date): Promise<CategorySlice[]> {
  const rows = await prisma.$queryRaw<{ name: string; orders: bigint; revenue: number }[]>(Prisma.sql`
    SELECT COALESCE(pc.name, c.name) AS name, COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(oi.total),0)::float8 AS revenue
    FROM "Order" o
    JOIN "OrderItem" oi ON oi."orderId" = o.id
    JOIN "Product" p ON p.id = oi."productId"
    JOIN "Category" c ON c.id = p."categoryId"
    LEFT JOIN "Category" pc ON pc.id = c."parentId"
    WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} AND o.status NOT IN ${EXCLUDED_STATUSES} AND oi.status <> 'REFUNDED'
    GROUP BY 1 ORDER BY orders DESC, revenue DESC LIMIT 12`);
  return rows.map((r) => ({ name: r.name, orders: num(r.orders), revenue: num(r.revenue) }));
}

async function paymentBreakdown(from: Date, to: Date): Promise<PaymentSlice[]> {
  const rows = await prisma.$queryRaw<{ provider: string; orders: bigint; amount: number }[]>(Prisma.sql`
    SELECT pay.provider::text AS provider, COUNT(*) AS orders, COALESCE(SUM(pay.amount),0)::float8 AS amount
    FROM "Payment" pay JOIN "Order" o ON o.id = pay."orderId"
    WHERE pay.status = 'PAID' AND pay.purpose = 'ORDER' AND pay."paidAt" >= ${from} AND pay."paidAt" < ${to}
      AND o.status NOT IN ${EXCLUDED_STATUSES}
    GROUP BY 1 ORDER BY orders DESC`);
  return rows.map((r) => ({ provider: r.provider, label: PAYMENT_LABELS[r.provider] ?? r.provider, orders: num(r.orders), amount: num(r.amount) }));
}

async function funnel(from: Date, to: Date): Promise<FunnelStep[]> {
  const rows = await prisma.$queryRaw<{ name: string; c: bigint }[]>(Prisma.sql`
    SELECT e.name, COUNT(DISTINCT COALESCE(e."sessionId", e."userId", e.id)) AS c
    FROM "AnalyticsEvent" e
    WHERE e."createdAt" >= ${from} AND e."createdAt" < ${to}
      AND e.name IN ('page_view','view_item','add_to_cart','begin_checkout','purchase')
    GROUP BY 1`);
  const by = new Map(rows.map((r) => [r.name, num(r.c)]));
  const first = by.get("page_view") ?? 0;
  let prev = first;
  return FUNNEL_STEPS.map((s, i) => {
    const count = by.get(s.key) ?? 0;
    const step: FunnelStep = { ...s, count, ofFirst: i === 0 ? 100 : ratioPct(count, first), ofPrev: i === 0 ? 100 : ratioPct(count, prev) };
    prev = count;
    return step;
  });
}

async function topProducts(from: Date, to: Date): Promise<TopProduct[]> {
  const rows = await prisma.$queryRaw<{ id: string; title: string; slug: string; seller: string | null; units: bigint; revenue: number }[]>(Prisma.sql`
    SELECT p.id, p.title, p.slug, COALESCE(sp."shopName", u.name, u.email) AS seller,
           COALESCE(SUM(oi.quantity),0) AS units, COALESCE(SUM(oi.total),0)::float8 AS revenue
    FROM "Order" o
    JOIN "OrderItem" oi ON oi."orderId" = o.id
    JOIN "Product" p ON p.id = oi."productId"
    JOIN "User" u ON u.id = p."sellerId"
    LEFT JOIN "SellerProfile" sp ON sp."userId" = u.id
    WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} AND o.status NOT IN ${EXCLUDED_STATUSES} AND oi.status <> 'REFUNDED'
    GROUP BY p.id, p.title, p.slug, sp."shopName", u.name, u.email
    ORDER BY revenue DESC LIMIT 10`);
  return rows.map((r) => ({ id: r.id, title: r.title, slug: r.slug, seller: r.seller ?? "—", units: num(r.units), revenue: num(r.revenue) }));
}

async function topSellers(from: Date, to: Date): Promise<TopSeller[]> {
  const rows = await prisma.$queryRaw<{ id: string; shop: string | null; slug: string | null; orders: bigint; revenue: number; fee: number }[]>(Prisma.sql`
    SELECT oi."sellerId" AS id, COALESCE(sp."shopName", u.name, u.email) AS shop, sp.slug AS slug,
           COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(oi.total),0)::float8 AS revenue, COALESCE(SUM(oi."commissionAmount"),0)::float8 AS fee
    FROM "Order" o
    JOIN "OrderItem" oi ON oi."orderId" = o.id
    JOIN "User" u ON u.id = oi."sellerId"
    LEFT JOIN "SellerProfile" sp ON sp."userId" = u.id
    WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} AND o.status NOT IN ${EXCLUDED_STATUSES} AND oi.status <> 'REFUNDED'
    GROUP BY oi."sellerId", sp."shopName", sp.slug, u.name, u.email
    ORDER BY revenue DESC LIMIT 10`);
  return rows.map((r) => ({ id: r.id, shopName: r.shop ?? "—", slug: r.slug, orders: num(r.orders), revenue: num(r.revenue), fee: num(r.fee) }));
}

/** Distinct visitors in the 30 UTC days ending at `to` (exclusive). */
async function monthlyActive(to: Date): Promise<number> {
  const from = new Date(to.getTime() - 30 * 86_400_000);
  const rows = await prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`
    SELECT COUNT(DISTINCT COALESCE(e."userId", e."sessionId")) AS c FROM "AnalyticsEvent" e
    WHERE e."createdAt" >= ${from} AND e."createdAt" < ${to}`);
  return num(rows[0]?.c);
}

/**
 * Weekly signup cohorts (last 8 weeks). A user counts as retained in week N when they have any analytics event or order
 * N weeks after the signup week. Week 0 is the signup week itself (always 100 % by construction of the cohort).
 */
export async function retentionCohorts(now: Date = new Date(), weeks = 8): Promise<RetentionRow[]> {
  const today = startOfUtcDay(now);
  // Monday of the current ISO week
  const dow = (today.getUTCDay() + 6) % 7;
  const thisWeek = new Date(today.getTime() - dow * 86_400_000);
  const firstWeek = new Date(thisWeek.getTime() - (weeks - 1) * 7 * 86_400_000);
  const rows = await prisma.$queryRaw<{ cohort: Date; wk: number; users: bigint }[]>(Prisma.sql`
    WITH cohorts AS (
      SELECT u.id, date_trunc('week', u."createdAt")::date AS cohort FROM "User" u WHERE u."createdAt" >= ${firstWeek}
    ), activity AS (
      SELECT e."userId" AS uid, date_trunc('week', e."createdAt")::date AS wk FROM "AnalyticsEvent" e
        WHERE e."userId" IS NOT NULL AND e."createdAt" >= ${firstWeek}
      UNION
      SELECT o."buyerId", date_trunc('week', o."createdAt")::date FROM "Order" o WHERE o."createdAt" >= ${firstWeek}
    )
    SELECT c.cohort, ((a.wk - c.cohort) / 7)::int AS wk, COUNT(DISTINCT c.id) AS users
    FROM cohorts c LEFT JOIN activity a ON a.uid = c.id AND a.wk >= c.cohort
    GROUP BY 1, 2 ORDER BY 1, 2`);
  const sizes = await prisma.$queryRaw<{ cohort: Date; size: bigint }[]>(Prisma.sql`
    SELECT date_trunc('week', u."createdAt")::date AS cohort, COUNT(*) AS size FROM "User" u WHERE u."createdAt" >= ${firstWeek} GROUP BY 1 ORDER BY 1`);

  const out: RetentionRow[] = [];
  for (const s of sizes) {
    const cohort = dateKey(s.cohort);
    const size = num(s.size);
    const weeksSince = Math.floor((thisWeek.getTime() - new Date(cohort).getTime()) / (7 * 86_400_000));
    const cells: (number | null)[] = Array.from({ length: weeks }, (_, i) => (i <= weeksSince ? 0 : null));
    for (const r of rows) {
      if (dateKey(r.cohort) !== cohort || r.wk === null || r.wk === undefined) continue;
      const idx = num(r.wk);
      if (idx >= 0 && idx < weeks && cells[idx] !== null) cells[idx] = Math.round(ratioPct(num(r.users), size) * 10) / 10;
    }
    if (cells[0] !== null) cells[0] = 100; // by definition; activity rows may be missing for the signup week
    out.push({ cohort, size, weeks: cells });
  }
  return out;
}

// ───────────────────────── assembly ─────────────────────────

type DailyRow = { date: string; gmv: number; orders: number; revenue: number; created: number; newUsers: number };
type DailySums = Omit<DailyRow, "date">;

/** Σ of every numeric column over the UTC dates in [from, to). */
function sumPeriod(rows: DailyRow[], from: string, to: string): DailySums {
  const t: DailySums = { gmv: 0, orders: 0, revenue: 0, created: 0, newUsers: 0 };
  for (const r of rows) {
    if (r.date < from || r.date >= to) continue;
    t.gmv += r.gmv;
    t.orders += r.orders;
    t.revenue += r.revenue;
    t.created += r.created;
    t.newUsers += r.newUsers;
  }
  return t;
}

async function computeDashboard(win: PeriodWindow): Promise<DashboardMetrics> {
  const { days, from, to, prevFrom, prevTo } = win;
  const today = startOfUtcDay(new Date());

  const [paid, revenue, created, users, traffic, snaps, refCur, refPrev, sellersCur, sellersPrev, byCategory, payments, steps, products, sellers, mau, retention] = await Promise.all([
    paidOrdersByDay(prevFrom, to),
    revenueByDay(prevFrom, to),
    createdOrdersByDay(prevFrom, to),
    newUsersByDay(prevFrom, to),
    trafficByDay(from, to),
    snapshots(from, today), // closed days only
    refundStats(from, to),
    refundStats(prevFrom, prevTo),
    activeSellers(from, to),
    activeSellers(prevFrom, prevTo),
    categoryBreakdown(from, to),
    paymentBreakdown(from, to),
    funnel(from, to),
    topProducts(from, to),
    topSellers(from, to),
    monthlyActive(to),
    retentionCohorts(),
  ]);

  const allDays = eachDay(prevFrom, to);
  const daily = allDays.map((date) => ({
    date,
    gmv: paid.get(date)?.gmv ?? 0,
    orders: paid.get(date)?.orders ?? 0,
    revenue: revenue.get(date) ?? 0,
    created: created.get(date) ?? 0,
    newUsers: users.get(date) ?? 0,
  }));

  const fromKey = isoDate(from);
  const toKey = isoDate(to);
  const prevFromKey = isoDate(prevFrom);

  let snapshotDays = 0;
  const series: DayPoint[] = daily
    .filter((d) => d.date >= fromKey && d.date < toKey)
    .map((d) => {
      const snap = snaps.get(d.date);
      const live = traffic.get(d.date);
      if (snap) snapshotDays++;
      return {
        date: d.date,
        gmv: d.gmv,
        revenue: d.revenue,
        orders: d.orders,
        newUsers: d.newUsers,
        dau: live?.dau ?? 0,
        sessions: snap ? snap.sessions : (live?.sessions ?? 0),
      };
    });

  const cur = sumPeriod(daily, fromKey, toKey);
  const prev = sumPeriod(daily, prevFromKey, fromKey);

  const aov = (t: { gmv: number; orders: number }) => (t.orders ? Math.round(t.gmv / t.orders) : 0);
  const conv = (t: { orders: number; created: number }) => ratioPct(t.orders, t.created);
  const refundRate = (r: { paid: number; refunded: number }) => ratioPct(r.refunded, r.paid);

  const mk = (k: Omit<Kpi, "deltaPct">): Kpi => ({
    ...k,
    deltaPct: deltaPct(k.value, k.previous),
    ...(k.format === "percent" ? { deltaPoints: k.value - k.previous } : {}),
  });
  const kpis: Kpi[] = [
    mk({ key: "gmv", label: "GMV (оборот)", value: cur.gmv, previous: prev.gmv, format: "money", hint: "Сумма оплаченных заказов" }),
    mk({ key: "revenue", label: "Чистая выручка", value: cur.revenue, previous: prev.revenue, format: "money", hint: "Комиссия площадки" }),
    mk({ key: "orders", label: "Оплаченные заказы", value: cur.orders, previous: prev.orders, format: "int" }),
    mk({ key: "conversion", label: "Конверсия в оплату", value: conv(cur), previous: conv(prev), format: "percent", hint: "Оплачено / создано заказов" }),
    mk({ key: "aov", label: "Средний чек", value: aov(cur), previous: aov(prev), format: "money" }),
    mk({ key: "newUsers", label: "Новые пользователи", value: cur.newUsers, previous: prev.newUsers, format: "int" }),
    mk({ key: "activeSellers", label: "Активные продавцы", value: sellersCur, previous: sellersPrev, format: "int", hint: "С продажами за период" }),
    mk({ key: "refundRate", label: "Доля возвратов", value: refundRate(refCur), previous: refundRate(refPrev), format: "percent", invert: true, hint: "Возвращённые / оплаченные" }),
  ];

  const last7 = series.slice(-7);
  const dauAvg7 = last7.length ? last7.reduce((s, p) => s + p.dau, 0) / last7.length : 0;
  const lastClosed = series.length >= 2 ? series[series.length - 2] : series[series.length - 1];
  const engagement = {
    dauAvg7: Math.round(dauAvg7),
    dauLastDay: lastClosed?.dau ?? 0,
    mau,
    stickiness: mau ? Math.min(100, ratioPct(dauAvg7, mau)) : 0,
    sessions: series.reduce((s, p) => s + p.sessions, 0),
  };

  return {
    days,
    from: fromKey,
    to: isoDate(new Date(to.getTime() - 86_400_000)),
    prevFrom: prevFromKey,
    prevTo: isoDate(new Date(prevTo.getTime() - 86_400_000)),
    generatedAt: new Date().toISOString(),
    kpis,
    series,
    byCategory,
    payments,
    funnel: steps,
    topProducts: products,
    topSellers: sellers,
    engagement,
    retention,
    snapshotDays,
  };
}

/** Dashboard payload for the last `days` days; Redis-cached for 5 minutes. */
export async function getDashboardMetrics(days: PeriodDays | string | number = 30): Promise<DashboardMetrics> {
  const period = parsePeriod(String(days));
  return cached(cacheKey(period), METRICS_TTL_SEC, () => computeDashboard(periodWindow(period)));
}

/** Drop the cached payloads (the «Обновить» button). */
export async function invalidateDashboardCache(): Promise<void> {
  try {
    await redis.del(...PERIOD_OPTIONS.map((d) => `cache:${cacheKey(d)}`));
  } catch {
    /* cache is best-effort */
  }
}
