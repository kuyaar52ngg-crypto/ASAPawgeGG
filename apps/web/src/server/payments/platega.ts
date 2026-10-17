import { kopecksToRub, rubToKopecks } from "@asap/shared";
import { pickNumber, pickString, requestJson, type FetchLike } from "./http";
import { verifyHeaderCredentials } from "./signature";
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

export interface PlategaConfig {
  merchantId: string;
  secret: string;
  apiUrl: string;
  createPath: string;
  /** may contain "{id}" */
  statusPath: string;
  merchantHeader: string;
  secretHeader: string;
  /** numeric Platega `paymentMethod` ids of the merchant account */
  methodSbp: number;
  methodCard: number;
  fetch?: FetchLike;
}

/** Platega status -> normalised status. */
export function mapPlategaStatus(raw: unknown): WebhookStatus {
  switch (String(raw ?? "").toUpperCase()) {
    case "CONFIRMED":
    case "PAID":
    case "SUCCESS":
    case "COMPLETED":
      return "PAID";
    case "CANCELED":
    case "CANCELLED":
    case "EXPIRED":
      return "CANCELLED";
    case "FAILED":
    case "DECLINED":
    case "ERROR":
      return "FAILED";
    default:
      return "PENDING";
  }
}

/**
 * Platega adapter (СБП / карты).
 *
 * !! verify field names, paths and method ids against the CURRENT Platega docs before production !!
 * Based on the public schema: POST {apiUrl}/transaction/process with headers X-MerchantId + X-Secret,
 * body { paymentMethod, paymentDetails: { amount, currency }, description, return, failedUrl, payload } ->
 * { transactionId, redirect, status, ... }. The callback (configured in the merchant cabinet) is a POST that carries
 * the same X-MerchantId / X-Secret headers and a JSON body { id, amount, currency, status: CONFIRMED | CANCELED, payload, ... }.
 * Amounts on the wire are RUBLES (decimal); internally everything is kopecks.
 */
export class PlategaProvider implements PaymentProvider {
  readonly id = "PLATEGA" as const;
  readonly label = "Platega (СБП / карты)";
  private readonly f: FetchLike;

  constructor(private readonly cfg: PlategaConfig) {
    this.f = cfg.fetch ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.cfg.merchantId && this.cfg.secret);
  }

  private authHeaders(): Record<string, string> {
    return { [this.cfg.merchantHeader]: this.cfg.merchantId, [this.cfg.secretHeader]: this.cfg.secret };
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const { payment } = input;
    const body = {
      paymentMethod: payment.method === "sbp" ? this.cfg.methodSbp : this.cfg.methodCard,
      paymentDetails: { amount: kopecksToRub(payment.amount), currency: "RUB" },
      description: input.description.slice(0, 200),
      return: input.returnUrl,
      failedUrl: input.failUrl,
      // our reference echoed back in the callback: order id for orders, payment id for top-ups
      payload: input.order?.id ?? payment.id,
    };
    const json = await requestJson(this.f, `${this.cfg.apiUrl}${this.cfg.createPath}`, { method: "POST", headers: this.authHeaders(), body });
    const externalId = pickString(json, ["transactionId", "id", "uuid"]);
    const paymentUrl = pickString(json, ["redirect", "redirectUrl", "url", "paymentUrl"]);
    if (!externalId || !paymentUrl) throw new ProviderError("Platega: в ответе нет transactionId/redirect");
    return { externalId, paymentUrl, raw: json };
  }

  verifyWebhook(rawBody: string, headers: Headers): WebhookEvent {
    const ok = verifyHeaderCredentials(headers, {
      idHeader: this.cfg.merchantHeader,
      id: this.cfg.merchantId,
      secretHeader: this.cfg.secretHeader,
      secret: this.cfg.secret,
    });
    if (!ok) throw new WebhookVerificationError("Platega: bad merchant credentials");
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new WebhookPayloadError("Platega: invalid JSON");
    }
    const externalId = pickString(body, ["id", "transactionId"]);
    if (!externalId) throw new WebhookPayloadError("Platega: missing id");
    const status = mapPlategaStatus(body.status);
    const amountRub = pickNumber(body, ["amount"]);
    return {
      eventId: `${externalId}:${String(body.status ?? "").toUpperCase()}`,
      externalId,
      status,
      amount: amountRub != null ? rubToKopecks(amountRub) : undefined,
      reference: typeof body.payload === "string" ? body.payload : null,
      raw: body,
    };
  }

  async getStatus(externalId: string): Promise<PaymentStatusResult> {
    const path = this.cfg.statusPath.replace("{id}", encodeURIComponent(externalId));
    const json = await requestJson(this.f, `${this.cfg.apiUrl}${path}`, { method: "GET", headers: this.authHeaders() });
    const amountRub = pickNumber(json, ["amount"]);
    return { status: mapPlategaStatus(json.status), amount: amountRub != null ? rubToKopecks(amountRub) : undefined, raw: json };
  }
}
