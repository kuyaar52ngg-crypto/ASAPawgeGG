import type { PaymentProviderName } from "@asap/shared";

/** Gateways that redirect the buyer (BALANCE is handled internally, see initiate.ts). */
export type GatewayId = Exclude<PaymentProviderName, "BALANCE">;

/** Payment methods the buyer can pick in the UI. */
export const PAYMENT_CHOICES = ["BALANCE", "PLATEGA_SBP", "PLATEGA_CARD", "ROLLYPAY", "SANDBOX"] as const;
export type PaymentChoice = (typeof PAYMENT_CHOICES)[number];

export type WebhookStatus = "PAID" | "FAILED" | "CANCELLED" | "PENDING";
export type PaymentSubMethod = "sbp" | "card";

export interface CreatePaymentInput {
  payment: {
    id: string;
    /** kopecks */
    amount: number;
    currency: string;
    purpose: "ORDER" | "BALANCE_TOPUP";
    userId: string;
    method?: PaymentSubMethod | null;
  };
  order?: { id: string; number: string; email: string } | null;
  description: string;
  returnUrl: string;
  failUrl: string;
}

export interface CreatePaymentResult {
  /** provider-side transaction id (unique together with the provider) */
  externalId: string;
  /** where to send the buyer */
  paymentUrl: string;
  raw?: unknown;
}

/** Normalised, verified webhook event. */
export interface WebhookEvent {
  /** dedupe key (WebhookEvent unique [provider, eventId]) */
  eventId: string;
  /** provider transaction id => Payment.externalId */
  externalId: string;
  status: WebhookStatus;
  /** kopecks, when the provider reports it (checked against Payment.amount) */
  amount?: number;
  /** our own reference echoed back by the provider (order id / payment id), used as lookup fallback */
  reference?: string | null;
  raw: Record<string, unknown>;
}

export interface PaymentStatusResult {
  status: WebhookStatus;
  amount?: number;
  raw?: unknown;
}

export interface PaymentProvider {
  readonly id: GatewayId;
  readonly label: string;
  /** false => provider is not usable (keys missing / sandbox disabled) */
  isConfigured(): boolean;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** Verify authenticity + parse. MUST throw WebhookVerificationError for forged/invalid requests. */
  verifyWebhook(rawBody: string, headers: Headers): WebhookEvent;
  /** Poll the provider for the current state (used when a webhook is late/missing). */
  getStatus(externalId: string): Promise<PaymentStatusResult>;
}

export class WebhookVerificationError extends Error {
  constructor(message = "Invalid webhook signature") {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

export class WebhookPayloadError extends Error {
  constructor(message = "Malformed webhook payload") {
    super(message);
    this.name = "WebhookPayloadError";
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
