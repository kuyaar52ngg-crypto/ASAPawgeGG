import type { FunnelStep } from "@/server/analytics/types";

const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const pf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

/** Sales funnel: visits → product views → add to cart → checkout → paid (distinct sessions, from AnalyticsEvent). */
export function SalesFunnel({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(1, steps[0]?.count ?? 1);
  if (!steps.some((s) => s.count > 0)) return <p className="py-10 text-center text-sm text-muted-foreground">Нет событий за период</p>;
  return (
    <ol className="grid gap-3">
      {steps.map((s, i) => (
        <li key={s.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium">{s.label}</span>
            <span className="tabular-nums">
              <span className="font-semibold">{nf.format(s.count)}</span>
              {i > 0 && <span className="ml-2 text-xs text-muted-foreground">{pf.format(s.ofPrev)}% от пред. · {pf.format(s.ofFirst)}% от визитов</span>}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-foreground/[0.07]">
            <div className="gradient-brand h-full rounded-full" style={{ width: `${Math.max(2, (s.count / max) * 100)}%`, opacity: 1 - i * 0.12 }} />
          </div>
        </li>
      ))}
    </ol>
  );
}
