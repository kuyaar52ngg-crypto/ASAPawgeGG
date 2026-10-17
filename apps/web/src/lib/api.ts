import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { rateLimit } from "./rate-limit";
import { ipFromRequest } from "./request";

/** Standard JSON envelope for route handlers: { ok: true, data } | { ok: false, error: { code, message, details? } } */
export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ ok: false, error: { code, message, details } }, { status });
}

/** Parse + validate JSON body with zod. Returns [data, null] or [null, Response]. */
export async function parseJson<S extends z.ZodType>(req: Request, schema: S): Promise<[z.infer<S>, null] | [null, NextResponse]> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return [null, jsonError(400, "invalid_json", "Некорректный JSON")];
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return [null, jsonError(422, "validation_error", "Ошибка валидации", parsed.error.flatten())];
  return [parsed.data, null];
}

/** Per-IP rate limit for route handlers. Returns a 429 Response or null. */
export async function limitByIp(req: Request, bucket: string, limit = 60, windowSec = 60): Promise<NextResponse | null> {
  const rl = await rateLimit({ key: `${bucket}:${ipFromRequest(req)}`, limit, windowSec });
  if (rl.ok) return null;
  const res = jsonError(429, "rate_limited", "Слишком много запросов. Попробуйте позже.");
  res.headers.set("Retry-After", String(rl.retryAfter));
  return res;
}
