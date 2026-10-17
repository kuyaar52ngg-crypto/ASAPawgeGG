"use client";
import * as React from "react";
import { pushEcommerce, reachGoal } from "@/lib/metrika";

/** Fires Metrika "view_item" goal + ecommerce detail once per product view. */
export function ProductViewTracker({ id, name, price, category, variant }: { id: string; name: string; price: number; category: string; variant?: string }) {
  React.useEffect(() => {
    reachGoal("view_item", { productId: id });
    pushEcommerce("detail", { id, name, price: price / 100, category, variant });
  }, [id, name, price, category, variant]);
  return null;
}
