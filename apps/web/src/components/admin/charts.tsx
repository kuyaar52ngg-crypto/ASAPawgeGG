"use client";
import * as React from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatRub } from "@asap/shared";
import type { CategorySlice, DayPoint, PaymentSlice } from "@/server/analytics/types";

/**
 * Recharts widgets for the admin dashboard. Colours come from theme CSS variables (--primary, --accent, ...)
 * so they follow the dark/light switch. Rendered after mount to avoid SSR size warnings.
 */

const C = {
  primary: "var(--primary)",
  accent: "var(--accent)",
  success: "var(--success)",
  warning: "var(--warning)",
  grid: "var(--border)",
  text: "var(--muted-foreground)",
};
const DONUT_COLORS = [C.primary, C.accent, C.success, C.warning, "#f472b6", "#94a3b8"];

const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });
const dayFmt = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}.${m}`;
};

function useMounted() {
  // false on the server and during hydration, true on the client afterwards
  return React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function ChartBox({ height, children }: { height: number; children: React.ReactElement }) {
  const mounted = useMounted();
  if (!mounted) return <div style={{ height }} className="skeleton rounded-xl" />;
  return (
    <ResponsiveContainer width="100%" height={height} minWidth={0} initialDimension={{ width: 600, height }}>
      {children}
    </ResponsiveContainer>
  );
}

type TipRow = { name?: string; value?: number | string; color?: string; dataKey?: string | number; payload?: unknown };
function TipBox({ title, rows }: { title?: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-xl border border-border bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      {title && <p className="mb-1 font-semibold text-foreground">{title}</p>}
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-muted-foreground">
          {r.color && <span className="size-2 rounded-full" style={{ background: r.color }} />}
          <span>{r.label}</span>
          <span className="ml-auto pl-3 font-semibold text-foreground tabular-nums">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

// ───────────────────────── revenue & orders ─────────────────────────

export function RevenueChart({ data }: { data: DayPoint[] }) {
  return (
    <ChartBox height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gGmv" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.primary} stopOpacity={0.45} />
            <stop offset="100%" stopColor={C.primary} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.accent} stopOpacity={0.4} />
            <stop offset="100%" stopColor={C.accent} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={C.grid} strokeDasharray="3 4" vertical={false} />
        <XAxis dataKey="date" tickFormatter={dayFmt} tick={{ fill: C.text, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis yAxisId="money" tickFormatter={(v: number) => compact.format(v / 100)} tick={{ fill: C.text, fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
        <YAxis yAxisId="orders" orientation="right" allowDecimals={false} tick={{ fill: C.text, fontSize: 11 }} tickLine={false} axisLine={false} width={32} />
        <Tooltip
          cursor={{ stroke: C.grid }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const p = (payload as unknown as TipRow[]).reduce<Record<string, number>>((acc, r) => ({ ...acc, [String(r.dataKey)]: Number(r.value) }), {});
            return (
              <TipBox
                title={dayFmt(String(label))}
                rows={[
                  { label: "GMV", value: formatRub(p.gmv ?? 0), color: C.primary },
                  { label: "Чистая выручка", value: formatRub(p.revenue ?? 0), color: C.accent },
                  { label: "Заказы", value: nf.format(p.orders ?? 0), color: C.warning },
                ]}
              />
            );
          }}
        />
        <Area yAxisId="money" type="monotone" dataKey="gmv" stroke={C.primary} strokeWidth={2} fill="url(#gGmv)" />
        <Area yAxisId="money" type="monotone" dataKey="revenue" stroke={C.accent} strokeWidth={2} fill="url(#gRev)" />
        <Line yAxisId="orders" type="monotone" dataKey="orders" stroke={C.warning} strokeWidth={2} dot={false} />
      </ComposedChart>
    </ChartBox>
  );
}

export function LegendDots({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ───────────────────────── categories ─────────────────────────

export function CategoryChart({ data }: { data: CategorySlice[] }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-muted-foreground">Нет оплаченных заказов за период</p>;
  const height = Math.max(220, data.length * 40 + 20);
  return (
    <ChartBox height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} strokeDasharray="3 4" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={{ fill: C.text, fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" width={118} tick={{ fill: C.text, fontSize: 12 }} tickLine={false} axisLine={false} />
        <Tooltip
          cursor={{ fill: "var(--border)", opacity: 0.4 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0]!.payload as CategorySlice;
            return <TipBox title={d.name} rows={[{ label: "Заказы", value: nf.format(d.orders), color: C.primary }, { label: "Оборот", value: formatRub(d.revenue) }]} />;
          }}
        />
        <Bar dataKey="orders" radius={[0, 8, 8, 0]} barSize={20}>
          {data.map((_, i) => (
            <Cell key={i} fill={C.primary} fillOpacity={Math.max(0.35, 1 - i * 0.08)} />
          ))}
        </Bar>
      </BarChart>
    </ChartBox>
  );
}

// ───────────────────────── payment methods donut ─────────────────────────

export function PaymentDonut({ data }: { data: PaymentSlice[] }) {
  const total = data.reduce((s, d) => s + d.orders, 0);
  if (!total) return <p className="py-10 text-center text-sm text-muted-foreground">Нет оплат за период</p>;
  return (
    <div className="grid gap-4">
      <div className="relative">
        <ChartBox height={220}>
          <PieChart>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]!.payload as PaymentSlice;
                return <TipBox title={d.label} rows={[{ label: "Заказы", value: `${nf.format(d.orders)} (${Math.round((d.orders / total) * 100)}%)` }, { label: "Сумма", value: formatRub(d.amount) }]} />;
              }}
            />
            <Pie data={data} dataKey="orders" nameKey="label" innerRadius={62} outerRadius={92} paddingAngle={3} stroke="none" cornerRadius={6}>
              {data.map((_, i) => (
                <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ChartBox>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl font-bold">{nf.format(total)}</span>
          <span className="text-xs text-muted-foreground">оплат</span>
        </div>
      </div>
      <ul className="grid gap-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.provider} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
            <span>{d.label}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">{formatRub(d.amount)}</span>
            <span className="w-11 text-right font-semibold tabular-nums">{Math.round((d.orders / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────────────────────── DAU ─────────────────────────

export function TrafficChart({ data }: { data: DayPoint[] }) {
  return (
    <ChartBox height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gDau" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.success} stopOpacity={0.4} />
            <stop offset="100%" stopColor={C.success} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={C.grid} strokeDasharray="3 4" vertical={false} />
        <XAxis dataKey="date" tickFormatter={dayFmt} tick={{ fill: C.text, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis allowDecimals={false} tick={{ fill: C.text, fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
        <Tooltip
          cursor={{ stroke: C.grid }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]!.payload as DayPoint;
            return <TipBox title={dayFmt(String(label))} rows={[{ label: "Посетители (DAU)", value: nf.format(p.dau), color: C.success }, { label: "Сессии", value: nf.format(p.sessions), color: C.accent }, { label: "Новые пользователи", value: nf.format(p.newUsers) }]} />;
          }}
        />
        <Area type="monotone" dataKey="dau" stroke={C.success} strokeWidth={2} fill="url(#gDau)" />
        <Line type="monotone" dataKey="sessions" stroke={C.accent} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
      </AreaChart>
    </ChartBox>
  );
}
