import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatRub } from "@asap/shared";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Kpi } from "@/server/analytics/types";

const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const pf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export function formatKpiValue(k: Pick<Kpi, "format" | "value">): string {
  if (k.format === "money") return formatRub(Math.round(k.value));
  if (k.format === "percent") return `${pf.format(k.value)}%`;
  return nf.format(k.value);
}

/** Tiny dependency-free sparkline (server-renderable). */
function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const w = 100;
  const h = 28;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(2)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(2)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-7 w-full", className)} aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Delta({ kpi, days }: { kpi: Kpi; days: number }) {
  const isPercent = kpi.format === "percent";
  const raw = isPercent ? (kpi.deltaPoints ?? null) : kpi.deltaPct;
  if (raw === null || raw === undefined || (kpi.previous === 0 && kpi.value === 0)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3.5" /> нет данных за прошлый период
      </span>
    );
  }
  const flat = Math.abs(raw) < 0.05;
  const up = raw > 0;
  const good = flat ? null : kpi.invert ? !up : up;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const text = isPercent ? `${raw > 0 ? "+" : ""}${pf.format(raw)} п.п.` : `${raw > 0 ? "+" : ""}${pf.format(raw)}%`;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold", good === null ? "bg-foreground/10 text-muted-foreground" : good ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
        <Icon className="size-3.5" />
        {text}
      </span>
      <span className="text-muted-foreground">к пред. {days} дн.</span>
    </span>
  );
}

export function KpiCard({ kpi, days, trend }: { kpi: Kpi; days: number; trend?: number[] }) {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <p className="text-sm text-muted-foreground">{kpi.label}</p>
      <p className="font-display text-2xl font-bold tabular-nums sm:text-[28px]">{formatKpiValue(kpi)}</p>
      <Delta kpi={kpi} days={days} />
      {trend && <Sparkline values={trend} className="mt-2 text-primary/70" />}
      {kpi.hint && <p className="mt-1 text-[11px] text-muted-foreground/80">{kpi.hint}</p>}
    </Card>
  );
}
