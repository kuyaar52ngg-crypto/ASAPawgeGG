import "server-only";
import { Prisma, prisma } from "@asap/db";

const TZ_OFFSET_MS = 3 * 3_600_000; // Europe/Moscow (no DST)
/** Order statuses whose money counts as sales. */
const SALE_STATUSES = ["PAID", "PROCESSING", "DELIVERED", "DISPUTED"] as const;

const mskKey = (d: Date) => new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);

export interface SalesPoint {
  date: string;
  revenue: number;
  earning: number;
  orders: number;
  units: number;
}
export interface TopProductRow {
  productId: string;
  title: string;
  revenue: number;
  units: number;
}
export interface SalesReport {
  days: number;
  series: SalesPoint[];
  totals: { revenue: number; earning: number; orders: number; units: number };
  today: { revenue: number; earning: number; orders: number };
  last7: { revenue: number; earning: number; orders: number };
  top: TopProductRow[];
  views: number;
  /** orders / product views, percent (null when no views were tracked) */
  conversion: number | null;
}

/** Sales of one seller over the last `days` Moscow days (paid orders, refunds excluded). Money in kopecks. */
export async function getSalesReport(sellerId: string, days: number): Promise<SalesReport> {
  const now = new Date();
  const todayKey = mskKey(now);
  const from = new Date(Date.parse(`${todayKey}T00:00:00+03:00`) - (days - 1) * 86_400_000);

  const [rows, top, viewsRow] = await Promise.all([
    prisma.$queryRaw<{ day: Date; revenue: number; earning: number; orders: number; units: number }[]>(Prisma.sql`
      SELECT ((o."paidAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::date AS day,
             COALESCE(SUM(oi.total), 0)::float8 AS revenue,
             COALESCE(SUM(oi."sellerEarning"), 0)::float8 AS earning,
             COUNT(DISTINCT o.id)::float8 AS orders,
             COALESCE(SUM(oi.quantity), 0)::float8 AS units
      FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
      WHERE oi."sellerId" = ${sellerId} AND o."paidAt" >= ${from}
        AND o.status::text IN (${Prisma.join([...SALE_STATUSES])}) AND oi.status::text <> 'REFUNDED'
      GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<{ productId: string; title: string; revenue: number; units: number }[]>(Prisma.sql`
      SELECT oi."productId", MAX(oi.title) AS title,
             COALESCE(SUM(oi.total), 0)::float8 AS revenue, COALESCE(SUM(oi.quantity), 0)::float8 AS units
      FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
      WHERE oi."sellerId" = ${sellerId} AND o."paidAt" >= ${from}
        AND o.status::text IN (${Prisma.join([...SALE_STATUSES])}) AND oi.status::text <> 'REFUNDED'
      GROUP BY oi."productId" ORDER BY revenue DESC LIMIT 8`),
    prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT COUNT(*)::float8 AS n FROM "AnalyticsEvent" e
      WHERE e.name = 'view_item' AND e."createdAt" >= ${from}
        AND e.properties->>'productId' IN (SELECT id FROM "Product" WHERE "sellerId" = ${sellerId})`),
  ]);

  const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), r]));
  const series: SalesPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = mskKey(new Date(now.getTime() - i * 86_400_000));
    const r = byDay.get(key);
    series.push({ date: key, revenue: Number(r?.revenue ?? 0), earning: Number(r?.earning ?? 0), orders: Number(r?.orders ?? 0), units: Number(r?.units ?? 0) });
  }
  const sum = (pts: SalesPoint[]) => pts.reduce((a, p) => ({ revenue: a.revenue + p.revenue, earning: a.earning + p.earning, orders: a.orders + p.orders, units: a.units + p.units }), { revenue: 0, earning: 0, orders: 0, units: 0 });
  const totals = sum(series);
  const views = Number(viewsRow[0]?.n ?? 0);
  return {
    days,
    series,
    totals,
    today: sum(series.slice(-1)),
    last7: sum(series.slice(-7)),
    top: top.map((t) => ({ productId: t.productId, title: t.title, revenue: Number(t.revenue), units: Number(t.units) })),
    views,
    conversion: views > 0 ? Math.min(100, Math.round((totals.orders / views) * 1000) / 10) : null,
  };
}

export interface SellerAttention {
  pendingManual: number;
  pendingReview: number;
  rejected: number;
  openDisputes: number;
  unansweredReviews: number;
  lowStock: { id: string; title: string; available: number }[];
  nextRelease: Date | null;
}

/** Things that need the seller's attention (dashboard). */
export async function getSellerAttention(sellerId: string): Promise<SellerAttention> {
  const [pendingManual, pendingReview, rejected, openDisputes, unansweredReviews, lowRows, next] = await Promise.all([
    prisma.orderItem.count({ where: { sellerId, status: { in: ["PENDING", "PROCESSING"] }, product: { deliveryMode: "MANUAL" }, order: { status: { in: ["PAID", "PROCESSING"] } } } }),
    prisma.product.count({ where: { sellerId, status: "PENDING_REVIEW" } }),
    prisma.product.count({ where: { sellerId, status: "REJECTED" } }),
    prisma.dispute.count({ where: { sellerId, status: { in: ["OPEN", "SELLER_REPLIED", "ESCALATED"] } } }),
    prisma.review.count({ where: { sellerId, reply: null, status: "PUBLISHED" } }),
    prisma.$queryRaw<{ id: string; title: string; available: number }[]>(Prisma.sql`
      SELECT p.id, p.title,
             (SELECT COUNT(*) FROM "StockItem" s WHERE s."productId" = p.id AND s.status = 'AVAILABLE')::float8 AS available
      FROM "Product" p
      WHERE p."sellerId" = ${sellerId} AND p.status = 'ACTIVE' AND p."deliveryMode" = 'AUTO_STOCK'
      ORDER BY available ASC LIMIT 5`),
    prisma.orderItem.aggregate({ where: { sellerId, holdReleased: false, status: "DELIVERED", holdReleaseAt: { gt: new Date() } }, _min: { holdReleaseAt: true } }),
  ]);
  return {
    pendingManual,
    pendingReview,
    rejected,
    openDisputes,
    unansweredReviews,
    lowStock: lowRows.map((r) => ({ id: r.id, title: r.title, available: Number(r.available) })).filter((r) => r.available < 5),
    nextRelease: next._min.holdReleaseAt,
  };
}
