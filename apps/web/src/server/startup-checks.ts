import "server-only";
import { parseStockKey } from "@asap/shared";
import { DEV_SANDBOX_WEBHOOK_SECRET, env } from "@/lib/env";

/** STOCK_ENCRYPTION_KEY from .env.example (DEV ONLY). */
const EXAMPLE_STOCK_KEY = "ZGV2LW9ubHktc3RvY2sta2V5LTMyLWJ5dGVzLWxvbiE=";

const looksLikePlaceholder = (v: string) => /dev-only|change-me|changeme|example|secret123|please/i.test(v);

/** Returns human-readable problems with the production configuration (empty = fine). Pure w.r.t. process.env. */
export function productionConfigProblems(e: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const authSecret = e.AUTH_SECRET ?? e.NEXTAUTH_SECRET ?? "";
  if (authSecret.length < 32 || looksLikePlaceholder(authSecret)) problems.push("AUTH_SECRET is missing, shorter than 32 chars or still the example value (sessions could be forged)");
  const token = e.WORKER_INTERNAL_TOKEN ?? "";
  if (token.length < 16 || looksLikePlaceholder(token)) problems.push("WORKER_INTERNAL_TOKEN is missing, shorter than 16 chars or still the example value (anyone could call the internal job API)");
  const stockKey = e.STOCK_ENCRYPTION_KEY ?? "";
  try {
    parseStockKey(stockKey);
    if (stockKey === EXAMPLE_STOCK_KEY) problems.push("STOCK_ENCRYPTION_KEY is the public example key (every stored product key could be decrypted)");
  } catch {
    problems.push("STOCK_ENCRYPTION_KEY is missing or not a valid 32-byte base64/hex key");
  }
  const realGateway = Boolean((e.PLATEGA_MERCHANT_ID && e.PLATEGA_SECRET) || (e.ROLLYPAY_API_KEY && e.ROLLYPAY_SECRET));
  if (realGateway && (e.STEAM_TOPUP_PROVIDER ?? "mock") === "mock") {
    problems.push("a real payment gateway is configured but STEAM_TOPUP_PROVIDER=mock: customers would pay real money for Steam top-ups that are only emulated (set STEAM_TOPUP_PROVIDER=http)");
  }
  if ((e.SANDBOX_WEBHOOK_SECRET || DEV_SANDBOX_WEBHOOK_SECRET) === DEV_SANDBOX_WEBHOOK_SECRET && e.ALLOW_SANDBOX_PAYMENTS !== "0" && e.ALLOW_SANDBOX_PAYMENTS !== "false") {
    // not fatal: isSandboxAllowed() switches the sandbox off by itself in this situation
    console.warn("[startup] SANDBOX_WEBHOOK_SECRET is the default value — the sandbox payment method is disabled until you set your own secret");
  }
  return problems;
}

/**
 * Refuses to boot a PUBLIC production deployment (APP_URL not localhost) with example secrets.
 * Escape hatch for staging: ALLOW_INSECURE_DEFAULTS=1. Local `next start` on localhost is never blocked.
 */
export function assertProductionSecrets(): void {
  if (!env.isProd || env.isLocalApp) return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const problems = productionConfigProblems();
  if (problems.length === 0) return;
  const msg = `Insecure production configuration:\n - ${problems.join("\n - ")}`;
  if (process.env.ALLOW_INSECURE_DEFAULTS === "1") {
    console.error(`[startup] ${msg}\n[startup] continuing because ALLOW_INSECURE_DEFAULTS=1`);
    return;
  }
  throw new Error(`${msg}\nSet real secrets (see .env.example) or ALLOW_INSECURE_DEFAULTS=1 to override.`);
}
