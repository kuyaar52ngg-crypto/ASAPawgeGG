import "server-only";
import { prisma } from "@asap/db";
import { redis, redisEnabled, withLock } from "@/lib/redis";
import type { SessionUser } from "@/server/auth/session";
import { parseItemMeta } from "@/server/cart/meta";
import { CheckoutError, cancelOrder, createOrderFromItems, getOrderDelivery, loadOrderSourceItems } from "@/server/orders";
import { payOrderWithBalance } from "@/server/payments/initiate";
import { ApiHttpError } from "@/server/api-keys";
import { orderDto, orderSelect } from "./dto";
import type { CreateOrderBody } from "./schemas";

/** Reads one of the buyer's own orders (by id or public number) and, when it is delivered, its decrypted content. */
export async function getOwnOrder(buyerId: string, idOrNumber: string) {
  const order = await prisma.order.findFirst({ where: { buyerId, OR: [{ id: idOrNumber }, { number: idOrNumber.toUpperCase() }] }, select: orderSelect });
  if (!order) return null;
  const delivery = await getOrderDelivery(order.id, buyerId);
  return orderDto(order, delivery);
}

const IDEM_TTL_SEC = 24 * 3600;

/** Idempotency-Key -> order id. Redis when available, otherwise the `Setting` table (no Redis on Vercel); entries older than the TTL are ignored. */
async function idemGet(key: string): Promise<string | null> {
  if (redisEnabled) return redis.get(key).catch(() => null);
  const row = await prisma.setting.findUnique({ where: { key }, select: { value: true, updatedAt: true } }).catch(() => null);
  return row && typeof row.value === "string" && Date.now() - row.updatedAt.getTime() < IDEM_TTL_SEC * 1000 ? row.value : null;
}

async function idemSet(key: string, orderId: string): Promise<void> {
  if (redisEnabled) {
    await redis.set(key, orderId, "EX", IDEM_TTL_SEC).catch(() => {});
    return;
  }
  await prisma.setting.upsert({ where: { key }, create: { key, value: orderId }, update: { value: orderId } }).catch(() => {});
}

async function waitForFulfilment(orderId: string, buyerId: string, maxMs: number) {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const o = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!o || !["PAID", "PROCESSING"].includes(o.status) || Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 350));
  }
  return getOwnOrder(buyerId, orderId);
}

/**
 * Buy from the site balance (the only API payment method). One order = create (stock reserved) → pay (atomic balance debit).
 * Insufficient funds never leaves a reservation behind: the order is cancelled. `idempotencyKey` makes retries safe.
 */
export async function placeOrderFromBalance(user: SessionUser, body: CreateOrderBody, meta: { idempotencyKey?: string | null; ip?: string | null; userAgent?: string | null }) {
  const idemKey = meta.idempotencyKey ? `api:idem:orders:${user.id}:${meta.idempotencyKey.slice(0, 120)}` : null;

  const run = async () => {
    if (idemKey) {
      const prev = await idemGet(idemKey);
      if (prev) {
        const existing = await getOwnOrder(user.id, prev);
        if (existing) return { order: existing, replay: true };
      }
    }
    let sources;
    try {
      sources = await loadOrderSourceItems(
        body.items.map((i) => {
          const parsed = parseItemMeta({ steamLogin: i.steamLogin, amountKopecks: i.amountKopecks, buyerInput: i.buyerInput });
          if (!parsed.ok) throw new CheckoutError(parsed.error, "INPUT_REQUIRED");
          return { productId: i.productId, variantId: i.variantId ?? null, quantity: i.quantity, meta: parsed.meta };
        }),
      );
    } catch (e) {
      throw mapCheckoutError(e);
    }

    // cheap pre-check; the authoritative guarded debit happens in payOrderWithBalance
    let created;
    try {
      created = await createOrderFromItems({ userId: user.id, email: user.email, promoCode: body.promoCode, ip: meta.ip, userAgent: meta.userAgent, paymentMethod: "api_balance" }, sources);
    } catch (e) {
      throw mapCheckoutError(e);
    }
    const fresh = await prisma.user.findUnique({ where: { id: user.id }, select: { balance: true } });
    if ((fresh?.balance ?? 0) < created.total) {
      await cancelOrder(created.id, { buyerId: user.id });
      throw new ApiHttpError(402, "insufficient_funds", "Недостаточно средств на балансе", { required: created.total, balance: fresh?.balance ?? 0, currency: "RUB" });
    }
    const paid = await payOrderWithBalance(created.id, user.id);
    if (!paid.ok) {
      await cancelOrder(created.id, { buyerId: user.id });
      throw new ApiHttpError(/средств/i.test(paid.error) ? 402 : 409, /средств/i.test(paid.error) ? "insufficient_funds" : "payment_failed", paid.error);
    }
    if (idemKey) await idemSet(idemKey, created.id);
    const order = await waitForFulfilment(created.id, user.id, 4000);
    return { order: order!, replay: false };
  };

  if (!idemKey) return run();
  const locked = await withLock(`api-order:${idemKey}`, 30_000, run);
  if (locked === null) throw new ApiHttpError(409, "request_in_progress", "Запрос с этим Idempotency-Key ещё выполняется");
  return locked;
}

function mapCheckoutError(e: unknown): unknown {
  if (e instanceof CheckoutError) {
    const status = e.code === "OUT_OF_STOCK" ? 409 : e.code === "UNAVAILABLE" || e.code === "OWN_PRODUCT" ? 422 : 422;
    return new ApiHttpError(status, e.code.toLowerCase(), e.message);
  }
  return e;
}
