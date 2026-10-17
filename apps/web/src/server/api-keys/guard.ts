import "server-only";
import { NextResponse } from "next/server";
import type { ApiScope } from "@asap/shared";
import { jsonError, limitByIp } from "@/lib/api";
import { authenticateApiKey, type ApiPrincipal } from "./authenticate";
import { hasScope } from "./core";

export interface ApiContext<P = Record<string, string>> {
  req: Request;
  principal: ApiPrincipal;
  params: P;
}

type RouteCtx<P> = { params: Promise<P> };

/**
 * Wraps a /api/v1 route handler: API-key auth → scope check → handler. Unexpected errors become a masked 500.
 * `scope: null` = any valid key (e.g. /me). Rate-limit headers are added to every authenticated response.
 */
export function apiRoute<P = Record<string, string>>(opts: { scope: ApiScope | readonly ApiScope[] | null }, handler: (ctx: ApiContext<P>) => Promise<NextResponse | Response>) {
  return async (req: Request, routeCtx: RouteCtx<P>): Promise<NextResponse | Response> => {
    const auth = await authenticateApiKey(req);
    if (!auth.ok) {
      // key-guessing / credential-stuffing guard: repeated 401s from one IP are throttled (each attempt costs a DB lookup)
      if (auth.status === 401) {
        const limited = await limitByIp(req, "apiv1-auth-fail", 30, 60);
        if (limited) return limited;
      }
      const res = jsonError(auth.status, auth.code, auth.message);
      if (auth.status === 401) res.headers.set("WWW-Authenticate", 'Bearer realm="asapawge-api"');
      if (auth.retryAfter) res.headers.set("Retry-After", String(auth.retryAfter));
      return res;
    }
    const { principal } = auth;
    if (opts.scope && !hasScope(principal.scopes, opts.scope)) {
      return jsonError(403, "insufficient_scope", `Для этого действия нужно право ${Array.isArray(opts.scope) ? opts.scope.join(", ") : opts.scope}`);
    }
    try {
      const res = await handler({ req, principal, params: await routeCtx.params });
      res.headers.set("X-RateLimit-Limit", String(auth.rate.limit));
      res.headers.set("X-RateLimit-Remaining", String(auth.rate.remaining));
      return res;
    } catch (e) {
      if (e instanceof ApiHttpError) return jsonError(e.status, e.code, e.message, e.details);
      console.error("[api/v1] unhandled error:", e);
      return jsonError(500, "internal_error", "Внутренняя ошибка сервера");
    }
  };
}

/** Throw inside a handler to answer with a specific HTTP error. */
export class ApiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
