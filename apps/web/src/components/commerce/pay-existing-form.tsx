"use client";
import * as React from "react";
import { useActionState } from "react";
import { formatRub } from "@asap/shared";
import { Button } from "@/components/ui/button";
import { PaymentMethodPicker, defaultMethod, type MethodView } from "./payment-method-picker";
import { payExistingOrder, type CheckoutState } from "@/app/(shop)/checkout/actions";

const initial: CheckoutState = {};

/** Choose a (different) payment method for an already created PENDING order. */
export function PayExistingForm({ orderId, total, balance, methods }: { orderId: string; total: number; balance: number; methods: MethodView[] }) {
  const [state, action, pending] = useActionState(payExistingOrder, initial);
  const [method, setMethod] = React.useState(() => defaultMethod(methods, balance, total));
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="orderId" value={orderId} />
      <PaymentMethodPicker methods={methods} value={method} onChange={setMethod} balance={balance} total={total} />
      {state.error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}
      <Button type="submit" size="lg" className="w-full" loading={pending} disabled={!method || pending}>
        Оплатить {formatRub(total)}
      </Button>
    </form>
  );
}
