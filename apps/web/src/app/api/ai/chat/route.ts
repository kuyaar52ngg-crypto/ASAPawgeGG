import { z } from "zod";
import { jsonError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { ipFromRequest } from "@/lib/request";
import { getSessionUser } from "@/server/auth/session";
import { trackEvent } from "@/server/analytics/track";
import { runSupportAgent } from "@/server/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(30)
    .refine((m) => m[m.length - 1]!.role === "user", "Последнее сообщение должно быть от пользователя"),
});

/**
 * POST /api/ai/chat — streaming (SSE) support assistant. Guests may chat (catalog + FAQ tools only);
 * signed-in users additionally get order status (own orders only) and ticket creation.
 * Events: data: {"type":"text","delta"} | {"type":"tool","name"} | {"type":"done","mock","provider"} | {"type":"error","message"}
 */
export async function POST(req: Request): Promise<Response> {
  const user = await getSessionUser();
  const rl = await rateLimit({ key: user ? `ai-chat:u:${user.id}` : `ai-chat:ip:${ipFromRequest(req)}`, limit: user ? 40 : 15, windowSec: 600 });
  if (!rl.ok) {
    const res = jsonError(429, "rate_limited", "Слишком много сообщений. Подождите несколько минут.");
    res.headers.set("Retry-After", String(rl.retryAfter));
    return res;
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, "invalid_json", "Некорректный JSON");
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return jsonError(422, "validation_error", "Ошибка валидации", z.flattenError(parsed.error));

  void trackEvent({ name: "ai_chat_message", userId: user?.id, path: "/api/ai/chat" });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* client went away */
        }
      };
      try {
        for await (const ev of runSupportAgent({ userId: user?.id ?? null }, parsed.data.messages)) {
          if (req.signal.aborted) break;
          if (ev.type === "done") send({ type: "done", mock: ev.meta.mock, provider: ev.meta.provider });
          else send(ev);
        }
      } catch (e) {
        console.error("[ai] chat failed:", (e as Error).message);
        send({ type: "error", message: "Ассистент временно недоступен. Попробуйте позже или напишите нам через раздел «Контакты»." });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
