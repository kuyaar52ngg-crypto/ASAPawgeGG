"use client";
import { PackageCheck, RotateCcw, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/input";
import { ActionDialog, useFieldError } from "./action-dialog";
import { FieldRow } from "./fields";
import { useRunAction } from "./use-run-action";
import { cancelOrderAction, manualDeliverAction, refundOrderAction, retryFulfillmentAction } from "@/app/admin/orders/actions";

export function ManualDeliverButton({ orderItemId, title }: { orderItemId: string; title: string }) {
  return (
    <ActionDialog trigger="Выдать вручную" triggerIcon={<PackageCheck />} title={`Ручная выдача: ${title}`} description="Текст увидит покупатель на странице заказа (ключ, логин/пароль, инструкция). Позиция станет «Выдан»." submitLabel="Выдать" success="Позиция выдана" action={(v) => manualDeliverAction({ orderItemId, message: v.message })}>
      <MessageField />
    </ActionDialog>
  );
}
function MessageField() {
  const error = useFieldError("message");
  return (
    <FieldRow label="Данные для покупателя" error={error}>
      <Textarea name="message" required maxLength={4000} className="min-h-32" />
    </FieldRow>
  );
}

export function RetryFulfillmentButton({ orderId }: { orderId: string }) {
  const { run, pending } = useRunAction();
  return (
    <Button variant="outline" size="sm" loading={pending} onClick={() => run(() => retryFulfillmentAction({ orderId }), { success: "Выдача запущена повторно" })}>
      {!pending && <RotateCcw />} Повторить автовыдачу
    </Button>
  );
}

export function CancelOrderButton({ orderId, number }: { orderId: string; number: string }) {
  return (
    <ActionDialog trigger="Отменить заказ" triggerIcon={<XCircle />} title={`Отменить заказ ${number}?`} description="Заказ не оплачен: резерв ключей будет снят, открытые платежи отменены." submitLabel="Отменить заказ" submitVariant="destructive" success="Заказ отменён" action={() => cancelOrderAction({ orderId })} />
  );
}

export function RefundButton({ orderId, number, items, totalLabel }: { orderId: string; number: string; items: { id: string; title: string; totalLabel: string; refunded: boolean }[]; totalLabel: string }) {
  const refundable = items.filter((i) => !i.refunded);
  return (
    <ActionDialog
      trigger="Вернуть деньги"
      triggerVariant="destructive"
      triggerIcon={<Undo2 />}
      title={`Возврат по заказу ${number}`}
      description={`Деньги вернутся на баланс покупателя в личном кабинете. Заказ целиком: ${totalLabel}. Отметьте позиции (по умолчанию возвращаются все).`}
      submitLabel="Оформить возврат"
      submitVariant="destructive"
      success="Возврат оформлен"
      action={(v) => {
        const selected = refundable.filter((i) => v[`item_${i.id}`] === "on").map((i) => i.id);
        return refundOrderAction({ orderId, orderItemIds: selected.length === refundable.length || selected.length === 0 ? undefined : selected, reason: v.reason });
      }}
    >
      <div className="grid gap-2">
        {refundable.map((i) => (
          <label key={i.id} className="flex items-center gap-3 rounded-xl bg-foreground/[0.04] px-3 py-2 text-sm">
            <Checkbox name={`item_${i.id}`} defaultChecked value="on" />
            <span className="flex-1">{i.title}</span>
            <b className="tabular-nums">{i.totalLabel}</b>
          </label>
        ))}
      </div>
      <ReasonField />
    </ActionDialog>
  );
}
function ReasonField() {
  const error = useFieldError("reason");
  return (
    <FieldRow label="Причина (увидит покупатель и попадёт в аудит)" error={error}>
      <Textarea name="reason" required minLength={3} maxLength={300} />
    </FieldRow>
  );
}
