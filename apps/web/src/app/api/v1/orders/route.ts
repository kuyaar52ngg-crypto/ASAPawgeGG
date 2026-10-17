import { prisma } from "@asap/db";
import { jsonOk } from "@/lib/api";
import { apiRoute } from "@/server/api-keys";
import { orderDto, orderSelect } from "@/server/api-v1/dto";
import { readBody, readQuery } from "@/server/api-v1/http";
import { placeOrderFromBalance } from "@/server/api-v1/orders";
import { createOrderSchema, listOrdersQuerySchema } from "@/server/api-v1/schemas";
import { ipFromRequest } from "@/lib/request";
import { rateLimit } from "@/lib/rate-limit";
import { ApiHttpError } from "@/server/api-keys";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/v1/orders?status=&page=&pageSize= — own orders (no delivered content; fetch one order for that). */
export const GET = apiRoute({ scope: "orders:read" }, async ({ req, principal }) => {
  const q = readQuery(req, listOrdersQuerySchema);
  const where = { buyerId: principal.user.id, ...(q.status ? { status: q.status } : {}) };
  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: orderSelect }),
  ]);
  return jsonOk({ items: rows.map((o) => orderDto(o)), total, page: q.page, pageSize: q.pageSize, pageCount: Math.max(1, Math.ceil(total / q.pageSize)) });
});

/**
 * POST /api/v1/orders — buy and pay from the site balance.
 * Body: { items: [{ productId, variantId?, quantity, steamLogin?, amountKopecks?, buyerInput? }], promoCode? }
 * Header `Idempotency-Key` (optional) makes retries return the same order. 402 when the balance is too low.
 * The response already contains delivered content when delivery finished within a few seconds.
 */
export const POST = apiRoute({ scope: "orders:create" }, async ({ req, principal }) => {
  const rl = await rateLimit({ key: `api-order:${principal.user.id}`, limit: 30, windowSec: 3600 });
  if (!rl.ok) throw new ApiHttpError(429, "rate_limited", "Не больше 30 заказов в час через API");
  const body = await readBody(req, createOrderSchema);
  const { order, replay } = await placeOrderFromBalance(principal.user, body, { idempotencyKey: req.headers.get("idempotency-key"), ip: ipFromRequest(req), userAgent: req.headers.get("user-agent") });
  return jsonOk(order, { status: replay ? 200 : 201, headers: replay ? { "Idempotent-Replay": "true" } : undefined });
});
