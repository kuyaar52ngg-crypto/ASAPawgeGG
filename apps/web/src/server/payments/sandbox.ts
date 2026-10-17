import { z } from "zod";
import { hmacSha256Hex, verifyHmacSignature } from "./signature";
import {
  WebhookPayloadError,
  WebhookVerificationError,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type PaymentProvider,
  type PaymentStatusResult,
  type WebhookEvent,
} from "./types";

export const SANDBOX_SIGNATURE_HEADER = "x-signature";

export interface SandboxConfig {
  secret: string;
  appUrl: string;
  /** whether the sandbox may be used at all (see payments/config.ts) */
  enabled: boolean;
}

const sandboxEventSchema = z.object({
  eventId: z.string().min(1).max(100),
  externalId: z.string().min(1).max(100),
  status: z.enum(["PAID", "FAILED", "CANCELLED"]),
  amount: z.number().int().nonnegative().optional(),
});

/** Body + signature header for a sandbox webhook (HMAC-SHA256 hex of the raw JSON body). */
export function buildSandboxWebhook(secret: string, event: z.infer<typeof sandboxEventSchema>): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify(event);
  return { body, headers: { [SANDBOX_SIGNATURE_HEADER]: hmacSha256Hex(secret, body) } };
}

/**
 * SANDBOX ("Тестовая оплата"): no real money. The buyer is sent to /checkout/sandbox/[paymentId] where "Оплатить"/"Отклонить"
 * produce a webhook signed with SANDBOX_WEBHOOK_SECRET that goes through exactly the same handler as real gateways.
 */
export class SandboxProvider implements PaymentProvider {
  readonly id = "SANDBOX" as const;
  readonly label = "Тестовая оплата";

  constructor(private readonly cfg: SandboxConfig) {}

  isConfigured(): boolean {
    return this.cfg.enabled;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return {
      externalId: `sbx_${input.payment.id}`,
      paymentUrl: `${this.cfg.appUrl}/checkout/sandbox/${input.payment.id}`,
      raw: { sandbox: true },
    };
  }

  verifyWebhook(rawBody: string, headers: Headers): WebhookEvent {
    if (!verifyHmacSignature({ secret: this.cfg.secret, rawBody, signature: headers.get(SANDBOX_SIGNATURE_HEADER) })) {
      throw new WebhookVerificationError("Sandbox: bad signature");
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new WebhookPayloadError("Sandbox: invalid JSON");
    }
    const parsed = sandboxEventSchema.safeParse(json);
    if (!parsed.success) throw new WebhookPayloadError("Sandbox: invalid payload");
    const e = parsed.data;
    return { eventId: e.eventId, externalId: e.externalId, status: e.status, amount: e.amount, reference: null, raw: { ...e, sandbox: true } };
  }

  async getStatus(): Promise<PaymentStatusResult> {
    // the sandbox has no remote state: the DB row is the truth
    return { status: "PENDING" };
  }
}
