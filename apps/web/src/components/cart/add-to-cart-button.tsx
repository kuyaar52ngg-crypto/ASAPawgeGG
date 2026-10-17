"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ShoppingCart, Zap } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { addToCart } from "@/server/cart/actions";

export interface AddToCartButtonProps extends Omit<ButtonProps, "onClick" | "children" | "loading"> {
  productId: string;
  variantId?: string | null;
  quantity?: number;
  /** buyer input, e.g. { steamLogin: "abc" } for Steam top-ups */
  meta?: { steamLogin?: string; amountKopecks?: number; buyerInput?: string } | null;
  /** go straight to the cart after adding ("Купить сейчас") */
  buyNow?: boolean;
  label?: string;
  /** called after a successful add */
  onAdded?: (cartCount: number) => void;
}

/** Client button for any product card / page: adds to the DB (user) or cookie (guest) cart via the `addToCart` server action. */
export function AddToCartButton({ productId, variantId, quantity = 1, meta, buyNow = false, label, onAdded, disabled, ...props }: AddToCartButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [added, setAdded] = React.useState(false);

  function onClick() {
    startTransition(async () => {
      const res = await addToCart({ productId, variantId: variantId ?? null, quantity, meta: meta ?? null });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setAdded(true);
      onAdded?.(res.data.cartCount);
      if (buyNow) {
        router.push("/cart");
        return;
      }
      toast.success("Добавлено в корзину", { action: { label: "Открыть корзину", onClick: () => router.push("/cart") } });
      router.refresh();
      setTimeout(() => setAdded(false), 2000);
    });
  }

  const defaultLabel = buyNow ? "Купить сейчас" : added ? "В корзине" : "В корзину";
  return (
    <Button type="button" onClick={onClick} loading={pending} disabled={disabled} {...props}>
      {!pending && (buyNow ? <Zap /> : added ? <Check /> : <ShoppingCart />)}
      {label ?? defaultLabel}
    </Button>
  );
}
