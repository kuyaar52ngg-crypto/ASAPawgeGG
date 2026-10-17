import { jsonOk } from "@/lib/api";
import { ApiHttpError, apiRoute } from "@/server/api-keys";
import { getOwnOrder } from "@/server/api-v1/orders";

export const dynamic = "force-dynamic";

/** GET /api/v1/orders/{id|number} — one own order; includes decrypted delivered content (keys) once delivered. */
export const GET = apiRoute<{ id: string }>({ scope: "orders:read" }, async ({ principal, params }) => {
  const order = await getOwnOrder(principal.user.id, params.id.slice(0, 64));
  if (!order) throw new ApiHttpError(404, "not_found", "Заказ не найден");
  return jsonOk(order);
});
