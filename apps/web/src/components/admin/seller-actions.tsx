"use client";
import { BadgeCheck, Ban, Percent, RotateCcw, XCircle } from "lucide-react";
import { Input, Textarea } from "@/components/ui/input";
import { ActionDialog, useFieldError } from "./action-dialog";
import { FieldRow } from "./fields";
import { reviewSellerAction, setSellerCommissionAction } from "@/app/admin/sellers/actions";

export function SellerActions({ sellerId, shopName, status, commissionPercent, defaultPercent }: { sellerId: string; shopName: string; status: string; commissionPercent: string; defaultPercent: string }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {(status === "PENDING" || status === "REJECTED") && (
        <ActionDialog trigger="Одобрить" triggerVariant="secondary" triggerIcon={<BadgeCheck />} title={`Одобрить «${shopName}»?`} description="Продавец сможет публиковать товары, пользователь получит роль «Продавец»." submitLabel="Одобрить" success="Продавец подтверждён" action={() => reviewSellerAction({ sellerId, decision: "approve" })} />
      )}
      {status === "PENDING" && (
        <ActionDialog trigger="Отклонить" triggerIcon={<XCircle />} title={`Отклонить заявку «${shopName}»`} submitLabel="Отклонить" submitVariant="destructive" success="Заявка отклонена" action={(v) => reviewSellerAction({ sellerId, decision: "reject", reason: v.reason })}>
          <ReasonField />
        </ActionDialog>
      )}
      {status === "VERIFIED" && (
        <ActionDialog trigger="Приостановить" triggerIcon={<Ban />} title={`Приостановить «${shopName}»`} submitLabel="Приостановить" submitVariant="destructive" success="Продавец приостановлен" action={(v) => reviewSellerAction({ sellerId, decision: "suspend", reason: v.reason })}>
          <ReasonField />
        </ActionDialog>
      )}
      {status === "SUSPENDED" && (
        <ActionDialog trigger="Вернуть" triggerIcon={<RotateCcw />} title={`Снять приостановку с «${shopName}»?`} submitLabel="Вернуть" success="Продавец восстановлен" action={() => reviewSellerAction({ sellerId, decision: "restore" })} />
      )}
      <ActionDialog trigger="Комиссия" triggerIcon={<Percent />} title={`Комиссия «${shopName}»`} description={`Индивидуальная комиссия площадки для этого продавца. Пусто — действует общая (${defaultPercent}%). Применяется к новым заказам.`} success="Комиссия сохранена" action={(v) => setSellerCommissionAction({ sellerId, percent: v.percent ?? "" })}>
        <PercentField initial={commissionPercent} />
      </ActionDialog>
    </div>
  );
}

function ReasonField() {
  const error = useFieldError("reason");
  return (
    <FieldRow label="Причина (увидит продавец)" error={error}>
      <Textarea name="reason" required maxLength={500} />
    </FieldRow>
  );
}

function PercentField({ initial }: { initial: string }) {
  const error = useFieldError("percent");
  return (
    <FieldRow label="Комиссия, %" error={error} hint="От 0 до 50, например 8 или 7,5">
      <Input name="percent" inputMode="decimal" defaultValue={initial} placeholder="по умолчанию" aria-invalid={!!error} />
    </FieldRow>
  );
}
