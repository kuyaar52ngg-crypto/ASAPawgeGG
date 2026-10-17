"use client";
import type { AnalyticsEventName } from "@asap/shared";
import { reachGoal } from "@/lib/metrika";

export type ClientEventName = AnalyticsEventName | "product_view";

/** Events that are also sent to Yandex Metrika as goals (create goals with the same identifiers in the Metrika UI). */
const METRIKA_GOALS = new Set<ClientEventName>([
  "view_item",
  "product_view",
  "search",
  "add_to_cart",
  "remove_from_cart",
  "begin_checkout",
  "add_payment_info",
  "purchase",
  "sign_up",
  "login",
  "topup_balance",
  "steam_topup_start",
  "favorite_add",
  "review_submit",
  "dispute_open",
  "ai_chat_message",
]);

const ENDPOINT = "/api/analytics/event";

/**
 * Fire-and-forget client analytics (CONTRACTS §14): POST /api/analytics/event (+ Metrika goal when configured).
 * Never throws and never blocks the UI. The visitor id (`asap_sid` cookie) is created by the server.
 */
export function trackClient(name: ClientEventName, properties?: Record<string, unknown>, opts: { path?: string; referrer?: string; goal?: boolean } = {}): void {
  try {
    if (typeof window === "undefined") return;
    if (opts.goal !== false && METRIKA_GOALS.has(name)) reachGoal(name === "product_view" ? "view_item" : name, properties);
    const body = JSON.stringify({
      name,
      path: opts.path ?? window.location.pathname,
      referrer: opts.referrer ?? (document.referrer || undefined),
      properties,
    });
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
    void fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true, credentials: "same-origin" }).catch(() => {});
  } catch {
    /* analytics must never break the UI */
  }
}
