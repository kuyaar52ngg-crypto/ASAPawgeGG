import { jsonOk } from "@/lib/api";
import { ApiHttpError, apiRoute } from "@/server/api-keys";
import { failToHttp, readBody } from "@/server/api-v1/http";
import { stockUploadBodySchema } from "@/server/api-v1/schemas";
import { sellerCtxForUser } from "@/server/cabinet/seller-context";
import { uploadStock } from "@/server/cabinet/stock";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/v1/seller/products/{id}/stock — body { items: string[], variantId? }; keys are encrypted at rest, duplicates skipped. */
export const POST = apiRoute<{ id: string }>({ scope: "seller:stock" }, async ({ req, principal, params }) => {
  if (principal.role === "USER") throw new ApiHttpError(403, "forbidden", "Только для продавцов");
  const body = await readBody(req, stockUploadBodySchema);
  const ctx = await sellerCtxForUser(principal.user);
  if (!ctx.canWrite) throw new ApiHttpError(403, "seller_blocked", "Профиль продавца заблокирован или отклонён");
  const res = await uploadStock(ctx, { productId: params.id, variantId: body.variantId ?? null, items: body.items });
  if (!res.ok) throw failToHttp(res, 404);
  return jsonOk(res.data);
});
