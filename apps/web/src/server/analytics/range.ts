import { PERIOD_OPTIONS, type PeriodDays } from "./types";

const DAY_MS = 86_400_000;

export function parsePeriod(raw: string | string[] | undefined | null, fallback: PeriodDays = 30): PeriodDays {
  const v = Number(Array.isArray(raw) ? raw[0] : raw);
  return (PERIOD_OPTIONS as readonly number[]).includes(v) ? (v as PeriodDays) : fallback;
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface PeriodWindow {
  days: PeriodDays;
  /** inclusive start of the current period (00:00 UTC) */
  from: Date;
  /** exclusive end = start of tomorrow (UTC) */
  to: Date;
  prevFrom: Date;
  /** exclusive end of previous period (= `from`) */
  prevTo: Date;
}

/** The last `days` UTC days including today, and the `days` days right before them. */
export function periodWindow(days: PeriodDays, now: Date = new Date()): PeriodWindow {
  const to = new Date(startOfUtcDay(now).getTime() + DAY_MS);
  const from = new Date(to.getTime() - days * DAY_MS);
  const prevFrom = new Date(from.getTime() - days * DAY_MS);
  return { days, from, to, prevFrom, prevTo: from };
}

/** Every UTC date (YYYY-MM-DD) in [from, to). */
export function eachDay(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += DAY_MS) out.push(isoDate(new Date(t)));
  return out;
}

/** Relative change in percent, null when the baseline is zero. */
export function deltaPct(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function ratioPct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}
