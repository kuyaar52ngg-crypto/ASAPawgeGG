import "server-only";
import { z } from "zod";
import { complete } from "../client";
import { ruleBasedModeration, type ModerationInput, type ModerationVerdict } from "../heuristics";
import type { AiMeta } from "../types";
import { parseModelJson } from "./json";

const outputSchema = z.object({
  score: z.coerce.number().min(0).max(100),
  verdict: z.enum(["approve", "review", "reject"]),
  reasons: z.array(z.string().trim().max(300)).max(10).default([]),
});

const SYSTEM = `Ты модератор маркетплейса цифровых товаров. Оцени карточку: категория и тип соответствуют описанию, нет запрещёнки (краденые аккаунты/карты, читы, взломанное ПО, фишинг, накрутки), нет контактов вне площадки (telegram, телефоны, ссылки), описание информативно, цена правдоподобна. Верни ТОЛЬКО JSON: {"score": 0-100, "verdict": "approve"|"review"|"reject", "reasons": string[] (по-русски, коротко)}. approve — безопасно публиковать (score >= 80), review — нужна проверка человеком, reject — нарушение правил.`;

/** Product moderation verdict (LLM with rule-based fallback). The worker job `ai_moderate_product` uses the same contract (CONTRACTS §10). */
export async function moderateProductContent(p: ModerationInput, userId?: string): Promise<ModerationVerdict & AiMeta> {
  const rules = ruleBasedModeration(p);
  const res = await complete({
    task: "moderation",
    userId,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify({ title: p.title, description: p.description.slice(0, 4000), price_rub: p.price / 100, type: p.type, images: p.imagesCount ?? 0 }) },
    ],
    opts: { json: true, maxTokens: 500 },
    logInput: { title: p.title },
  });
  const parsed = res ? parseModelJson(res.content, outputSchema) : null;
  if (res && parsed) {
    // hard rule hits can only make the verdict stricter, never looser
    const strict = rules.verdict === "reject" && parsed.verdict !== "reject";
    return strict
      ? { ...rules, reasons: [...new Set([...rules.reasons, ...parsed.reasons])], provider: res.provider, model: res.model, mock: false }
      : { score: Math.round(parsed.score), verdict: parsed.verdict, reasons: parsed.reasons, provider: res.provider, model: res.model, mock: false };
  }
  return { ...rules, provider: "mock", model: "rule-based", mock: true };
}
