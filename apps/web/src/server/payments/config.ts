import "server-only";
import { getSetting } from "@asap/db";
import { SETTING_KEYS } from "@asap/shared";
import { env } from "@/lib/env";
import { PlategaProvider } from "./platega";
import { RollyPayProvider } from "./rollypay";
import { SandboxProvider } from "./sandbox";
import type { GatewayId, PaymentChoice, PaymentProvider, PaymentSubMethod } from "./types";

/** Sandbox is allowed in dev, and in production only while no real gateway is configured (or when forced with ALLOW_SANDBOX_PAYMENTS=1). */
export function isSandboxAllowed(): boolean {
  const forced = env.allowSandboxPayments;
  if (forced === "1" || forced === "true") return true;
  if (forced === "0" || forced === "false") return false;
  return !env.isProd || !(env.platega.configured || env.rollypay.configured);
}

let cache: Record<GatewayId, PaymentProvider> | null = null;

/** Providers built from env (lazy singleton). */
export function getProvider(id: GatewayId): PaymentProvider {
  cache ??= {
    PLATEGA: new PlategaProvider({
      merchantId: env.platega.merchantId,
      secret: env.platega.secret,
      apiUrl: env.platega.apiUrl.replace(/\/$/, ""),
      createPath: env.platega.createPath,
      statusPath: env.platega.statusPath,
      merchantHeader: env.platega.merchantHeader,
      secretHeader: env.platega.secretHeader,
      methodSbp: env.platega.methodSbp,
      methodCard: env.platega.methodCard,
    }),
    ROLLYPAY: new RollyPayProvider({
      apiKey: env.rollypay.apiKey,
      secret: env.rollypay.secret,
      apiUrl: env.rollypay.apiUrl.replace(/\/$/, ""),
      createPath: env.rollypay.createPath,
      statusPath: env.rollypay.statusPath,
      authHeader: env.rollypay.authHeader,
      signatureHeader: env.rollypay.signatureHeader,
    }),
    SANDBOX: new SandboxProvider({ secret: env.sandboxWebhookSecret, appUrl: env.appUrl.replace(/\/$/, ""), enabled: isSandboxAllowed() }),
  };
  return cache[id];
}

export function parseGatewayId(raw: string): GatewayId | null {
  const up = raw.toUpperCase();
  return up === "PLATEGA" || up === "ROLLYPAY" || up === "SANDBOX" ? up : null;
}

export interface MethodOption {
  id: PaymentChoice;
  /** payment provider for Payment.provider */
  provider: "BALANCE" | GatewayId;
  submethod: PaymentSubMethod | null;
  label: string;
  description: string;
  available: boolean;
  /** why it is unavailable (Russian) */
  reason?: string;
  /** shown as a "ТЕСТОВЫЙ РЕЖИМ" badge */
  sandbox?: boolean;
}

type EnabledMap = Partial<Record<"PLATEGA" | "ROLLYPAY" | "BALANCE" | "SANDBOX", boolean>>;

/** Payment methods for the checkout / top-up UIs with availability (keys configured, admin switch `payments.enabled`). */
export async function listPaymentMethods(opts: { forTopup?: boolean } = {}): Promise<MethodOption[]> {
  const enabled = await getSetting<EnabledMap>(SETTING_KEYS.paymentsEnabled, {}).catch(() => ({}) as EnabledMap);
  const on = (k: keyof EnabledMap) => enabled[k] !== false;
  const platega = getProvider("PLATEGA").isConfigured();
  const rolly = getProvider("ROLLYPAY").isConfigured();
  const sandbox = getProvider("SANDBOX").isConfigured();

  const gate = (configured: boolean, key: keyof EnabledMap): { available: boolean; reason?: string } =>
    !configured ? { available: false, reason: "Не подключено в этом окружении" } : !on(key) ? { available: false, reason: "Временно отключено" } : { available: true };

  const all: MethodOption[] = [
    { id: "BALANCE", provider: "BALANCE", submethod: null, label: "Баланс сайта", description: "Мгновенно, без комиссии", ...(on("BALANCE") ? { available: true } : { available: false, reason: "Временно отключено" }) },
    { id: "PLATEGA_SBP", provider: "PLATEGA", submethod: "sbp", label: "СБП", description: "Быстрый платёж по QR / в приложении банка (Platega)", ...gate(platega, "PLATEGA") },
    { id: "PLATEGA_CARD", provider: "PLATEGA", submethod: "card", label: "Банковская карта", description: "Visa / Mastercard / Мир (Platega)", ...gate(platega, "PLATEGA") },
    { id: "ROLLYPAY", provider: "ROLLYPAY", submethod: null, label: "RollyPay", description: "Оплата через RollyPay", ...gate(rolly, "ROLLYPAY") },
    {
      id: "SANDBOX", provider: "SANDBOX", submethod: null, label: "Тестовая оплата", description: "Тестовый режим: деньги не списываются, исход выбираете вы",
      sandbox: true,
      ...(!sandbox ? { available: false, reason: "Отключена в этом окружении" } : !on("SANDBOX") ? { available: false, reason: "Временно отключено" } : { available: true }),
    },
  ];
  return opts.forTopup ? all.filter((m) => m.id !== "BALANCE") : all;
}

export async function resolveMethod(choice: PaymentChoice, opts: { forTopup?: boolean } = {}): Promise<MethodOption | { error: string }> {
  const m = (await listPaymentMethods(opts)).find((x) => x.id === choice);
  if (!m) return { error: "Способ оплаты недоступен" };
  if (!m.available) return { error: `Способ оплаты «${m.label}» недоступен: ${m.reason ?? "отключён"}` };
  return m;
}
