"use client";
import * as React from "react";
import { Pencil, Plus, Power, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ActionDialog, useFieldError } from "./action-dialog";
import { FieldRow, NativeSelect } from "./fields";
import { deletePromoAction, savePromoAction, togglePromoAction } from "@/app/admin/promocodes/actions";

export interface PromoFormData {
  id?: string;
  code: string;
  type: "PERCENT" | "FIXED";
  /** percent, or rubles for FIXED */
  value: string;
  minOrder: string;
  maxDiscount: string;
  maxUses: string;
  perUserLimit: number;
  expiresAt: string;
  isActive: boolean;
}

export function PromoFormDialog({ promo }: { promo?: PromoFormData }) {
  const editing = !!promo;
  return (
    <ActionDialog
      wide
      trigger={editing ? "Изменить" : "Новый промокод"}
      triggerVariant={editing ? "outline" : "default"}
      triggerIcon={editing ? <Pencil /> : <Plus />}
      title={editing ? `Промокод ${promo.code}` : "Новый промокод"}
      description="Скидка применяется к сумме корзины. Заказ не может стать бесплатным."
      submitLabel={editing ? "Сохранить" : "Создать"}
      success={editing ? "Промокод сохранён" : "Промокод создан"}
      action={(v) => savePromoAction({ id: promo?.id, code: v.code, type: v.type, value: v.value, minOrder: v.minOrder ?? "", maxDiscount: v.maxDiscount ?? "", maxUses: v.maxUses ?? "", perUserLimit: v.perUserLimit, expiresAt: v.expiresAt ?? "", isActive: v.isActive === "on" })}
    >
      <PromoFields promo={promo} />
    </ActionDialog>
  );
}

function PromoFields({ promo }: { promo?: PromoFormData }) {
  const [type, setType] = React.useState<"PERCENT" | "FIXED">(promo?.type ?? "PERCENT");
  const codeErr = useFieldError("code");
  const valueErr = useFieldError("value");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FieldRow label="Код" error={codeErr}><Input name="code" defaultValue={promo?.code ?? ""} required className="uppercase" placeholder="SUMMER500" /></FieldRow>
      <FieldRow label="Тип скидки">
        <NativeSelect name="type" value={type} onChange={(e) => setType(e.target.value as "PERCENT" | "FIXED")}>
          <option value="PERCENT">Процент от суммы</option>
          <option value="FIXED">Фиксированная сумма</option>
        </NativeSelect>
      </FieldRow>
      <FieldRow label={type === "PERCENT" ? "Размер скидки, %" : "Размер скидки, ₽"} error={valueErr}><Input name="value" defaultValue={promo?.value ?? ""} required inputMode="decimal" placeholder={type === "PERCENT" ? "10" : "500"} /></FieldRow>
      <FieldRow label="Мин. сумма заказа, ₽" hint="Пусто — без ограничения"><Input name="minOrder" defaultValue={promo?.minOrder ?? ""} inputMode="decimal" /></FieldRow>
      {type === "PERCENT" && <FieldRow label="Макс. скидка, ₽" hint="Пусто — без потолка"><Input name="maxDiscount" defaultValue={promo?.maxDiscount ?? ""} inputMode="decimal" /></FieldRow>}
      <FieldRow label="Лимит использований" hint="Пусто — без лимита"><Input name="maxUses" defaultValue={promo?.maxUses ?? ""} inputMode="numeric" /></FieldRow>
      <FieldRow label="На пользователя"><Input name="perUserLimit" type="number" min={1} defaultValue={promo?.perUserLimit ?? 1} /></FieldRow>
      <FieldRow label="Действует до (включительно)" hint="Пусто — бессрочно"><Input name="expiresAt" type="date" defaultValue={promo?.expiresAt ?? ""} /></FieldRow>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="isActive" defaultChecked={promo?.isActive ?? true} className="size-4 accent-[var(--primary)]" /> Активен</label>
    </div>
  );
}

export function PromoRowActions({ id, code, isActive, deletable }: { id: string; code: string; isActive: boolean; deletable: boolean }) {
  return (
    <>
      <ActionDialog trigger={isActive ? "Отключить" : "Включить"} triggerIcon={<Power />} title={`${isActive ? "Отключить" : "Включить"} ${code}?`} submitLabel={isActive ? "Отключить" : "Включить"} success={isActive ? "Промокод отключён" : "Промокод включён"} action={() => togglePromoAction({ id, isActive: !isActive })} />
      {deletable && <ActionDialog trigger="Удалить" triggerIcon={<Trash2 />} title={`Удалить ${code}?`} description="Промокод ещё не использовался, поэтому его можно удалить." submitLabel="Удалить" submitVariant="destructive" success="Промокод удалён" action={() => deletePromoAction({ id })} />}
    </>
  );
}
