"use client";
import * as React from "react";
import Link from "next/link";
import { CreditCard, FlaskConical, Landmark, QrCode, Wallet } from "lucide-react";
import { formatRub } from "@asap/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface MethodView {
  id: string;
  label: string;
  description: string;
  available: boolean;
  reason?: string;
  sandbox?: boolean;
}

const ICONS: Record<string, React.ReactNode> = {
  BALANCE: <Wallet />,
  PLATEGA_SBP: <QrCode />,
  PLATEGA_CARD: <CreditCard />,
  ROLLYPAY: <Landmark />,
  SANDBOX: <FlaskConical />,
};

/** Radio list of payment methods (submits `paymentMethod`). Balance shows the current amount and disables itself when too low. */
export function PaymentMethodPicker({
  methods,
  value,
  onChange,
  balance,
  total,
  name = "paymentMethod",
}: {
  methods: MethodView[];
  value: string;
  onChange: (id: string) => void;
  balance?: number;
  total: number;
  name?: string;
}) {
  return (
    <fieldset className="space-y-2.5">
      <legend className="sr-only">Способ оплаты</legend>
      {methods.map((m) => {
        const lowBalance = m.id === "BALANCE" && balance != null && balance < total;
        const disabled = !m.available || lowBalance;
        const selected = value === m.id && !disabled;
        return (
          <label
            key={m.id}
            className={cn(
              "flex cursor-pointer items-center gap-3.5 rounded-2xl border p-3.5 transition-all",
              selected ? "border-primary bg-primary/10 shadow-[0_0_0_1px_var(--primary)]" : "border-border bg-foreground/[0.03] hover:border-primary/40",
              disabled && "cursor-not-allowed opacity-55 hover:border-border",
            )}
          >
            <input type="radio" name={name} value={m.id} checked={selected} disabled={disabled} onChange={() => onChange(m.id)} className="sr-only" />
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5", selected ? "gradient-brand text-white" : "bg-secondary text-muted-foreground")}>{ICONS[m.id]}</span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {m.label}
                {m.sandbox && <Badge variant="warning">тестовый режим</Badge>}
              </span>
              <span className="block text-xs text-muted-foreground">
                {!m.available
                  ? m.reason
                  : m.id === "BALANCE" && balance != null
                    ? lowBalance
                      ? `На балансе ${formatRub(balance)} — не хватает ${formatRub(total - balance)}`
                      : `На балансе ${formatRub(balance)}`
                    : m.description}
              </span>
            </span>
            {lowBalance && m.available && (
              <Link href="/account/balance" className="shrink-0 text-xs font-semibold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                Пополнить
              </Link>
            )}
            <span className={cn("size-5 shrink-0 rounded-full border-2 transition-colors", selected ? "border-primary bg-primary shadow-[inset_0_0_0_3px_var(--card)]" : "border-input")} aria-hidden />
          </label>
        );
      })}
    </fieldset>
  );
}

/** First sensible default: balance when it covers the total, else the first available gateway. */
export function defaultMethod(methods: MethodView[], balance: number | undefined, total: number): string {
  const ok = (m: MethodView) => m.available && !(m.id === "BALANCE" && balance != null && balance < total);
  return (methods.find((m) => m.id === "BALANCE" && ok(m)) ?? methods.find((m) => m.id !== "SANDBOX" && ok(m)) ?? methods.find(ok))?.id ?? "";
}
