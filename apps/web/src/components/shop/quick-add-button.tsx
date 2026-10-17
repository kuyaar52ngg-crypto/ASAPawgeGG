"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { addToCartAction } from "@/server/catalog/actions";
import { pushEcommerce, reachGoal } from "@/lib/metrika";

/** One-click "В корзину" for products that need no extra input (single option, instant delivery). */
export function QuickAddButton({ productId, title, price, className }: { productId: string; title: string; price: number; className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [done, setDone] = React.useState(false);

  function add(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    startTransition(async () => {
      const res = await addToCartAction({ productId, quantity: 1 });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setDone(true);
      setTimeout(() => setDone(false), 1800);
      reachGoal("add_to_cart", { productId });
      pushEcommerce("add", { id: productId, name: title, price: price / 100 });
      toast.success("Добавлено в корзину", { description: title, action: { label: "Перейти", onClick: () => router.push("/cart") } });
      router.refresh();
    });
  }

  return (
    <Button type="button" size="sm" loading={pending} onClick={add} className={className} aria-label={`Добавить в корзину: ${title}`}>
      {done ? <Check /> : <ShoppingCart />}
      {done ? "Добавлено" : "В корзину"}
    </Button>
  );
}
