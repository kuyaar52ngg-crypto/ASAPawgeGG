import "server-only";
import { Prisma } from "@asap/db";
import { STOCK_RESERVATION_MINUTES } from "@asap/shared";
import type { Tx } from "@/server/ledger/ledger";

export class OutOfStockError extends Error {
  constructor(
    public readonly productTitle: string,
    public readonly available: number,
  ) {
    super(available > 0 ? `«${productTitle}»: в наличии только ${available} шт.` : `«${productTitle}»: нет в наличии`);
    this.name = "OutOfStockError";
  }
}

/**
 * Reserve `quantity` AVAILABLE stock items for an order item (CONTRACTS §7):
 * SELECT … FOR UPDATE SKIP LOCKED inside the caller's transaction so concurrent checkouts never take the same key.
 * Throws OutOfStockError when fewer than `quantity` rows could be locked.
 */
export async function reserveStock(
  tx: Tx,
  p: { productId: string; variantId: string | null; quantity: number; orderItemId: string; productTitle: string; minutes?: number },
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM "StockItem"
    WHERE "productId" = ${p.productId}
      AND "variantId" IS NOT DISTINCT FROM ${p.variantId}
      AND status = 'AVAILABLE'
    ORDER BY "createdAt", id
    LIMIT ${p.quantity}
    FOR UPDATE SKIP LOCKED`);
  if (rows.length < p.quantity) throw new OutOfStockError(p.productTitle, rows.length);
  const ids = rows.map((r) => r.id);
  const until = new Date(Date.now() + (p.minutes ?? STOCK_RESERVATION_MINUTES) * 60_000);
  await tx.stockItem.updateMany({ where: { id: { in: ids } }, data: { status: "RESERVED", reservedUntil: until, orderItemId: p.orderItemId } });
  return ids;
}

/** Give reserved (not yet sold) stock of an order back to the pool. Returns the number of released items. */
export async function releaseOrderStock(tx: Tx, orderId: string): Promise<number> {
  const res = await tx.stockItem.updateMany({
    where: { status: "RESERVED", orderItem: { orderId } },
    data: { status: "AVAILABLE", reservedUntil: null, orderItemId: null },
  });
  return res.count;
}

/** Mark the order's reservation as final once payment is confirmed (no expiry any more). */
export async function confirmOrderStock(tx: Tx, orderId: string): Promise<void> {
  await tx.stockItem.updateMany({ where: { status: "RESERVED", orderItem: { orderId } }, data: { reservedUntil: null } });
}
