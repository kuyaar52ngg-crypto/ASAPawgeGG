import { z } from "zod";
import { jsonOk } from "@/lib/api";
import { ApiHttpError, apiRoute } from "@/server/api-keys";
import { failToHttp, readBody } from "@/server/api-v1/http";
import { sellerCtxForUser } from "@/server/cabinet/seller-context";
import { saveProduct } from "@/server/cabinet/products";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/seller/products — create a product (draft by default; `"intent": "submit"` sends it to moderation,
 * VERIFIED sellers only). Body = the cabinet product form: { title, categoryId, type, deliveryMode: AUTO_STOCK|MANUAL,
 * description, price (kopecks), images[], tags[], variants[], platform?, region?, shortDescription?, instructions?, oldPrice?, intent? }.
 */
export const POST = apiRoute({ scope: "seller:products" }, async ({ req, principal }) => {
  if (principal.role === "USER") throw new ApiHttpError(403, "forbidden", "Только для продавцов");
  const body = await readBody(req, z.record(z.string(), z.unknown()));
  const ctx = await sellerCtxForUser(principal.user);
  if (!ctx.canWrite) throw new ApiHttpError(403, "seller_blocked", "Профиль продавца заблокирован или отклонён");
  const res = await saveProduct(ctx, null, { intent: "draft", ...body });
  if (!res.ok) throw failToHttp(res);
  return jsonOk(res.data, { status: 201 });
});
