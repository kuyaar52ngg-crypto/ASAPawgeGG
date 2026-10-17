import "server-only";
import { headers } from "next/headers";

/**
 * Number of reverse proxies in front of the app that APPEND the peer address to `X-Forwarded-For`
 * (nginx / Traefik / a load balancer = 1). The client IP is the entry that the outermost trusted proxy saw, i.e. the
 * N-th entry from the RIGHT — everything to its left is client-controlled and spoofable (it would let an attacker
 * dodge every IP rate limit by sending a random header). 0 = no trusted proxy: forwarded headers are ignored.
 */
function trustedProxyHops(): number {
  const n = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 1;
}

const IP_SHAPE = /^[0-9a-fA-F:.]{2,45}$/;

/** Pure helper (unit-tested): client IP from forwarded headers, given the number of trusted proxies. */
export function clientIpFromHeaders(xff: string | null | undefined, realIp: string | null | undefined, hops = trustedProxyHops()): string {
  if (hops > 0) {
    const parts = (xff ?? "").split(",").map((p) => p.trim()).filter(Boolean);
    const picked = parts.length > 0 ? parts[Math.max(0, parts.length - hops)] : realIp?.trim();
    // anything that is not shaped like an IPv4/IPv6 address must never reach a rate-limit key
    if (picked && IP_SHAPE.test(picked)) return picked;
  }
  return "unknown";
}

/** Best-effort client IP (works in server actions / RSC / route handlers). */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  return clientIpFromHeaders(h.get("x-forwarded-for"), h.get("x-real-ip"));
}

export function ipFromRequest(req: Request): string {
  return clientIpFromHeaders(req.headers.get("x-forwarded-for"), req.headers.get("x-real-ip"));
}
