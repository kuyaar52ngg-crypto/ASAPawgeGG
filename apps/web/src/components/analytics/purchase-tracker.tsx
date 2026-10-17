"use client";
import { useEffect, useRef } from "react";
import { pushPurchase, type EcommerceProduct } from "@/lib/metrika";
import { trackClient } from "./track-client";

/**
 * Drop onto the order success page (zone B): reports the purchase to Metrika ecommerce (+ goal) exactly once per order
 * (guarded by sessionStorage) and to first-party analytics (the server's own `purchase` event de-duplicates by orderId).
 *   <PurchaseTracker orderId={order.id} number={order.number} revenue={order.total / 100} products={[{ id, name, price, quantity }]} />
 */
export function PurchaseTracker({ orderId, number, revenue, coupon, products }: { orderId: string; number: string; revenue: number; coupon?: string; products: EcommerceProduct[] }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const key = `asap:purchase:${orderId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* private mode: fall through, server de-duplicates */
    }
    pushPurchase({ id: number, revenue, coupon, products });
    trackClient("purchase", { orderId, value: revenue, currency: "RUB" }, { goal: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
