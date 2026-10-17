import { randomUUID } from "node:crypto";
import { auth } from "@/auth";
import { jsonOk, limitByIp, parseJson } from "@/lib/api";
import { SESSION_COOKIE, SESSION_COOKIE_MAX_AGE, ingestClientEvent, readCookie, trackBodySchema } from "@/server/analytics/ingest";

export const dynamic = "force-dynamic";

/**
 * First-party analytics ingest (CONTRACTS §14): `POST /api/analytics/event` (alias `POST /api/track`).
 * Body: { name, path?, referrer?, sessionId?, properties? } — validated with zod, rate-limited per IP (120/min).
 * The visitor is identified by the `asap_sid` cookie (created here when missing) and, if signed in, the JWT user id.
 */
export async function POST(req: Request) {
  const limited = await limitByIp(req, "track", 120, 60);
  if (limited) return limited;
  const [body, err] = await parseJson(req, trackBodySchema);
  if (err) return err;

  const existing = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  const sessionId = existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing) ? existing : (body.sessionId ?? randomUUID());
  const session = await auth().catch(() => null);

  const result = await ingestClientEvent({ body, sessionId, userId: session?.user?.id ?? null, userAgent: req.headers.get("user-agent") });
  const res = jsonOk({ tracked: result.stored, reason: result.reason });
  if (!existing || existing !== sessionId) {
    res.cookies.set(SESSION_COOKIE, sessionId, { maxAge: SESSION_COOKIE_MAX_AGE, path: "/", sameSite: "lax", httpOnly: false, secure: process.env.NODE_ENV === "production" });
  }
  return res;
}
