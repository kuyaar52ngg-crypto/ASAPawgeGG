import "server-only";
import { z } from "zod";
import { PRODUCT_TYPES, DELIVERY_MODES } from "@asap/shared";
import { complete } from "../client";
import { templateDescription, type DescribeOutput } from "../heuristics";
import type { AiMeta } from "../types";
import { parseModelJson } from "./json";

export const describeInputSchema = z.object({
  title: z.string().trim().min(3).max(160),
  type: z.enum(PRODUCT_TYPES),
  deliveryMode: z.enum(DELIVERY_MODES),
  platform: z.string().trim().max(40).nullish(),
  region: z.string().trim().max(40).nullish(),
  categoryName: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(1500).nullish(),
  language: z.literal("ru").default("ru"),
});
export type DescribeInput = z.infer<typeof describeInputSchema>;

const outputSchema = z.object({
  description: z.string().trim().min(30).max(6000),
  shortDescription: z.string().trim().max(240).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(15).optional(),
});

const SYSTEM = `Ты копирайтер маркетплейса цифровых товаров ASAPawge GG (игры, подписки, пополнение Steam, подарочные карты). Пиши по-русски, честно и конкретно, без выдуманных фактов (не придумывай цены, сроки гарантий и характеристики, которых нет во входных данных), без капса и эмодзи, без контактов и ссылок. Структура описания: что это, что получит покупатель, как происходит выдача и активация, на что обратить внимание (регион, платформа). Верни ТОЛЬКО JSON-объект: {"description": string (3-5 абзацев, до 1500 символов), "shortDescription": string (до 200 символов), "tags": string[] (до 8 поисковых тегов в нижнем регистре)}.`;

export async function generateProductDescription(input: DescribeInput, userId?: string): Promise<DescribeOutput & AiMeta> {
  const res = await complete({
    task: "describe",
    userId,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify({ title: input.title, type: input.type, deliveryMode: input.deliveryMode, platform: input.platform, region: input.region, category: input.categoryName, sellerNotes: input.notes }) },
    ],
    opts: { json: true, maxTokens: 1200 },
    logInput: { title: input.title },
  });
  const parsed = res ? parseModelJson(res.content, outputSchema) : null;
  if (res && parsed) {
    return { description: parsed.description, shortDescription: (parsed.shortDescription ?? "").slice(0, 240), tags: parsed.tags ?? [], provider: res.provider, model: res.model, mock: false };
  }
  return { ...templateDescription(input), provider: "mock", model: "rule-based", mock: true };
}
