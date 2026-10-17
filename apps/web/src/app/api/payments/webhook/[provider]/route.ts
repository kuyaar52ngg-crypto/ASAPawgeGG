import { NextResponse } from "next/server";
import { limitByIp } from "@/lib/api";
import { parseGatewayId } from "@/server/payments/config";
import { handleWebhook } from "@/server/payments/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Payment gateway callbacks: POST /api/payments/webhook/{platega|rollypay|sandbox}  (CONTRACTS §9).
 * The RAW body is read as text because signatures are computed over the exact bytes.
 * Always 2xx for already-processed events; 401 for bad signatures; 409 asks the provider to retry later.
 */
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const limited = await limitByIp(req, "webhook", 600, 60);
  if (limited) return limited;
  const providerId = parseGatewayId((await ctx.params).provider);
  if (!providerId) return NextResponse.json({ ok: false, code: "unknown_provider" }, { status: 404 });
  const rawBody = await req.text();
  if (rawBody.length > 100_000) return NextResponse.json({ ok: false, code: "payload_too_large" }, { status: 413 });
  const res = await handleWebhook(providerId, rawBody, req.headers);
  return NextResponse.json(res.body, { status: res.status });
}
