/**
 * Yandex Metrika helpers (client only). Everything is a safe no-op when the counter is not configured or blocked
 * (ad-blockers, local dev without NEXT_PUBLIC_YM_ID). Zone D owns the counter script in components/analytics;
 * this file only calls window.ym / dataLayer defensively.
 */
declare global {
  interface Window {
    ym?: (counterId: number, method: string, ...args: unknown[]) => void;
    dataLayer?: unknown[];
    __ymId?: number;
  }
}

function counterId(): number | null {
  if (typeof window === "undefined") return null;
  const fromWindow = window.__ymId;
  const fromEnv = Number(process.env.NEXT_PUBLIC_YM_ID);
  const id = Number.isFinite(fromWindow) && fromWindow ? fromWindow : fromEnv;
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** ym(id, 'reachGoal', goal, params). Never throws. */
export function reachGoal(goal: string, params?: Record<string, unknown>): void {
  try {
    const id = counterId();
    if (!id || typeof window.ym !== "function") return;
    window.ym(id, "reachGoal", goal, params);
  } catch {
    /* analytics must never break UI */
  }
}

export interface EcommerceProduct {
  id: string;
  name: string;
  /** RUB (not kopecks) */
  price: number;
  quantity?: number;
  variant?: string;
  category?: string;
}

/** Push a Metrika ecommerce event ('detail' | 'add' | 'remove') to window.dataLayer. */
export function pushEcommerce(action: "detail" | "add" | "remove", product: EcommerceProduct): void {
  try {
    if (typeof window === "undefined" || !counterId()) return;
    window.dataLayer = window.dataLayer ?? [];
    window.dataLayer.push({ ecommerce: { currencyCode: "RUB", [action]: { products: [{ quantity: 1, ...product }] } } });
  } catch {
    /* ignore */
  }
}

export interface PurchaseInput {
  /** order number / id */
  id: string;
  /** RUB (not kopecks) */
  revenue: number;
  coupon?: string;
  products: EcommerceProduct[];
}

/**
 * Metrika ecommerce `purchase` (Zone D). Call once on the order success page:
 *   pushPurchase({ id: order.number, revenue: order.total / 100, products: [...] })
 * Also fires the `purchase` goal. Safe no-op without a counter.
 */
export function pushPurchase(order: PurchaseInput): void {
  try {
    if (typeof window === "undefined" || !counterId()) return;
    window.dataLayer = window.dataLayer ?? [];
    window.dataLayer.push({
      ecommerce: {
        currencyCode: "RUB",
        purchase: {
          actionField: { id: order.id, revenue: order.revenue, ...(order.coupon ? { coupon: order.coupon } : {}) },
          products: order.products.map((p) => ({ quantity: 1, ...p })),
        },
      },
    });
    reachGoal("purchase", { order_price: order.revenue, currency: "RUB", order_id: order.id });
  } catch {
    /* ignore */
  }
}

/** Virtual page hit for SPA navigation (called by <YandexMetrika/> on route change). */
export function hit(url: string, opts?: { title?: string; referer?: string }): void {
  try {
    const id = counterId();
    if (!id || typeof window.ym !== "function") return;
    window.ym(id, "hit", url, opts);
  } catch {
    /* ignore */
  }
}
