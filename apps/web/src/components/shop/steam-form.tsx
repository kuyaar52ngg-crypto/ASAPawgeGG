"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FlaskConical, Info } from "lucide-react";
import { formatRub } from "@asap/shared/money";
import { STEAM_TOPUP_MAX_KOPECKS, STEAM_TOPUP_MIN_KOPECKS } from "@asap/shared/constants";
import { quoteSteamTopup } from "@asap/shared/steam";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { reachGoal } from "@/lib/metrika";
import { startSteamTopupAction } from "@/server/catalog/actions";
import { SteamLoginField, type SteamLoginStatus } from "./steam-login-field";

export interface SteamFormTarget {
  currency: "RUB" | "KZT";
  customAllowed: boolean;
  presets: { variantId: string; title: string; amount: number; price: number }[];
}

type Currency = "RUB" | "KZT";

const nf = new Intl.NumberFormat("ru-RU");

/** Steam top-up calculator + order starter. Fee % comes from Setting `steam_topup_fee_percent` (server), math from @asap/shared. */
export function SteamForm({ feePercent, rub, kzt, initialAmount, sandbox }: { feePercent: number; rub: SteamFormTarget | null; kzt: SteamFormTarget | null; initialAmount?: number; sandbox: boolean }) {
  const router = useRouter();
  const [currency, setCurrency] = React.useState<Currency>(rub ? "RUB" : "KZT");
  const target = currency === "RUB" ? rub : kzt;
  const [login, setLogin] = React.useState("");
  const [status, setStatus] = React.useState<SteamLoginStatus>("idle");
  const [amount, setAmount] = React.useState<number>(initialAmount ?? 1000);
  const [pending, startTransition] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // keep the amount valid for the newly selected currency
  function changeCurrency(next: Currency) {
    const t = next === "RUB" ? rub : kzt;
    setCurrency(next);
    if (!t) return;
    if (next === "KZT" && !t.presets.some((p) => p.amount === amount)) setAmount(t.presets[0]?.amount ?? 0);
    if (next === "RUB" && amount > STEAM_TOPUP_MAX_KOPECKS / 100) setAmount(STEAM_TOPUP_MAX_KOPECKS / 100);
  }

  const preset = target?.presets.find((p) => p.amount === amount);
  const minRub = STEAM_TOPUP_MIN_KOPECKS / 100;
  const maxRub = STEAM_TOPUP_MAX_KOPECKS / 100;
  const customValid = currency === "RUB" && Number.isInteger(amount) && amount >= minRub && amount <= maxRub;

  let total: number | null = null;
  let fee: number | null = null;
  if (preset) {
    total = preset.price;
    fee = currency === "RUB" ? preset.price - preset.amount * 100 : null;
  } else if (customValid) {
    const q = quoteSteamTopup(amount * 100, feePercent);
    total = q.total;
    fee = q.fee;
  }
  const amountError = !preset && !customValid ? (currency === "RUB" ? `Сумма от ${nf.format(minRub)} до ${nf.format(maxRub)} ₽` : "Выберите сумму") : undefined;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!login.trim()) next.login = "Укажите логин Steam";
    else if (status === "invalid") next.login = "Проверьте логин Steam";
    if (amountError) next.amount = amountError;
    setErrors(next);
    if (Object.keys(next).length) return;

    startTransition(async () => {
      const res = await startSteamTopupAction({ currency, login: login.trim(), amount });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      reachGoal("steam_topup_start", { currency, amount, value: res.data.total / 100 });
      toast.success("Пополнение добавлено в заказ");
      router.push("/checkout");
    });
  }

  if (!rub && !kzt) {
    return <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">Пополнение Steam временно недоступно. Загляните позже или выберите подарочную карту в каталоге.</div>;
  }

  return (
    <form onSubmit={submit} noValidate className="glass gradient-border min-w-0 space-y-6 rounded-3xl p-5 sm:p-8">
      {sandbox && (
        <p className="flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-xs text-warning">
          <FlaskConical className="mt-0.5 size-4 shrink-0" /> Тестовый режим поставщика: логин проверяется эмулятором, реального зачисления на Steam не происходит.
        </p>
      )}

      {rub && kzt && (
        <div>
          <p className="mb-2 text-sm font-semibold">Валюта кошелька Steam</p>
          <Tabs value={currency} onValueChange={(v) => changeCurrency(v as Currency)}>
            <TabsList aria-label="Валюта кошелька">
              <TabsTrigger value="RUB">₽ Рубли (Россия)</TabsTrigger>
              <TabsTrigger value="KZT">₸ Тенге (Казахстан)</TabsTrigger>
              <TabsTrigger value="USD" disabled title="Для USD-кошельков используйте подарочные карты">
                $ USD
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Валюта определяется регионом вашего аккаунта Steam. Для аккаунтов с USD-кошельком выберите{" "}
              <Link href="/catalog/podarochnye-karty" className="text-primary hover:underline">
                подарочную карту Steam
              </Link>
              .
            </span>
          </p>
        </div>
      )}

      <SteamLoginField value={login} onChange={(v) => (setLogin(v), setErrors((e) => ({ ...e, login: "" })))} onStatus={setStatus} error={errors.login} />

      <div>
        <p className="mb-2 text-sm font-semibold">Сумма пополнения{currency === "KZT" ? ", ₸" : ", ₽"}</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Готовые суммы">
          {target?.presets.map((p) => (
            <button
              key={p.variantId}
              type="button"
              role="radio"
              aria-checked={amount === p.amount}
              onClick={() => (setAmount(p.amount), setErrors((e) => ({ ...e, amount: "" })))}
              className={cn("cursor-pointer rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all", amount === p.amount ? "border-primary bg-primary/15 shadow-[0_6px_20px_-8px_var(--glow-violet)]" : "border-border hover:border-primary/50 hover:bg-foreground/5")}
            >
              {p.title}
            </button>
          ))}
        </div>
        {target?.customAllowed && (
          <div className="mt-3">
            <label htmlFor="steam-amount" className="mb-1.5 block text-xs text-muted-foreground">
              Или введите свою сумму ({nf.format(minRub)} – {nf.format(maxRub)} ₽)
            </label>
            <div className="relative max-w-xs">
              <input
                id="steam-amount"
                inputMode="numeric"
                value={Number.isFinite(amount) && amount > 0 ? String(amount) : ""}
                onChange={(e) => (setAmount(Number(e.target.value.replace(/\D/g, "").slice(0, 6))), setErrors((er) => ({ ...er, amount: "" })))}
                aria-invalid={Boolean(errors.amount || (amount > 0 && amountError))}
                className="h-12 w-full rounded-xl border border-input bg-foreground/[0.04] pr-10 pl-4 text-lg font-semibold outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 aria-invalid:border-destructive"
              />
              <span className="absolute top-1/2 right-4 -translate-y-1/2 text-muted-foreground">₽</span>
            </div>
          </div>
        )}
        {(errors.amount || (amount > 0 && amountError)) && (
          <p role="alert" className="mt-1.5 text-xs text-destructive">
            {errors.amount || amountError}
          </p>
        )}
      </div>

      <div className="rounded-2xl bg-foreground/5 p-4 sm:p-5">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Зачислим на кошелёк</dt>
            <dd className="font-semibold">{preset || customValid ? (currency === "RUB" ? formatRub(amount * 100) : `${nf.format(amount)} ₸`) : "—"}</dd>
          </div>
          {currency === "RUB" && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Комиссия сервиса ({feePercent}%)</dt>
              <dd className="font-semibold">{fee !== null ? formatRub(fee) : "—"}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3">
            <dt className="font-semibold">К оплате</dt>
            <dd className="font-display text-2xl font-bold sm:text-3xl" aria-live="polite">
              {total !== null ? formatRub(total) : "—"}
            </dd>
          </div>
        </dl>
      </div>

      <Button type="submit" size="lg" className="w-full" loading={pending} disabled={status === "checking"}>
        Перейти к оплате <ArrowRight />
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Нажимая кнопку, вы соглашаетесь с{" "}
        <Link href="/info/offer" className="underline underline-offset-2 hover:text-foreground">
          офертой
        </Link>
        . Логин нельзя изменить после оплаты — проверьте его внимательно.
      </p>
    </form>
  );
}
