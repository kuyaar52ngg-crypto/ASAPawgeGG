import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { sweepStuckPaidOrders } from "@/server/orders/fulfill";
import { expirePendingOrders, releaseExpiredReservations } from "@/server/orders/maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: Request): boolean {
  // WORKER_INTERNAL_TOKEN (worker cron) or CRON_SECRET (Vercel Cron sends it as a Bearer token)
  const tokens = [env.workerToken, process.env.CRON_SECRET ?? ""].filter(Boolean);
  const a = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  return tokens.some((token) => {
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

/**
 * Commerce housekeeping, callable by the worker's cron (or any scheduler) with `Authorization: Bearer $WORKER_INTERNAL_TOKEN`:
 *   - release expired stock reservations
 *   - cancel PENDING orders older than 30 min (releases stock)
 *   - fulfil PAID orders nobody picked up (in-process fallback)
 * Idempotent. Returns counts.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  const released = await releaseExpiredReservations();
  const cancelled = await expirePendingOrders();
  const fulfilled = await sweepStuckPaidOrders();
  return NextResponse.json({ ok: true, data: { releasedReservations: released, cancelledOrders: cancelled, fulfilledOrders: fulfilled } });
}

/** Vercel Cron issues GET requests. */
export const GET = POST;
