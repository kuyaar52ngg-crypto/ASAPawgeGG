import { z } from "zod";
import { idSchema } from "@asap/shared";
import { jsonError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { getSessionUser } from "@/server/auth/session";
import { listDisputeMessages } from "@/server/cabinet/disputes";

export const dynamic = "force-dynamic";

const querySchema = z.object({ after: z.string().datetime().optional() });

/** Poll endpoint for the dispute chat. Visible to the dispute's buyer, its seller and ADMIN only. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthenticated", "Требуется вход");
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) return jsonError(404, "not_found", "Спор не найден");
  const q = querySchema.safeParse({ after: new URL(req.url).searchParams.get("after") ?? undefined });
  if (!q.success) return jsonError(422, "validation_error", "Некорректный параметр after");
  const rl = await rateLimit({ key: `dispute-poll:${user.id}`, limit: 60, windowSec: 60 });
  if (!rl.ok) return jsonError(429, "rate_limited", "Слишком много запросов");
  const data = await listDisputeMessages(user, id, q.data.after);
  if (!data) return jsonError(404, "not_found", "Спор не найден");
  return jsonOk(data);
}
