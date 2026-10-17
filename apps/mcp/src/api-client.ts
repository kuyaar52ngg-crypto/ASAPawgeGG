/**
 * Thin typed client of the ASAPawge REST API v1 (/api/v1). The MCP server holds NO business logic:
 * every tool maps to one REST call made with the caller's own API key, so scopes, roles, rate limits and audit
 * are enforced by the web app exactly as for direct REST usage.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface Me {
  userId: string;
  name: string | null;
  role: "USER" | "SELLER" | "ADMIN";
  scopes: string[];
  keyPrefix: string;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class AsapApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
    private readonly timeoutMs = 30_000,
    /** extra headers on every call, e.g. `x-forwarded-for` = the MCP caller's address so the web app rate-limits per caller, not per MCP server */
    private readonly extraHeaders: Record<string, string> = {},
  ) {}

  async request<T>(method: "GET" | "POST", path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        headers: { authorization: `Bearer ${this.apiKey}`, accept: "application/json", "user-agent": "asapawge-mcp/1.0", ...this.extraHeaders, ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...opts.headers },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new ApiError(502, "upstream_unreachable", `API недоступен: ${(e as Error).message}`);
    }
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new ApiError(res.status || 502, "bad_response", `Некорректный ответ API (HTTP ${res.status})`);
    }
    const env = payload as { ok?: boolean; data?: T; error?: { code?: string; message?: string; details?: unknown } };
    if (!res.ok || env.ok === false) {
      throw new ApiError(res.status, env.error?.code ?? "request_failed", env.error?.message ?? `HTTP ${res.status}`, env.error?.details);
    }
    return env.data as T;
  }

  me() {
    return this.request<Me>("GET", "/me");
  }
  searchProducts(q: Record<string, string | number | boolean | undefined>) {
    return this.request<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number; pageCount: number }>("GET", "/products", { query: q });
  }
  getProduct(idOrSlug: string) {
    return this.request<Record<string, unknown>>("GET", `/products/${encodeURIComponent(idOrSlug)}`);
  }
  categories() {
    return this.request<Record<string, unknown>[]>("GET", "/categories");
  }
  createOrder(body: unknown, idempotencyKey?: string) {
    return this.request<Record<string, unknown>>("POST", "/orders", { body, headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : undefined });
  }
  getOrder(idOrNumber: string) {
    return this.request<Record<string, unknown>>("GET", `/orders/${encodeURIComponent(idOrNumber)}`);
  }
  listOrders(q: Record<string, string | number | undefined>) {
    return this.request<Record<string, unknown>>("GET", "/orders", { query: q });
  }
  balance() {
    return this.request<{ balance: number; currency: string }>("GET", "/balance");
  }
  sellerCreateProduct(body: unknown) {
    return this.request<Record<string, unknown>>("POST", "/seller/products", { body });
  }
  sellerUploadStock(productId: string, body: unknown) {
    return this.request<Record<string, unknown>>("POST", `/seller/products/${encodeURIComponent(productId)}/stock`, { body });
  }
  sellerStats(days?: number) {
    return this.request<Record<string, unknown>>("GET", "/seller/stats", { query: { days } });
  }
  adminMetrics(days?: number, summary?: boolean) {
    return this.request<Record<string, unknown>>("GET", "/admin/metrics", { query: { days, summary: summary ? "1" : undefined } });
  }
  adminModerate(productId: string, body: unknown) {
    return this.request<Record<string, unknown>>("POST", `/admin/products/${encodeURIComponent(productId)}/moderate`, { body });
  }
}
