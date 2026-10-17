import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** Star rating (0..5). `value` may be fractional. */
export function Rating({ value, count, size = 14, className }: { value: number; count?: number; size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm", className)}>
      <Star className="fill-warning text-warning" style={{ width: size, height: size }} />
      <span className="font-semibold">{value > 0 ? value.toFixed(1) : "—"}</span>
      {typeof count === "number" && <span className="text-muted-foreground">({count})</span>}
    </span>
  );
}
