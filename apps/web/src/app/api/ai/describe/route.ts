import { NextResponse } from "next/server";
import { jsonError, jsonOk, parseJson } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { AuthError, assertRole } from "@/server/auth/session";
import { describeInputSchema, generateProductDescription } from "@/server/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/ai/describe — seller/admin only. Generates a product description (LLM, or a labelled rule-based template offline). */
export async function POST(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await assertRole("SELLER", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.code === "UNAUTHENTICATED" ? 401 : 403, e.code.toLowerCase(), e.message);
    throw e;
  }
  const rl = await rateLimit({ key: `ai-describe:${user.id}`, limit: 20, windowSec: 3600 });
  if (!rl.ok) {
    const res = jsonError(429, "rate_limited", "Лимит AI-генераций исчерпан (20 в час). Попробуйте позже.");
    res.headers.set("Retry-After", String(rl.retryAfter));
    return res;
  }
  const [input, err] = await parseJson(req, describeInputSchema);
  if (err) return err;
  const out = await generateProductDescription(input, user.id);
  return jsonOk({ description: out.description, shortDescription: out.shortDescription, tags: out.tags, provider: out.provider, model: out.model, mock: out.mock });
}
