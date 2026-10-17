import { kopecksToRub, rubToKopecks } from "@asap/shared";
import { pickNumber, pickString, requestJson, type FetchLike } from "./http";
import { verifyHmacSignature } from "./signature";
import {
  ProviderError,
  WebhookPayloadError,
  WebhookVerificationError,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type PaymentProvider,
  type PaymentStatusResult,
  type WebhookEvent,
  type WebhookStatus,
} from "./types";

export interface RollyPayConfig {
  apiKey: string;
  /** HMAC-SHA256 secret used to sign webhooks */
  secret: string;
  apiUrl: string;
  createPath: string;
  /** may contain "{id}" */
  statusPath: string;
  /** header that carries the API key (value is sent as `Bearer <key>` for "Authorization", raw otherwise) */
  authHeader: string;
  /** header that carries the webhook HMAC signature */
  signatureHeader: string;
  fetch?: FetchLike;
}

export function mapRollyStatus(raw: unknown): WebhookStatus {
  switch (String(raw ?? "").toLowerCase()) {
    case "paid":
    case "success":
    case "succeeded":
    case "completed":
    case "confirmed":
      return "PAID";
    case "failed":
    case "declined":
    case "error":
      return "FAILED";
    case "canceled":
    case "cancelled":
    case "expired":
      return "CANCELLED";
    default:
      return "PENDING";
  }
}

/**
 * RollyPay adapter.
 *
 * !! verify field names, paths and the signature scheme against the CURRENT RollyPay docs before production !!
 * Assumed (generic invoice API): POST {apiUrl}{createPath} with `Authorization: Bearer <API key>`,
 * body { amount (RUB, decimal), currency, order_id, description, success_url, fail_url } -> { id, payment_url }.
 * Webhooks carry an HMAC-SHA256 signature of the RAW body (keyed with ROLLYPAY_SECRET) in `signatureHeader`
 * and a JSON body { id, order_id, status, amount }. Response/body keys are read tolerantly (see pick* calls).
 */
export class RollyPayProvider implements PaymentProvider {
  readonly id = "ROLLYPAY" as const;
  readonly label = "RollyPay";
  private readonly f: FetchLike;

  constructor(private readonly cfg: RollyPayConfig) {
    this.f = cfg.fetch ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.cfg.apiKey && this.cfg.secret);
  }

  private authHeaders(): Record<string, string> {
    const value = this.cfg.authHeader.toLowerCase() === "authorization" ? `Bearer ${this.cfg.apiKey}` : this.cfg.apiKey;
    return { [this.cfg.authHeader]: value };
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const { payment } = input;
    const body = {
      amount: kopecksToRub(payment.amount),
      currency: "RUB",
      order_id: payment.id,
      description: input.description.slice(0, 200),
      success_url: input.returnUrl,
      fail_url: input.failUrl,
      email: input.order?.email,
    };
    const json = await requestJson(this.f, `${this.cfg.apiUrl}${this.cfg.createPath}`, { method: "POST", headers: this.authHeaders(), body });
    const externalId = pickString(json, ["id", "invoice_id", "invoiceId", "uuid", "transaction_id"]);
    const paymentUrl = pickString(json, ["payment_url", "paymentUrl", "pay_url", "payUrl", "url", "link", "redirect"]);
    if (!externalId || !paymentUrl) throw new ProviderError("RollyPay: в ответе нет id/payment_url");
    return { externalId, paymentUrl, raw: json };
  }

  verifyWebhook(rawBody: string, headers: Headers): WebhookEvent {
    const ok = verifyHmacSignature({ secret: this.cfg.secret, rawBody, signature: headers.get(this.cfg.signatureHeader) });
    if (!ok) throw new WebhookVerificationError("RollyPay: bad signature");
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new WebhookPayloadError("RollyPay: invalid JSON");
    }
    const externalId = pickString(body, ["id", "invoice_id", "invoiceId", "uuid", "transaction_id"]);
    if (!externalId) throw new WebhookPayloadError("RollyPay: missing id");
    const statusRaw = pickString(body, ["status", "state"]);
    const amountRub = pickNumber(body, ["amount", "sum"]);
    return {
      eventId: pickString(body, ["event_id", "eventId"]) ?? `${externalId}:${String(statusRaw ?? "").toLowerCase()}`,
      externalId,
      status: mapRollyStatus(statusRaw),
      amount: amountRub != null ? rubToKopecks(amountRub) : undefined,
      reference: pickString(body, ["order_id", "orderId", "reference"]) ?? null,
      raw: body,
    };
  }

  async getStatus(externalId: string): Promise<PaymentStatusResult> {
    const path = this.cfg.statusPath.replace("{id}", encodeURIComponent(externalId));
    const json = await requestJson(this.f, `${this.cfg.apiUrl}${path}`, { method: "GET", headers: this.authHeaders() });
    const amountRub = pickNumber(json, ["amount", "sum"]);
    return { status: mapRollyStatus(pickString(json, ["status", "state"])), amount: amountRub != null ? rubToKopecks(amountRub) : undefined, raw: json };
  }
}
