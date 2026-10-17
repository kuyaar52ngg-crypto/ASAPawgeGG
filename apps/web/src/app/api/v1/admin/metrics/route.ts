import { jsonOk } from "@/lib/api";
import { ApiHttpError, apiRoute } from "@/server/api-keys";
import { summarizeMetrics } from "@/server/ai";
import { readQuery } from "@/server/api-v1/http";
import { adminMetricsQuerySchema } from "@/server/api-v1/schemas";
import { getDashboardMetrics } from "@/server/analytics/metrics";
import { ruleBasedSummary } from "@/server/analytics/summary";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/v1/admin/metrics?days=7|30|90&summary=1 — dashboard metrics (same source as /admin); `summary=1` adds an AI/rule-based text. */
export const GET = apiRoute({ scope: "admin:metrics" }, async ({ req, principal }) => {
  if (principal.role !== "ADMIN") throw new ApiHttpError(403, "forbidden", "Только для администраторов");
  const q = readQuery(req, adminMetricsQuerySchema);
  const metrics = await getDashboardMetrics(q.days);
  if (q.summary !== "1" && q.summary !== "true") return jsonOk(metrics);
  const summary = await summarizeMetrics({ days: metrics.days, kpis: metrics.kpis, funnel: metrics.funnel, topProducts: metrics.topProducts.slice(0, 5), topSellers: metrics.topSellers.slice(0, 5), byCategory: metrics.byCategory.slice(0, 5) }, () => ruleBasedSummary(metrics), principal.user.id);
  return jsonOk({ ...metrics, summary: { text: summary.text, provider: summary.provider, mock: summary.mock } });
});
