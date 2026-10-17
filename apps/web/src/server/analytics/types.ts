/** Client-safe shapes of the admin analytics payload (everything JSON-serialisable; money in kopecks). */

export type PeriodDays = 7 | 30 | 90;
export const PERIOD_OPTIONS: readonly PeriodDays[] = [7, 30, 90];

export interface Kpi {
  key: "gmv" | "revenue" | "orders" | "conversion" | "aov" | "newUsers" | "activeSellers" | "refundRate";
  label: string;
  /** current-period value (kopecks for money, 0..100 for percents, plain count otherwise) */
  value: number;
  previous: number;
  /** relative change vs previous period in percent; null when previous = 0 */
  deltaPct: number | null;
  /** absolute change in percentage points (only for percent KPIs) */
  deltaPoints?: number | null;
  format: "money" | "int" | "percent";
  /** true when a *decrease* is the good direction (refund rate) */
  invert?: boolean;
  hint?: string;
}

export interface DayPoint {
  /** YYYY-MM-DD (UTC) */
  date: string;
  gmv: number;
  revenue: number;
  orders: number;
  newUsers: number;
  /** distinct visitors/users with any event that day */
  dau: number;
  sessions: number;
}

export interface CategorySlice {
  name: string;
  orders: number;
  revenue: number;
}
export interface PaymentSlice {
  provider: string;
  label: string;
  orders: number;
  amount: number;
}
export interface FunnelStep {
  key: "page_view" | "view_item" | "add_to_cart" | "begin_checkout" | "purchase";
  label: string;
  /** distinct sessions/users that fired the event in the period */
  count: number;
  /** % of the first step */
  ofFirst: number;
  /** % of the previous step (100 for the first) */
  ofPrev: number;
}
export interface TopProduct {
  id: string;
  title: string;
  slug: string;
  seller: string;
  units: number;
  revenue: number;
}
export interface TopSeller {
  id: string;
  shopName: string;
  slug: string | null;
  orders: number;
  revenue: number;
  fee: number;
}
export interface RetentionRow {
  /** Monday of the cohort week, YYYY-MM-DD */
  cohort: string;
  size: number;
  /** index = weeks since signup; null = not reached yet. Values are percents 0..100 */
  weeks: (number | null)[];
}

export interface DashboardMetrics {
  days: PeriodDays;
  /** inclusive UTC dates of the current period */
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  generatedAt: string;
  kpis: Kpi[];
  series: DayPoint[];
  byCategory: CategorySlice[];
  payments: PaymentSlice[];
  funnel: FunnelStep[];
  topProducts: TopProduct[];
  topSellers: TopSeller[];
  engagement: { dauAvg7: number; dauLastDay: number; mau: number; stickiness: number; sessions: number };
  retention: RetentionRow[];
  /** how many closed days used a DailyMetric snapshot for `sessions` (the rest was computed live) */
  snapshotDays: number;
}

export interface TrafficReport {
  days: PeriodDays;
  events: { name: string; count: number; uniques: number }[];
  topPages: { path: string; views: number }[];
  topReferrers: { referrer: string; visits: number }[];
  topSearches: { q: string; count: number }[];
  totalEvents: number;
  sessions: number;
}
