"use client";
import * as React from "react";
import { CreditCard, FlaskConical, QrCode, Wallet } from "lucide-react";
import { formatRub, rubToKopecks } from "@asap/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { createBalanceTopup } from "@/server/payments/actions";

export interface TopupMethod {
  id: "PLATEGA_SBP" | "PLATEGA_CARD" | "ROLLYPAY" | "SANDBOX";
  label: string;
  description: string;
  available: boolean;
  reason?: string;
  sandbox?: boolean;
}

const PRESETS = [500, 1000, 2000, 5000, 10000];
const MIN = 100;
const MAX = 100_000;
const ICONS = { PLATEGA_SBP: QrCode, PLATEGA_CARD: CreditCard, ROLLYPAY: Wallet, SANDBOX: FlaskConical } as const;

/** Balance top-up: amount presets + custom amount + payment method, then redirects to the gateway (zone B `createBalanceTopup`). */
export function TopupForm({ methods }: { methods: TopupMethod[] }) {
  const firstAvailable = methods.find((m) => m.available)?.id ?? null;
  const [amount, setAmount] = React.useState("1000");
  const [method, setMethod] = React.useState<TopupMethod["id"] | null>(firstAvailable);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const kopecks = (() => {
    try {
      return rubToKopecks(amount.replace(/\s/g, ""));
    } catch {
      return NaN;
    }
  })();
  const valid = Number.isFinite(kopecks) && kopecks >= MIN * 100 && kopecks <= MAX * 100;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!valid) return setError(`Сумма пополнения — от ${MIN} до ${MAX.toLocaleString("ru-RU")} ₽`);
    if (!method) return setError("Выберите способ оплаты");
    startTransition(async () => {
      const res = await createBalanceTopup({ amount: kopecks, method });
      if (res.ok) {
        toast.success("Переходим к оплате…");
        window.location.href = res.data.redirectUrl;
      } else setError(res.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="space-y-3">
        <Field label="Сумма пополнения, ₽" htmlFor="topup-amount" hint={`От ${MIN} до ${MAX.toLocaleString("ru-RU")} ₽`}>
          <Input id="topup-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} className="max-w-xs text-lg font-semibold" />
        </Field>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setAmount(String(p))}
              className={cn(
                "cursor-pointer rounded-xl border px-4 py-2 text-sm font-semibold transition-colors",
                Number(amount) === p ? "border-primary bg-primary/15" : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              {formatRub(p * 100)}
            </button>
          ))}
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Способ оплаты</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {methods.map((m) => {
            const Icon = ICONS[m.id];
            return (
              <label
                key={m.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors",
                  method === m.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/40",
                  !m.available && "cursor-not-allowed opacity-50 hover:border-border",
                )}
              >
                <input type="radio" name="method" className="sr-only" checked={method === m.id} disabled={!m.available} onChange={() => setMethod(m.id)} />
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary [&_svg]:size-[18px]"><Icon /></span>
                <span className="min-w-0 text-sm">
                  <span className="flex items-center gap-2 font-semibold">{m.label}{m.sandbox && <Badge variant="warning">тестовый режим</Badge>}</span>
                  <span className="block text-xs text-muted-foreground">{m.available ? m.description : (m.reason ?? "Недоступно")}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" loading={pending} disabled={!valid || !method}>
        Пополнить на {valid ? formatRub(kopecks) : "…"}
      </Button>
    </form>
  );
}
