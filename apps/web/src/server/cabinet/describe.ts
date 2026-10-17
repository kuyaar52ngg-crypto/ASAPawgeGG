import "server-only";
import { headers } from "next/headers";
import { z } from "zod";
import { DELIVERY_MODE_LABELS, PLATFORMS, PRODUCT_TYPES, PRODUCT_TYPE_LABELS, REGIONS, type DeliveryModeName, type ProductTypeName } from "@asap/shared";
import { rateLimit } from "@/lib/rate-limit";
import type { SessionUser } from "@/server/auth/session";
import { fail, ok, zodFail, type ActionResult } from "./result";

const describeInputSchema = z.object({
  title: z.string().trim().min(3, "Сначала введите название товара").max(160),
  type: z.enum(PRODUCT_TYPES),
  deliveryMode: z.enum(["AUTO_STOCK", "MANUAL"]).default("AUTO_STOCK"),
  platform: z.string().max(40).nullish(),
  region: z.string().max(40).nullish(),
  categoryName: z.string().max(120).nullish(),
  /** optional hints from the seller: edition, DLC, what is included… */
  notes: z.string().trim().max(1000).optional(),
});

export interface DescribeResult {
  description: string;
  shortDescription?: string;
  tags?: string[];
  /** "ai": zone F endpoint /api/ai/describe answered; "template": local fallback (AI unavailable) */
  source: "ai" | "template";
  provider?: string;
  /** the AI layer ran in deterministic mock mode (no provider keys) */
  mock?: boolean;
}

const aiResponseSchema = z.object({
  description: z.string().min(10),
  shortDescription: z.string().optional(),
  tags: z.array(z.string()).optional(),
  provider: z.string().optional(),
  mock: z.boolean().optional(),
});

/** Deterministic Russian description used when the AI endpoint is unavailable. Clearly labelled to the seller as a template. */
export function templateDescription(i: z.infer<typeof describeInputSchema>): DescribeResult {
  const type = PRODUCT_TYPE_LABELS[i.type as ProductTypeName].toLowerCase();
  const platform = PLATFORMS.find((p) => p.value === i.platform)?.label;
  const region = REGIONS.find((r) => r.value === i.region)?.label;
  const delivery =
    i.deliveryMode === "AUTO_STOCK"
      ? "данные для активации появятся в личном кабинете сразу после оплаты."
      : "продавец выполнит заказ после оплаты, статус и данные будут в личном кабинете.";
  const lines = [
    `${i.title} — ${type}${platform ? ` для ${platform}` : ""}${region ? `, регион: ${region}` : ""}.`,
    "",
    "Что вы получаете:",
    `• ${DELIVERY_MODE_LABELS[i.deliveryMode as DeliveryModeName]}: ${delivery}`,
    ...(platform ? [`• Платформа: ${platform}.`] : []),
    ...(region ? [`• Регион активации: ${region} — проверьте, что он подходит вашему аккаунту.`] : []),
    ...(i.notes ? [`• ${i.notes}`] : []),
    "",
    "Если что-то пойдёт не так, откройте спор в заказе — продавец и поддержка помогут разобраться.",
  ];
  return {
    description: lines.join("\n"),
    shortDescription: `${i.title} — ${type}${platform ? ` для ${platform}` : ""}. Моментальная выдача после оплаты.`.slice(0, 240),
    tags: [type, ...(platform ? [platform] : []), ...(region ? [region] : [])].map((t) => t.toLowerCase()),
    source: "template",
  };
}

/**
 * «AI: сгенерировать описание». Calls zone F's `POST /api/ai/describe` (forwarding the seller's session cookie so F can authenticate
 * and log the call). Expected body: { title, type, deliveryMode, platform?, region?, categoryName?, notes?, language: "ru" }
 * Expected answer: { ok: true, data: { description, shortDescription?, tags?, provider?, mock? } }.
 * If the endpoint is absent / failing, falls back to a local template so the form always works.
 */
export async function describeProduct(user: Pick<SessionUser, "id">, raw: unknown): Promise<ActionResult<DescribeResult>> {
  const parsed = describeInputSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const rl = await rateLimit({ key: `ai-describe:${user.id}`, limit: 20, windowSec: 600 });
  if (!rl.ok) return fail("Слишком много запросов к AI. Попробуйте через несколько минут.");

  const base = (process.env.WEB_INTERNAL_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  try {
    const cookie = (await headers()).get("cookie") ?? "";
    const res = await fetch(`${base}/api/ai/describe`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...parsed.data, language: "ru" }),
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: unknown } & Record<string, unknown>;
      const body = aiResponseSchema.safeParse(json.data ?? json);
      if (body.success) return ok({ ...body.data, source: "ai" as const });
    }
  } catch (e) {
    console.warn("[cabinet] /api/ai/describe unavailable:", (e as Error).message);
  }
  return ok(templateDescription(parsed.data));
}
