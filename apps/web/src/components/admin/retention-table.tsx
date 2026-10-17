import type { RetentionRow } from "@/server/analytics/types";
import { fmtDate } from "./labels";

/** Weekly signup cohorts: % of the cohort that came back N weeks after signing up. */
export function RetentionTable({ rows }: { rows: RetentionRow[] }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">Недостаточно регистраций для когорт</p>;
  const cols = rows[0]!.weeks.length;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-1 text-center text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="px-2 py-1 text-left font-medium">Когорта (неделя)</th>
            <th className="px-2 py-1 font-medium">Польз.</th>
            {Array.from({ length: cols }, (_, i) => (
              <th key={i} className="px-2 py-1 font-medium">{i === 0 ? "Нед. 0" : `+${i}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cohort}>
              <td className="px-2 py-1 text-left whitespace-nowrap font-medium">{fmtDate(`${r.cohort}T00:00:00Z`)}</td>
              <td className="px-2 py-1 tabular-nums text-muted-foreground">{r.size}</td>
              {r.weeks.map((v, i) => (
                <td key={i} className="rounded-md px-2 py-1.5 tabular-nums" style={v === null ? undefined : { background: `color-mix(in oklab, var(--primary) ${Math.round(Math.min(100, v) * 0.75)}%, transparent)` }}>
                  {v === null ? <span className="text-muted-foreground/40">·</span> : `${Math.round(v)}%`}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
