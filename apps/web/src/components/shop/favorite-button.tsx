"use client";
import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";
import { toggleFavoriteAction } from "@/server/catalog/actions";
import { reachGoal } from "@/lib/metrika";

/** Heart toggle (optimistic). Guests are sent to sign-in and returned to the same page. */
export function FavoriteButton({ productId, initial, className, variant = "overlay" }: { productId: string; initial: boolean; className?: string; variant?: "overlay" | "outline" }) {
  const router = useRouter();
  const pathname = usePathname();
  const [fav, setFav] = React.useState(initial);
  const [pending, startTransition] = React.useTransition();

  // adopt server value after a refresh (derive-state-from-props pattern)
  const [seen, setSeen] = React.useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setFav(initial);
  }

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    const next = !fav;
    setFav(next);
    startTransition(async () => {
      const res = await toggleFavoriteAction(productId);
      if (res.ok) {
        setFav(res.data.favorite);
        if (res.data.favorite) reachGoal("favorite_add", { productId });
        toast.success(res.data.favorite ? "Добавлено в избранное" : "Удалено из избранного");
        return;
      }
      setFav(!next);
      if (res.error === "UNAUTHENTICATED") {
        toast.info("Войдите, чтобы пользоваться избранным");
        router.push(`/sign-in?callbackUrl=${encodeURIComponent(pathname)}`);
      } else toast.error(res.error);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={fav}
      aria-label={fav ? "Убрать из избранного" : "Добавить в избранное"}
      className={cn(
        "relative z-10 flex size-9 items-center justify-center rounded-full transition-all active:scale-90",
        variant === "overlay" ? "bg-background/60 text-foreground backdrop-blur hover:bg-background/85" : "size-11 rounded-xl border border-input hover:border-primary/50 hover:bg-foreground/5",
        className,
      )}
    >
      <Heart className={cn("size-[18px] transition-colors", fav ? "fill-destructive text-destructive" : "")} />
    </button>
  );
}
