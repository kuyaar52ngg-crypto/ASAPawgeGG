import Image from "next/image";
import { formatRub } from "@asap/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface SummaryLine {
  id: string;
  title: string;
  variantTitle?: string | null;
  image?: string | null;
  quantity: number;
  /** kopecks, line total */
  total: number;
}

/** Compact, read-only list of purchased / to-be-purchased lines with totals. */
export function OrderSummary({
  lines,
  subtotal,
  discount = 0,
  total,
  className,
  children,
}: {
  lines: SummaryLine[];
  subtotal: number;
  discount?: number;
  total: number;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-4", className)}>
      <ul className="space-y-3">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center gap-3">
            <span className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted">{l.image && <Image src={l.image} alt="" fill sizes="48px" className="object-cover" />}</span>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-1 text-sm font-medium">{l.title}</p>
              <p className="text-xs text-muted-foreground">
                {l.variantTitle ? `${l.variantTitle} · ` : ""}
                {l.quantity} шт.
              </p>
            </div>
            <span className="text-sm font-semibold tabular-nums">{formatRub(l.total)}</span>
          </li>
        ))}
      </ul>
      <div className="space-y-1.5 border-t border-border/60 pt-3 text-sm">
        <Row label="Товары" value={formatRub(subtotal)} />
        {discount > 0 && <Row label="Скидка по промокоду" value={`−${formatRub(discount)}`} valueClass="text-success" />}
        <div className="flex items-baseline justify-between pt-1">
          <span className="font-semibold">К оплате</span>
          <span className="font-display text-2xl font-bold">{formatRub(total)}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span className={cn("tabular-nums text-foreground", valueClass)}>{value}</span>
    </div>
  );
}

export function TestModeBadge({ className }: { className?: string }) {
  return <Badge variant="warning" className={className}>ТЕСТОВЫЙ РЕЖИМ</Badge>;
}
