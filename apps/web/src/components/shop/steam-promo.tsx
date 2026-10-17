"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck, Timer, Wallet } from "lucide-react";
import { formatRub } from "@asap/shared/money";
import { STEAM_TOPUP_MAX_KOPECKS, STEAM_TOPUP_MIN_KOPECKS } from "@asap/shared/constants";
import { quoteSteamTopup } from "@asap/shared/steam";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/utils";
import { reachGoal } from "@/lib/metrika";

const PRESETS = [500, 1000, 2000, 5000];

/** Home page Steam top-up promo with a mini calculator (fee % comes from Setting `steam_topup_fee_percent`). */
export function SteamPromo({ feePercent }: { feePercent: number }) {
  const [amount, setAmount] = React.useState(1000);
  const minRub = STEAM_TOPUP_MIN_KOPECKS / 100;
  const maxRub = STEAM_TOPUP_MAX_KOPECKS / 100;
  const valid = Number.isInteger(amount) && amount >= minRub && amount <= maxRub;
  const quote = valid ? quoteSteamTopup(amount * 100, feePercent) : null;

  return (
    <Reveal className="glass gradient-border relative overflow-hidden rounded-3xl p-5 sm:p-8 lg:p-10">
      <div className="pointer-events-none absolute -top-20 -right-20 size-72 rounded-full bg-accent/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 size-72 rounded-full bg-primary/25 blur-3xl" />
      <div className="relative grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
            <Wallet className="size-3.5" /> Пополнение Steam
          </span>
          <h2 className="text-2xl leading-tight font-bold sm:text-3xl lg:text-4xl">
            Кошелёк Steam <span className="gradient-brand-text">за 1–5 минут</span>
          </h2>
          <p className="mt-3 max-w-lg text-muted-foreground">Введите логин Steam и сумму — деньги придут на кошелёк автоматически. Комиссия сервиса {feePercent}%, без скрытых платежей.</p>
          <ul className="mt-5 grid gap-2.5 text-sm sm:grid-cols-2">
            <li className="flex items-center gap-2.5">
              <Timer className="size-4 text-accent" /> Среднее время зачисления — минуты
            </li>
            <li className="flex items-center gap-2.5">
              <ShieldCheck className="size-4 text-accent" /> Пароль не нужен — только логин
            </li>
          </ul>
        </div>

        <div className="glass rounded-2xl p-4 sm:p-5">
          <p className="mb-3 text-sm font-semibold">Калькулятор</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(p)}
                aria-pressed={amount === p}
                className={cn("cursor-pointer rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors", amount === p ? "border-primary bg-primary/15 text-foreground" : "border-border hover:border-primary/50")}
              >
                {formatRub(p * 100)}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs text-muted-foreground">Сумма пополнения, ₽</span>
            <input
              inputMode="numeric"
              value={Number.isFinite(amount) && amount > 0 ? String(amount) : ""}
              onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "").slice(0, 6)))}
              aria-invalid={!valid}
              className="h-12 w-full rounded-xl border border-input bg-foreground/[0.04] px-4 text-lg font-semibold outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 aria-invalid:border-destructive"
            />
          </label>
          {!valid && (
            <p className="mt-1.5 text-xs text-destructive">
              От {formatRub(STEAM_TOPUP_MIN_KOPECKS)} до {formatRub(STEAM_TOPUP_MAX_KOPECKS)}
            </p>
          )}
          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Зачислим на кошелёк</dt>
              <dd className="font-semibold">{quote ? formatRub(quote.amount) : "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Комиссия {feePercent}%</dt>
              <dd className="font-semibold">{quote ? formatRub(quote.fee) : "—"}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-base">
              <dt className="font-semibold">К оплате</dt>
              <dd className="font-display font-bold">{quote ? formatRub(quote.total) : "—"}</dd>
            </div>
          </dl>
          <Button asChild className="mt-4 w-full" size="lg" disabled={!valid}>
            <Link href={`/steam?amount=${valid ? amount : 1000}`} onClick={() => reachGoal("steam_promo_click", { amount })} aria-disabled={!valid}>
              Пополнить Steam <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </Reveal>
  );
}
