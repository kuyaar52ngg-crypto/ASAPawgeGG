import "server-only";
import { Prisma, prisma } from "@asap/db";
import { cached } from "@/lib/redis";
import { num } from "./metrics";
import { parsePeriod, periodWindow } from "./range";
import type { PeriodDays, TrafficReport } from "./types";

/** First-party traffic report for /admin/analytics (AnalyticsEvent aggregates, cached 5 min). */
export async function getTrafficReport(days: PeriodDays | string | number = 30): Promise<TrafficReport> {
  const period = parsePeriod(String(days));
  return cached(`admin:traffic:v1:${period}`, 300, async () => {
    const { from, to } = periodWindow(period);
    const [events, pages, refs, searches, totals] = await Promise.all([
      prisma.$queryRaw<{ name: string; c: bigint; u: bigint }[]>(Prisma.sql`
        SELECT e.name, COUNT(*) AS c, COUNT(DISTINCT COALESCE(e."sessionId", e."userId")) AS u FROM "AnalyticsEvent" e
        WHERE e."createdAt" >= ${from} AND e."createdAt" < ${to} GROUP BY 1 ORDER BY c DESC`),
      prisma.$queryRaw<{ path: string; c: bigint }[]>(Prisma.sql`
        SELECT split_part(e.path, '?', 1) AS path, COUNT(*) AS c FROM "AnalyticsEvent" e
        WHERE e.name = 'page_view' AND e.path IS NOT NULL AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
        GROUP BY 1 ORDER BY c DESC LIMIT 12`),
      prisma.$queryRaw<{ referrer: string; c: bigint }[]>(Prisma.sql`
        SELECT COALESCE(NULLIF(substring(e.referrer from '^https?://([^/]+)'), ''), 'Прямые заходы') AS referrer, COUNT(*) AS c
        FROM "AnalyticsEvent" e
        WHERE e.name = 'page_view' AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
        GROUP BY 1 ORDER BY c DESC LIMIT 8`),
      prisma.$queryRaw<{ q: string; c: bigint }[]>(Prisma.sql`
        SELECT lower(trim(e.properties->>'q')) AS q, COUNT(*) AS c FROM "AnalyticsEvent" e
        WHERE e.name = 'search' AND e.properties->>'q' IS NOT NULL AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
        GROUP BY 1 HAVING lower(trim(e.properties->>'q')) <> '' ORDER BY c DESC LIMIT 10`),
      prisma.$queryRaw<{ total: bigint; sessions: bigint }[]>(Prisma.sql`
        SELECT COUNT(*) AS total, COUNT(DISTINCT e."sessionId") AS sessions FROM "AnalyticsEvent" e
        WHERE e."createdAt" >= ${from} AND e."createdAt" < ${to}`),
    ]);
    return {
      days: period,
      events: events.map((r) => ({ name: r.name, count: num(r.c), uniques: num(r.u) })),
      topPages: pages.map((r) => ({ path: r.path, views: num(r.c) })),
      topReferrers: refs.map((r) => ({ referrer: r.referrer, visits: num(r.c) })),
      topSearches: searches.map((r) => ({ q: r.q, count: num(r.c) })),
      totalEvents: num(totals[0]?.total),
      sessions: num(totals[0]?.sessions),
    };
  });
}
