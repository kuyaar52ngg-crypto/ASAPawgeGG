import { discountPercent, formatRub } from "@asap/shared";
import { cn } from "@/lib/utils";
import { Badge } from "./badge";

/** Price block: current price, struck-through old price and -N% badge. Amounts in kopecks. */
export function Price({ price, oldPrice, from, size = "md", className }: { price: number; oldPrice?: number | null; from?: boolean; size?: "sm" | "md" | "lg"; className?: string }) {
  const pct = discountPercent(price, oldPrice);
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-1", className)}>
      <span className={cn("font-display font-bold", size === "lg" ? "text-3xl" : size === "md" ? "text-lg" : "text-base")}>
        {from && <span className="mr-1 text-xs font-medium text-muted-foreground">от</span>}
        {formatRub(price)}
      </span>
      {pct > 0 && oldPrice ? (
        <>
          <span className="text-sm text-muted-foreground line-through">{formatRub(oldPrice)}</span>
          <Badge variant="discount">-{pct}%</Badge>
        </>
      ) : null}
    </div>
  );
}
