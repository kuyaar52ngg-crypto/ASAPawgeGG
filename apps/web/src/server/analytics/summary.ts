import "server-only";
import { formatRub } from "@asap/shared";
import { aiComplete, type AiTextResult } from "@/server/admin/ai";
import { getDashboardMetrics } from "./metrics";
import type { DashboardMetrics, Kpi } from "./types";

const pf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

function fmtKpi(k: Kpi): string {
  if (k.format === "money") return formatRub(Math.round(k.value));
  if (k.format === "percent") return `${pf.format(k.value)}%`;
  return pf.format(k.value);
}
function fmtDelta(k: Kpi): string {
  const v = k.format === "percent" ? k.deltaPoints : k.deltaPct;
  if (v === null || v === undefined) return "нет базы для сравнения";
  return `${v > 0 ? "+" : ""}${pf.format(v)}${k.format === "percent" ? " п.п." : "%"}`;
}

/** Deterministic Russian summary (no LLM) — used when no AI provider is configured or all providers failed. */
export function ruleBasedSummary(m: DashboardMetrics): string {
  const lines: string[] = [];
  const by = Object.fromEntries(m.kpis.map((k) => [k.key, k])) as Record<Kpi["key"], Kpi>;
  lines.push(`За последние ${m.days} дн. (${m.from} — ${m.to}) оборот составил ${fmtKpi(by.gmv)} (${fmtDelta(by.gmv)} к предыдущему периоду), чистая выручка площадки — ${fmtKpi(by.revenue)} (${fmtDelta(by.revenue)}).`);
  lines.push(`Оплачено заказов: ${fmtKpi(by.orders)} (${fmtDelta(by.orders)}), средний чек — ${fmtKpi(by.aov)} (${fmtDelta(by.aov)}), конверсия в оплату — ${fmtKpi(by.conversion)}.`);
  lines.push(`Новых пользователей: ${fmtKpi(by.newUsers)} (${fmtDelta(by.newUsers)}); активных продавцов: ${fmtKpi(by.activeSellers)}.`);

  const top = m.topProducts[0];
  if (top) lines.push(`Лидер продаж — «${top.title}» (${formatRub(top.revenue)}, ${top.units} шт.).`);
  const cat = m.byCategory[0];
  if (cat) lines.push(`Самая продаваемая категория — «${cat.name}»: ${cat.orders} заказов.`);

  const f = m.funnel;
  if (f.length === 5 && f[0]!.count > 0) {
    const worst = f.slice(1).reduce((a, b) => (b.ofPrev < a.ofPrev ? b : a));
    lines.push(`Главная просадка воронки — шаг «${worst.label}»: проходит только ${pf.format(worst.ofPrev)}% предыдущего шага.`);
  }

  const risks: string[] = [];
  if (by.refundRate.value >= 5) risks.push(`доля возвратов ${fmtKpi(by.refundRate)} — проверьте продавцов с жалобами и споры`);
  if ((by.gmv.deltaPct ?? 0) < -10) risks.push("оборот заметно снизился — проверьте трафик и промо-активность");
  if ((by.conversion.deltaPoints ?? 0) < -3) risks.push("конверсия в оплату упала — проверьте платёжные методы и выдачу");
  if (risks.length) lines.push(`На что обратить внимание: ${risks.join("; ")}.`);
  else lines.push("Явных рисков по основным метрикам не видно.");
  return lines.map((l) => `• ${l}`).join("\n");
}

function compactPayload(m: DashboardMetrics) {
  return {
    period: { days: m.days, from: m.from, to: m.to },
    kpis: m.kpis.map((k) => ({ metric: k.label, value: fmtKpi(k), change_vs_previous_period: fmtDelta(k) })),
    funnel: m.funnel.map((s) => ({ step: s.label, sessions: s.count, of_previous_step_pct: Math.round(s.ofPrev * 10) / 10 })),
    top_categories: m.byCategory.slice(0, 5).map((c) => ({ name: c.name, orders: c.orders, revenue: formatRub(c.revenue) })),
    payment_methods: m.payments.map((p) => ({ method: p.label, orders: p.orders })),
    top_products: m.topProducts.slice(0, 5).map((p) => ({ title: p.title, units: p.units, revenue: formatRub(p.revenue) })),
    top_sellers: m.topSellers.slice(0, 5).map((s) => ({ shop: s.shopName, orders: s.orders, revenue: formatRub(s.revenue) })),
    engagement: m.engagement,
  };
}

/** «AI-сводка» for the admin dashboard: LLM summary in Russian with a rule-based fallback. */
export async function summarizeMetrics(days: number, userId?: string): Promise<AiTextResult> {
  const m = await getDashboardMetrics(days);
  return aiComplete({
    task: "metrics_summary",
    userId,
    system:
      "Ты — аналитик маркетплейса цифровых товаров ASAPawge GG. Отвечай по-русски, кратко и по делу. Используй только переданные данные, " +
      "ничего не выдумывай. Суммы указаны в рублях. Формат: 5–7 маркированных пунктов (• ), в конце — 2 конкретные рекомендации администратору.",
    prompt: `Сделай сводку по метрикам площадки:\n${JSON.stringify(compactPayload(m), null, 1)}`,
    fallback: () => ruleBasedSummary(m),
  });
}
