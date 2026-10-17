"use client";
import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { BadgePercent, Check, Lock, X } from "lucide-react";
import { formatRub } from "@asap/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { OrderSummary, type SummaryLine } from "./order-summary";
import { PaymentMethodPicker, defaultMethod, type MethodView } from "./payment-method-picker";
import { placeOrder, previewPromo, type CheckoutState, type PromoPreview } from "@/app/(shop)/checkout/actions";

const initial: CheckoutState = {};

export function CheckoutForm({ lines, subtotal, email, balance, methods }: { lines: SummaryLine[]; subtotal: number; email: string; balance: number; methods: MethodView[] }) {
  const [state, action, pending] = useActionState(placeOrder, initial);
  const [chosen, setMethod] = React.useState(() => defaultMethod(methods, balance, subtotal));
  const [code, setCode] = React.useState("");
  const [promo, setPromo] = React.useState<PromoPreview | null>(null);
  const [checking, startCheck] = React.useTransition();

  const discount = promo?.ok ? (promo.discount ?? 0) : 0;
  const total = subtotal - discount;

  // the discounted total may change which methods are affordable -> fall back to a usable default
  const chosenMethod = methods.find((x) => x.id === chosen);
  const method = chosenMethod?.available && !(chosenMethod.id === "BALANCE" && balance < total) ? chosen : defaultMethod(methods, balance, total);

  function applyPromo() {
    if (!code.trim()) return;
    startCheck(async () => setPromo(await previewPromo(code)));
  }
  function clearPromo() {
    setPromo(null);
    setCode("");
  }

  const canSubmit = Boolean(method) && !pending;

  return (
    <form action={action} className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">1. Контакты</CardTitle></CardHeader>
          <CardContent>
            <Field label="Email для чека и уведомлений" htmlFor="email" error={state.fieldErrors?.email?.[0]} hint="Ключи также будут доступны в личном кабинете">
              <Input id="email" name="email" type="email" required defaultValue={email} autoComplete="email" />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">2. Промокод</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <BadgePercent className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  name="promoCode"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase());
                    if (promo) setPromo(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyPromo())}
                  placeholder="Есть промокод?"
                  className="pl-9 uppercase"
                  maxLength={40}
                  autoComplete="off"
                />
              </div>
              {promo?.ok ? (
                <Button type="button" variant="outline" onClick={clearPromo}><X /> Убрать</Button>
              ) : (
                <Button type="button" variant="secondary" onClick={applyPromo} loading={checking} disabled={!code.trim()}>Применить</Button>
              )}
            </div>
            {promo?.ok && <p className="flex items-center gap-1.5 text-sm text-success"><Check className="size-4" /> {promo.code}: скидка {formatRub(promo.discount ?? 0)}</p>}
            {promo && !promo.ok && <p role="alert" className="text-sm text-destructive">{promo.error}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">3. Способ оплаты</CardTitle></CardHeader>
          <CardContent>
            <PaymentMethodPicker methods={methods} value={method} onChange={setMethod} balance={balance} total={total} />
            {state.fieldErrors?.paymentMethod?.[0] && <p className="mt-2 text-xs text-destructive">{state.fieldErrors.paymentMethod[0]}</p>}
          </CardContent>
        </Card>
      </div>

      <aside className="lg:sticky lg:top-24">
        <Card className="gradient-border">
          <CardContent className="space-y-4 p-5 pt-5 sm:p-6 sm:pt-6">
            <h2 className="font-display text-lg font-semibold">Ваш заказ</h2>
            <OrderSummary lines={lines} subtotal={subtotal} discount={discount} total={total} />
            {state.error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}
            <Button type="submit" size="lg" className="w-full" loading={pending} disabled={!canSubmit}>
              {pending ? "Оформляем…" : method === "BALANCE" ? `Оплатить ${formatRub(total)}` : `Перейти к оплате · ${formatRub(total)}`}
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <Lock className="size-3.5" /> Нажимая кнопку, вы принимаете <Link href="/info/offer" className="underline hover:text-foreground">оферту</Link>
            </p>
          </CardContent>
        </Card>
      </aside>
    </form>
  );
}
