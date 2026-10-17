import "server-only";

/**
 * Typed access to server env vars with safe defaults.
 * Provider "configured" flags drive sandbox/mock fallbacks everywhere.
 */
const e = process.env;

/** Value shipped in .env.example — must never protect a real deployment. */
export const DEV_SANDBOX_WEBHOOK_SECRET = "dev-sandbox-webhook-secret";

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
const appUrl = e.APP_URL ?? e.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const env = {
  nodeEnv: e.NODE_ENV ?? "development",
  isProd: e.NODE_ENV === "production",
  appUrl,
  /** true when the app is served from localhost (local stack / CI); false for a real public deployment */
  isLocalApp: ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostnameOf(appUrl)),
  databaseUrl: e.DATABASE_URL ?? "postgresql://asap:asap@localhost:5432/asapawge",
  redisUrl: e.REDIS_URL ?? "redis://localhost:6379",
  workerUrl: e.WORKER_URL ?? "http://localhost:8000",
  workerToken: e.WORKER_INTERNAL_TOKEN ?? "",

  platega: {
    merchantId: e.PLATEGA_MERCHANT_ID ?? "",
    secret: e.PLATEGA_SECRET ?? "",
    apiUrl: e.PLATEGA_API_URL ?? "https://app.platega.io",
    // Zone B: endpoint paths / header names / method ids are overridable (verify against provider docs before production)
    createPath: e.PLATEGA_CREATE_PATH ?? "/transaction/process",
    statusPath: e.PLATEGA_STATUS_PATH ?? "/transaction/{id}",
    merchantHeader: e.PLATEGA_MERCHANT_HEADER ?? "X-MerchantId",
    secretHeader: e.PLATEGA_SECRET_HEADER ?? "X-Secret",
    methodSbp: Number(e.PLATEGA_METHOD_SBP ?? 2),
    methodCard: Number(e.PLATEGA_METHOD_CARD ?? 10),
    get configured() {
      return Boolean(this.merchantId && this.secret);
    },
  },
  rollypay: {
    apiKey: e.ROLLYPAY_API_KEY ?? "",
    secret: e.ROLLYPAY_SECRET ?? "",
    apiUrl: e.ROLLYPAY_API_URL ?? "https://api.rollypay.io",
    // Zone B: overridable (verify against provider docs before production)
    createPath: e.ROLLYPAY_CREATE_PATH ?? "/v1/invoices",
    statusPath: e.ROLLYPAY_STATUS_PATH ?? "/v1/invoices/{id}",
    authHeader: e.ROLLYPAY_AUTH_HEADER ?? "Authorization",
    signatureHeader: e.ROLLYPAY_SIGNATURE_HEADER ?? "x-signature",
    get configured() {
      return Boolean(this.apiKey && this.secret);
    },
  },
  sandboxWebhookSecret: e.SANDBOX_WEBHOOK_SECRET || DEV_SANDBOX_WEBHOOK_SECRET,
  /** "1"/"0" forces the sandbox ("Тестовая оплата") on/off. Unset => on in dev, and in prod only while no real gateway is configured. */
  allowSandboxPayments: e.ALLOW_SANDBOX_PAYMENTS,

  ai: {
    provider: e.AI_PROVIDER ?? "mock",
    model: e.AI_MODEL ?? "",
    openaiKey: e.OPENAI_API_KEY ?? "",
    anthropicKey: e.ANTHROPIC_API_KEY ?? "",
    openrouterKey: e.OPENROUTER_API_KEY ?? "",
  },

  steamTopup: {
    provider: e.STEAM_TOPUP_PROVIDER ?? "mock",
    apiUrl: e.STEAM_TOPUP_API_URL ?? "",
    apiKey: e.STEAM_TOPUP_API_KEY ?? "",
  },

  commissionDefaultBps: Number(e.COMMISSION_DEFAULT_BPS ?? 1000),
  holdDays: Number(e.HOLD_DAYS ?? 3),
} as const;
