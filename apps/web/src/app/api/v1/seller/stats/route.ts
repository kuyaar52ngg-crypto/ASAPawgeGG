import { jsonOk } from "@/lib/api";
import { ApiHttpError, apiRoute } from "@/server/api-keys";
import { readQuery } from "@/server/api-v1/http";
import { daysQuerySchema } from "@/server/api-v1/schemas";
import { sellerCtxForUser } from "@/server/cabinet/seller-context";
import { getSalesReport, getSellerAttention } from "@/server/cabinet/seller-stats";

export const dynamic = "force-dynamic";

/** GET /api/v1/seller/stats?days=30 — sales report + things that need attention + balances. Money in kopecks. */
export const GET = apiRoute({ scope: "seller:stats" }, async ({ req, principal }) => {
  if (principal.role === "USER") throw new ApiHttpError(403, "forbidden", "Только для продавцов");
  const { days } = readQuery(req, daysQuerySchema);
  const ctx = await sellerCtxForUser(principal.user);
  const [report, attention] = await Promise.all([getSalesReport(ctx.user.id, days), getSellerAttention(ctx.user.id)]);
  return jsonOk({
    shop: { name: ctx.profile.shopName, status: ctx.profile.status, rating: ctx.profile.rating, salesCount: ctx.profile.salesCount },
    balances: { hold: ctx.profile.holdBalance, available: ctx.profile.availableBalance, currency: "RUB" },
    report,
    attention,
  });
});
