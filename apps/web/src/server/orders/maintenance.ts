import "server-only";
import { prisma } from "@asap/db";
import { redis } from "@/lib/redis";
import { cancelOrder } from "./lifecycle";

/** Unpaid orders are cancelled after this many minutes (CONTRACTS §7 `expire_pending_orders`). */
export const PENDING_ORDER_TTL_MINUTES = 30;

/**
 * Free RESERVED stock whose reservation expired and whose order is not paid (still PENDING, cancelled, failed) or has no order.
 * Safe to call any time; paid orders have `reservedUntil = NULL` and are never touched. Exposed for worker cron
 * (POST /api/payments/maintenance) and used opportunistically at checkout.
 */
export async function releaseExpiredReservations(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "StockItem" s SET status = 'AVAILABLE', "reservedUntil" = NULL, "orderItemId" = NULL
    WHERE s.status = 'RESERVED' AND s."reservedUntil" IS NOT NULL AND s."reservedUntil" < now()
      AND (s."orderItemId" IS NULL OR NOT EXISTS (
        SELECT 1 FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
        WHERE oi.id = s."orderItemId" AND o.status NOT IN ('PENDING', 'CANCELLED', 'FAILED')))`;
}

/** At most once per minute per process cluster (Redis NX); never throws. */
export async function releaseExpiredReservationsThrottled(): Promise<void> {
  try {
    const ok = await redis.set("throttle:release-reservations", "1", "EX", 60, "NX");
    if (ok !== "OK") return;
  } catch {
    /* redis down: just run it */
  }
  try {
    await releaseExpiredReservations();
  } catch (e) {
    console.warn("[orders] releaseExpiredReservations failed:", (e as Error).message);
  }
}

/** PENDING orders older than the TTL -> CANCELLED (+ stock released, open payments cancelled). Returns cancelled count. */
export async function expirePendingOrders(olderThanMinutes = PENDING_ORDER_TTL_MINUTES): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const stale = await prisma.order.findMany({ where: { status: "PENDING", createdAt: { lt: cutoff } }, select: { id: true }, take: 500 });
  let cancelled = 0;
  for (const o of stale) {
    try {
      const r = await cancelOrder(o.id);
      if (r.ok) cancelled++;
    } catch (e) {
      console.warn(`[orders] expire ${o.id} failed:`, (e as Error).message);
    }
  }
  return cancelled;
}
