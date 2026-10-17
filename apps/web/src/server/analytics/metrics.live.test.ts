import { describe, expect, it } from "vitest";

// Live check against the dev DB (skipped unless LIVE_DB=1): pnpm --filter @asap/web exec dotenv -e ../../.env -- env LIVE_DB=1 vitest run src/server/analytics/metrics.live
const live = process.env.LIVE_DB === "1";

describe.skipIf(!live)("getDashboardMetrics (live DB)", () => {
  it("computes sane KPIs", async () => {
    const { getDashboardMetrics } = await import("./metrics");
    const m = await getDashboardMetrics(30);
    console.log(JSON.stringify({ kpis: m.kpis.map((k) => [k.key, k.value, k.previous, k.deltaPct]), cat: m.byCategory, pay: m.payments, funnel: m.funnel.map((f) => [f.key, f.count, f.ofPrev]), eng: m.engagement, snap: m.snapshotDays, top: m.topProducts.slice(0, 2), sellers: m.topSellers.slice(0, 2), ret: m.retention, first: m.series[0], last: m.series.at(-1), n: m.series.length }, null, 1));
    expect(m.series).toHaveLength(30);
    expect(m.kpis).toHaveLength(8);
  });
});
