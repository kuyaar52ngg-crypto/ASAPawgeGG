"use client";
import * as React from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatRub } from "@asap/shared";

export interface ChartPoint {
  date: string;
  revenue: number;
  orders: number;
}

const shortDate = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}.${m}`;
};
const compact = (kopecks: number) => {
  const r = kopecks / 100;
  return r >= 1_000_000 ? `${(r / 1_000_000).toFixed(1)}M` : r >= 1000 ? `${Math.round(r / 1000)}k` : String(Math.round(r));
};

/** Revenue-by-day area chart (kopecks in, ₽ out). Colours come from the theme tokens so it follows dark/light. */
export function SalesChart({ data, height = 280 }: { data: ChartPoint[]; height?: number }) {
  const gid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const hasData = data.some((d) => d.revenue > 0);
  return (
    <div style={{ height }} className="relative w-full" role="img" aria-label="График выручки по дням">
      {!hasData && <p className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">За выбранный период продаж не было</p>}
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tickFormatter={compact} stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} width={44} />
          <Tooltip
            cursor={{ stroke: "var(--primary)", strokeOpacity: 0.3 }}
            contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--popover-foreground)", fontSize: 12 }}
            labelFormatter={(l) => shortDate(String(l))}
            formatter={(v, name) => (name === "revenue" ? [formatRub(Number(v)), "Выручка"] : [String(v), "Заказов"])}
          />
          <Area type="monotone" dataKey="revenue" stroke="var(--primary)" strokeWidth={2.5} fill={`url(#${gid})`} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
