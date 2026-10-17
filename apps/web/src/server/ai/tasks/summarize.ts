import "server-only";
import { complete } from "../client";
import type { AiMeta } from "../types";

const SYSTEM = `Ты аналитик маркетплейса. По JSON-метрикам напиши краткую сводку для администратора по-русски: 4-6 маркированных пунктов (• ...): динамика оборота и выручки, заказы и конверсия, лидеры, проблемные места воронки/возвратов, одна рекомендация. Используй только данные из JSON, ничего не выдумывай, числа не округляй произвольно.`;

/** Plain-text executive summary of dashboard metrics. `fallback` renders the deterministic text when no LLM answered. */
export async function summarizeMetrics(facts: unknown, fallback: () => string, userId?: string): Promise<{ text: string } & AiMeta> {
  const res = await complete({
    task: "metrics_summary",
    userId,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify(facts).slice(0, 12_000) },
    ],
    opts: { maxTokens: 700 },
  });
  const text = res?.content.trim();
  if (res && text) return { text, provider: res.provider, model: res.model, mock: false };
  return { text: fallback(), provider: "mock", model: "rule-based", mock: true };
}
