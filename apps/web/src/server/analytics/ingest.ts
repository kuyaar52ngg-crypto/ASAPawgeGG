import "server-only";
import { z } from "zod";
import { prisma, type Prisma } from "@asap/db";
import { ANALYTICS_EVENTS, analyticsEventSchema, type AnalyticsEventName } from "@asap/shared";
import { redis } from "@/lib/redis";

/** Cookie holding the anonymous visitor/session id (UUID, 30 days). */
export const SESSION_COOKIE = "asap_sid";
export const SESSION_COOKIE_MAX_AGE = 30 * 24 * 3600;

/** Friendly aliases accepted from clients (the canonical names live in ANALYTICS_EVENTS). */
const ALIASES: Record<string, AnalyticsEventName> = { product_view: "view_item", pageview: "page_view" };

const sessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const trackBodySchema = analyticsEventSchema.extend({
  name: z
    .string()
    .transform((v) => (ALIASES[v] ?? v) as string)
    .pipe(z.enum(ANALYTICS_EVENTS)),
  sessionId: sessionIdSchema.optional(),
  properties: z.record(z.string().max(60), z.unknown()).optional(),
});
export type TrackBody = z.infer<typeof trackBodySchema>;

/**
 * Events a browser may report. Everything that represents a business fact (sign_up, login, balance top-up, review, dispute)
 * is written by the server at the moment it happens — accepting it from clients would let anyone inflate the admin funnel.
 * `purchase` is accepted only for the signed-in buyer's own PAID order (see ingestClientEvent).
 */
export const CLIENT_EVENT_NAMES: ReadonlySet<string> = new Set([
  "page_view", "view_item", "search", "add_to_cart", "remove_from_cart", "begin_checkout", "add_payment_info", "purchase", "steam_topup_start", "favorite_add", "ai_chat_message",
]);

const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|facebookexternalhit|preview|monitor|curl|wget|python-requests/i;
export function isBot(userAgent: string | null | undefined): boolean {
  return !userAgent || BOT_RE.test(userAgent);
}

/** Paths that must never be recorded (admin tooling, internal APIs). */
export function isTrackablePath(path: string | undefined): boolean {
  if (!path) return true;
  return !(path.startsWith("/admin") || path.startsWith("/api/"));
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Keep properties small and JSON-safe (strings clipped, numbers finite, depth ≤ 3, ≤ 2 KB total). */
export function sanitizeProperties(input: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  if (!input) return undefined;
  const clean = (v: unknown, depth: number): Prisma.InputJsonValue | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === "string") return v.slice(0, 300);
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "boolean") return v;
    if (depth >= 3) return null;
    if (Array.isArray(v)) return v.slice(0, 20).map((x) => clean(x, depth + 1));
    if (typeof v === "object") {
      const out: Record<string, Prisma.InputJsonValue | null> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 20)) out[k.slice(0, 60)] = clean(x, depth + 1);
      return out;
    }
    return null;
  };
  const out = clean(input, 0);
  if (!out || JSON.stringify(out).length > 2000) return undefined;
  return out;
}

function cleanPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const p = path.split("#")[0]!.slice(0, 500);
  return p.startsWith("/") ? p : undefined;
}

export type IngestResult = { stored: boolean; reason?: "bot" | "path" | "duplicate" | "invalid" };

/**
 * Persist one client event. Defensive by design: page views are de-duplicated for 2 s per visitor/path (React strict mode,
 * double clicks) and a client-reported `purchase` is only stored when no server-side purchase exists for that order yet
 * (the server's own `purchase` event on payment settle is authoritative).
 */
export async function ingestClientEvent(args: {
  body: TrackBody;
  sessionId: string;
  userId?: string | null;
  userAgent?: string | null;
}): Promise<IngestResult> {
  const { body, sessionId, userId, userAgent } = args;
  if (isBot(userAgent)) return { stored: false, reason: "bot" };
  if (!CLIENT_EVENT_NAMES.has(body.name)) return { stored: false, reason: "invalid" };
  const path = cleanPath(body.path);
  if (!isTrackablePath(path)) return { stored: false, reason: "path" };
  const properties = sanitizeProperties(body.properties);

  if (body.name === "page_view") {
    try {
      const ok = await redis.set(`track:pv:${sessionId}:${path ?? ""}`, "1", "EX", 2, "NX");
      if (ok !== "OK") return { stored: false, reason: "duplicate" };
    } catch {
      /* redis down: skip de-duplication */
    }
  }

  if (body.name === "purchase") {
    const orderId = (properties as Record<string, unknown> | undefined)?.orderId;
    if (typeof orderId !== "string" || !orderId || !userId) return { stored: false, reason: "invalid" };
    const own = await prisma.order.findFirst({ where: { id: orderId, buyerId: userId, paidAt: { not: null } }, select: { id: true } });
    if (!own) return { stored: false, reason: "invalid" };
    const exists = await prisma.analyticsEvent.findFirst({ where: { name: "purchase", properties: { path: ["orderId"], equals: orderId } }, select: { id: true } });
    if (exists) return { stored: false, reason: "duplicate" };
  }

  try {
    await prisma.analyticsEvent.create({
      data: {
        name: body.name,
        userId: userId ?? null,
        sessionId,
        path,
        referrer: body.referrer?.slice(0, 500),
        properties,
        userAgent: userAgent?.slice(0, 300),
      },
    });
    return { stored: true };
  } catch (err) {
    console.warn("[analytics] ingest failed:", (err as Error).message);
    return { stored: false, reason: "invalid" };
  }
}
