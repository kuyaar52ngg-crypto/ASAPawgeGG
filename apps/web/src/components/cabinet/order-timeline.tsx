import { Check, Circle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "./labels";

export interface TimelineInput {
  status: string;
  createdAt: Date;
  paidAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  updatedAt: Date;
  disputes: { createdAt: Date; status: string; resolvedAt: Date | null }[];
}

interface Step {
  label: string;
  at?: Date | null;
  state: "done" | "current" | "todo" | "bad";
  note?: string;
}

/** Order status timeline derived from the order's real timestamps and status. */
export function buildTimeline(o: TimelineInput): Step[] {
  const steps: Step[] = [{ label: "Заказ создан", at: o.createdAt, state: "done" }];
  if (o.status === "CANCELLED") {
    steps.push({ label: "Заказ отменён", at: o.cancelledAt ?? o.updatedAt, state: "bad", note: "Не оплачен вовремя или отменён вами" });
    return steps;
  }
  if (o.status === "PENDING") {
    steps.push({ label: "Ожидает оплаты", state: "current", note: "Заказ резервируется на 30 минут" }, { label: "Выдача товара", state: "todo" });
    return steps;
  }
  steps.push({ label: "Оплачен", at: o.paidAt, state: "done" });
  const delivered = !!o.deliveredAt || ["DELIVERED", "DISPUTED"].includes(o.status);
  if (o.status === "FAILED") steps.push({ label: "Ошибка выдачи", at: o.updatedAt, state: "bad", note: "Мы уже разбираемся — поддержка свяжется с вами или вернёт деньги" });
  else if (delivered) steps.push({ label: "Товар выдан", at: o.deliveredAt, state: "done" });
  else if (o.status === "REFUNDED" && !o.deliveredAt) {
    /* refunded before delivery — no delivery step */
  } else steps.push({ label: o.status === "PROCESSING" ? "Идёт выдача" : "Подготовка к выдаче", state: "current" });

  for (const d of [...o.disputes].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    steps.push({ label: "Открыт спор", at: d.createdAt, state: d.resolvedAt ? "done" : "current" });
    if (d.resolvedAt) steps.push({ label: d.status === "RESOLVED_REFUND" ? "Спор решён: возврат" : d.status === "RESOLVED_REJECTED" ? "Спор решён: отклонён" : "Спор закрыт", at: d.resolvedAt, state: "done" });
  }
  if (o.status === "REFUNDED") steps.push({ label: "Средства возвращены на баланс", at: o.updatedAt, state: "done" });
  return steps;
}

export function OrderTimeline({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => (
        <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
          {i < steps.length - 1 && <span className="absolute top-7 bottom-0 left-[13px] w-px bg-border" aria-hidden />}
          <span
            className={cn(
              "z-10 flex size-7 shrink-0 items-center justify-center rounded-full border",
              s.state === "done" && "border-success/40 bg-success/15 text-success",
              s.state === "current" && "border-primary/50 bg-primary/15 text-primary",
              s.state === "todo" && "border-border text-muted-foreground",
              s.state === "bad" && "border-destructive/40 bg-destructive/15 text-destructive",
            )}
          >
            {s.state === "done" ? <Check className="size-4" /> : s.state === "bad" ? <X className="size-4" /> : <Circle className={cn("size-2.5", s.state === "current" && "animate-pulse fill-current")} />}
          </span>
          <div className="min-w-0 pt-0.5">
            <p className={cn("text-sm font-medium", s.state === "todo" && "text-muted-foreground")}>{s.label}</p>
            {s.at && <p className="text-xs text-muted-foreground">{formatDateTime(s.at)}</p>}
            {s.note && <p className="mt-0.5 text-xs text-muted-foreground">{s.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
