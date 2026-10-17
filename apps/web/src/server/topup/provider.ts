import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { cached } from "@/lib/redis";

/**
 * Steam top-up supplier contract (web side). Mirrors the Python worker contract in docs/CONTRACTS.md §10:
 *   TopupProvider { check_login(login) -> bool; topup(login, amount_rub, ref) -> {status, tx_id} }
 * The web app only needs `checkLogin` (calculator validation); `topup` is the shared interface used by tooling/tests —
 * the real delivery runs in the worker (job fulfill_order).
 */
export interface LoginCheckResult {
  ok: boolean;
  /** Steam persona / account label when the supplier returns it */
  displayName?: string;
  /** Human readable reason (Russian) when ok === false */
  reason?: string;
  /** "mock" | "http" — shown in the UI for sandbox transparency */
  source: "mock" | "http";
}

export interface TopupRequest {
  login: string;
  /** whole rubles credited to the wallet */
  amountRub: number;
  /** idempotency reference, e.g. OrderItem id */
  ref: string;
}

export interface TopupResult {
  status: "completed" | "pending" | "failed";
  txId: string;
  message?: string;
}

export interface TopupProvider {
  readonly name: "mock" | "http";
  checkLogin(login: string): Promise<LoginCheckResult>;
  topup(req: TopupRequest): Promise<TopupResult>;
}

const LOGIN_RE = /^[A-Za-z0-9_.-]{3,64}$/;

/**
 * SANDBOX provider (STEAM_TOPUP_PROVIDER=mock, the default). Deterministic:
 *  - logins containing "invalid", "notfound" or "nouser" are rejected;
 *  - email-like logins are rejected with a hint;
 *  - everything else is accepted.
 */
export class MockSteamProvider implements TopupProvider {
  readonly name = "mock" as const;

  async checkLogin(login: string): Promise<LoginCheckResult> {
    if (!LOGIN_RE.test(login)) return { ok: false, reason: "Логин Steam: 3–64 символа, латиница, цифры, _ . -", source: "mock" };
    if (/(invalid|notfound|nouser)/i.test(login)) return { ok: false, reason: "Аккаунт Steam с таким логином не найден", source: "mock" };
    return { ok: true, displayName: login, source: "mock" };
  }

  async topup(req: TopupRequest): Promise<TopupResult> {
    const txId = `mock_${createHash("sha256").update(`${req.ref}:${req.login}:${req.amountRub}`).digest("hex").slice(0, 12)}`;
    return { status: "completed", txId, message: "Sandbox: пополнение эмулировано" };
  }
}

/**
 * Real supplier over HTTP (STEAM_TOPUP_PROVIDER=http, STEAM_TOPUP_API_URL, STEAM_TOPUP_API_KEY).
 * NOTE: the request/response shape below is the generic JSON contract we expect from a reseller API;
 * adapt endpoints/fields to the chosen supplier's documentation before going to production.
 *   POST {url}/steam/check-login   { login }                       -> { valid: boolean, name?: string, error?: string }
 *   POST {url}/steam/topup         { login, amount, currency, ref } -> { status: "completed"|"pending"|"failed", id: string, error?: string }
 */
export class HttpSteamProvider implements TopupProvider {
  readonly name = "http" as const;
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async post<T>(path: string, body: unknown, timeoutMs = 8000): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Supplier responded ${res.status}`);
    return (await res.json()) as T;
  }

  async checkLogin(login: string): Promise<LoginCheckResult> {
    if (!LOGIN_RE.test(login)) return { ok: false, reason: "Логин Steam: 3–64 символа, латиница, цифры, _ . -", source: "http" };
    const r = await this.post<{ valid?: boolean; name?: string; error?: string }>("/steam/check-login", { login });
    return r.valid ? { ok: true, displayName: r.name ?? login, source: "http" } : { ok: false, reason: r.error ?? "Аккаунт Steam не найден", source: "http" };
  }

  async topup(req: TopupRequest): Promise<TopupResult> {
    const r = await this.post<{ status?: TopupResult["status"]; id?: string; error?: string }>("/steam/topup", { login: req.login, amount: req.amountRub, currency: "RUB", ref: req.ref }, 30_000);
    return { status: r.status ?? "pending", txId: r.id ?? "", message: r.error };
  }
}

let instance: TopupProvider | null = null;

/** Provider selected by env: STEAM_TOPUP_PROVIDER=http (+ API url/key) -> real supplier, anything else -> sandbox mock. */
export function getTopupProvider(): TopupProvider {
  if (instance) return instance;
  const { provider, apiUrl, apiKey } = env.steamTopup;
  instance = provider === "http" && apiUrl && apiKey ? new HttpSteamProvider(apiUrl, apiKey) : new MockSteamProvider();
  return instance;
}

/** Provider login check, Redis-cached for 10 minutes per login (shared by the API route and server-side order guards). */
export async function checkSteamLogin(login: string): Promise<LoginCheckResult> {
  const provider = getTopupProvider();
  return cached(`steam:login:${provider.name}:${login.toLowerCase()}`, 600, () => provider.checkLogin(login));
}
