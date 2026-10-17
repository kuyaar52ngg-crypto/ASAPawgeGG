import { jsonOk } from "@/lib/api";
import { ApiHttpError, apiRoute } from "@/server/api-keys";
import { failToHttp, readBody } from "@/server/api-v1/http";
import { moderateBodySchema } from "@/server/api-v1/schemas";
import { moderateProduct } from "@/server/admin/products";
import { ipFromRequest } from "@/lib/request";

export const dynamic = "force-dynamic";

/** POST /api/v1/admin/products/{id}/moderate — body { decision: "approve"|"reject"|"archive", reason? } (reason required for reject). Audited. */
export const POST = apiRoute<{ id: string }>({ scope: "admin:moderate" }, async ({ req, principal, params }) => {
  if (principal.role !== "ADMIN") throw new ApiHttpError(403, "forbidden", "Только для администраторов");
  const body = await readBody(req, moderateBodySchema);
  const res = await moderateProduct({ admin: principal.user, ip: ipFromRequest(req) }, { productId: params.id, ...body });
  if (!res.ok) throw failToHttp(res, 409);
  return jsonOk(res.data);
});
