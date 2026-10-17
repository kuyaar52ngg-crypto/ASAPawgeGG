import "server-only";
import { Prisma, prisma } from "@asap/db";
import { withLock } from "@/lib/redis";
import { AmountMismatchError, markPaid } from "@/server/orders/mark-paid";
import { getProvider } from "./config";
import { WebhookPayloadError, WebhookVerificationError, type GatewayId, type WebhookEvent } from "./types";

export interface WebhookResponse {
  status: number;
  body: { ok: boolean; code?: string; message?: string; duplicate?: boolean };
}

const json = (status: number, body: WebhookResponse["body"]): WebhookResponse => ({ status, body });

/**
 * Shared webhook pipeline for ALL gateways (real ones via /api/payments/webhook/[provider], the sandbox via its checkout page):
 *  1. verify signature + parse  (401 / 400)
 *  2. dedupe on WebhookEvent unique(provider, eventId) — already processed => 200 no-op
 *  3. per-payment Redis lock  (409 if another handler is mid-flight => provider retries)
 *  4. amount check -> markPaid (one DB tx: payment, order, ledger, stock) -> fulfilment kick-off
 * Always answers 2xx for events that were already handled.
 */
export async function handleWebhook(providerId: GatewayId, rawBody: string, headers: Headers): Promise<WebhookResponse> {
  const provider = getProvider(providerId);
  if (!provider.isConfigured()) return json(404, { ok: false, code: "provider_not_configured", message: "Provider is not configured" });

  let event: WebhookEvent;
  try {
    event = provider.verifyWebhook(rawBody, headers);
  } catch (e) {
    if (e instanceof WebhookVerificationError) return json(401, { ok: false, code: "invalid_signature", message: "Invalid signature" });
    if (e instanceof WebhookPayloadError) return json(400, { ok: false, code: "invalid_payload", message: e.message });
    console.error(`[payments] ${providerId} webhook verification crashed:`, (e as Error).message);
    return json(400, { ok: false, code: "invalid_request" });
  }

  // ── dedupe: insert-first on unique(provider, eventId) ──
  await prisma.webhookEvent.createMany({ data: [{ provider: providerId, eventId: event.eventId, payload: event.raw as Prisma.InputJsonValue }], skipDuplicates: true });
  const stored = await prisma.webhookEvent.findUnique({ where: { provider_eventId: { provider: providerId, eventId: event.eventId } }, select: { id: true, processedAt: true } });
  if (!stored) return json(409, { ok: false, code: "busy" });
  // already handled => 2xx no-op; a previous attempt that crashed before finishing (processedAt NULL) is processed again
  if (stored.processedAt) return json(200, { ok: true, duplicate: true });

  const finish = (error?: string) =>
    prisma.webhookEvent.update({ where: { id: stored.id }, data: error ? { error: error.slice(0, 500) } : { processedAt: new Date(), error: null } }).catch(() => {});

  const outcome = await withLock(`payment:${providerId}:${event.externalId}`, 60_000, async (): Promise<WebhookResponse> => {
    const payment = await findPayment(providerId, event);
    if (!payment) {
      await finish("payment_not_found");
      return json(404, { ok: false, code: "payment_not_found", message: "Unknown payment" });
    }

    if (event.status === "PENDING") {
      await finish();
      return json(200, { ok: true });
    }

    if (event.status === "FAILED" || event.status === "CANCELLED") {
      // never downgrade a settled payment; failed payments leave the order PENDING so the buyer can retry another method
      await prisma.payment.updateMany({
        where: { id: payment.id, status: { in: ["CREATED", "PENDING"] } },
        data: { status: event.status === "FAILED" ? "FAILED" : "CANCELLED" },
      });
      await finish();
      return json(200, { ok: true });
    }

    try {
      await markPaid(payment.id, { reportedAmount: event.amount, raw: event.raw as Prisma.InputJsonValue });
    } catch (e) {
      if (e instanceof AmountMismatchError) {
        console.error(`[payments] AMOUNT MISMATCH payment=${payment.id} expected=${e.expected} got=${e.actual}`);
        await finish(`amount_mismatch expected=${e.expected} actual=${e.actual}`);
        return json(422, { ok: false, code: "amount_mismatch", message: "Amount does not match the payment" });
      }
      await finish(`processing_error: ${(e as Error).message}`);
      console.error(`[payments] markPaid failed payment=${payment.id}:`, e);
      return json(500, { ok: false, code: "processing_error" });
    }
    await finish();
    return json(200, { ok: true });
  });

  return outcome ?? json(409, { ok: false, code: "busy", message: "Payment is being processed, retry later" });
}

async function findPayment(providerId: GatewayId, event: WebhookEvent) {
  const byExternal = await prisma.payment.findUnique({ where: { provider_externalId: { provider: providerId, externalId: event.externalId } }, select: { id: true } });
  if (byExternal) return byExternal;
  if (!event.reference) return null;
  // fallback: provider echoed our reference (payment id, or order id for order payments)
  return prisma.payment.findFirst({
    where: { provider: providerId, OR: [{ id: event.reference }, { orderId: event.reference, status: { in: ["CREATED", "PENDING"] } }] },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}
