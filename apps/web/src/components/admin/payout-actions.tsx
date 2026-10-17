"use client";
import { Check, Send, X } from "lucide-react";
import { Input, Textarea } from "@/components/ui/input";
import { ActionDialog, useFieldError } from "./action-dialog";
import { FieldRow } from "./fields";
import { approvePayoutAction, markPayoutPaidAction, rejectPayoutAction } from "@/app/admin/payouts/actions";

export function PayoutActions({ payoutId, status, amountLabel, shop }: { payoutId: string; status: string; amountLabel: string; shop: string }) {
  if (status !== "REQUESTED" && status !== "APPROVED") return null;
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {status === "REQUESTED" && (
        <ActionDialog trigger="Одобрить" triggerVariant="secondary" triggerIcon={<Check />} title={`Одобрить выплату ${amountLabel}?`} description={`Продавец: ${shop}. После одобрения переведите деньги по реквизитам и отметьте выплату как выплаченную.`} submitLabel="Одобрить" success="Выплата одобрена" action={() => approvePayoutAction({ payoutId })} />
      )}
      <ActionDialog trigger="Выплачено" triggerVariant="outline" triggerIcon={<Send />} title={`Отметить выплаченной: ${amountLabel}`} description="Подтвердите, что перевод по реквизитам выполнен. Продавец получит уведомление." submitLabel="Подтвердить" success="Выплата отмечена как выплаченная" action={(v) => markPayoutPaidAction({ payoutId, note: v.note })}>
        <FieldRow label="Комментарий / номер транзакции (необязательно)">
          <Input name="note" maxLength={500} placeholder="Например: СБП, операция №…" />
        </FieldRow>
      </ActionDialog>
      <ActionDialog trigger="Отклонить" triggerVariant="outline" triggerIcon={<X />} title={`Отклонить выплату ${amountLabel}`} description="Сумма вернётся на доступный баланс продавца." submitLabel="Отклонить" submitVariant="destructive" success="Выплата отклонена" action={(v) => rejectPayoutAction({ payoutId, note: v.note })}>
        <RejectReason />
      </ActionDialog>
    </div>
  );
}

function RejectReason() {
  const error = useFieldError("note");
  return (
    <FieldRow label="Причина (увидит продавец)" error={error}>
      <Textarea name="note" required minLength={3} maxLength={500} />
    </FieldRow>
  );
}
