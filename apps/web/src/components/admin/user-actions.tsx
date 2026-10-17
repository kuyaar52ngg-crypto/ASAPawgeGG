"use client";
import { Ban, Coins, ShieldCheck, ShieldOff, UserCog } from "lucide-react";
import { Input, Textarea } from "@/components/ui/input";
import { ActionDialog, useFieldError } from "./action-dialog";
import { FieldRow, NativeSelect } from "./fields";
import { ROLE_LABELS } from "./labels";
import { adjustUserBalance, setUserBan, setUserRole } from "@/app/admin/users/actions";

export interface UserRowInfo {
  id: string;
  email: string;
  role: string;
  banned: boolean;
  balanceLabel: string;
  isSelf: boolean;
}

export function UserActions({ user }: { user: UserRowInfo }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {!user.isSelf && (
        <ActionDialog trigger="Роль" triggerIcon={<UserCog />} title={`Роль: ${user.email}`} description="Продавцу автоматически создаётся профиль магазина (подтверждён)." success="Роль изменена" action={(v) => setUserRole({ userId: user.id, role: v.role })}>
          <FieldRow label="Новая роль">
            <NativeSelect name="role" defaultValue={user.role}>
              {Object.entries(ROLE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </NativeSelect>
          </FieldRow>
        </ActionDialog>
      )}
      <ActionDialog trigger="Баланс" triggerIcon={<Coins />} title={`Баланс: ${user.email}`} description={`Текущий баланс: ${user.balanceLabel}. Операция проводится в леджере и пишется в аудит-лог.`} success="Баланс скорректирован" action={(v) => adjustUserBalance({ userId: user.id, direction: v.direction, amount: v.amount, source: v.source, memo: v.memo })}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Операция">
            <NativeSelect name="direction" defaultValue="credit">
              <option value="credit">Начислить</option>
              <option value="debit">Списать</option>
            </NativeSelect>
          </FieldRow>
          <AmountField />
        </div>
        <FieldRow label="Источник / получатель средств" hint="Внешнее — деньги пришли/ушли вне площадки; счёт площадки — бонус или компенсация за счёт платформы.">
          <NativeSelect name="source" defaultValue="EXTERNAL">
            <option value="EXTERNAL">Внешнее поступление / списание</option>
            <option value="PLATFORM_FEE">Счёт площадки (бонус, компенсация)</option>
          </NativeSelect>
        </FieldRow>
        <FieldRow label="Комментарий">
          <Textarea name="memo" required minLength={3} maxLength={200} placeholder="Например: компенсация за задержку выдачи по заказу AG-…" />
        </FieldRow>
      </ActionDialog>
      {!user.isSelf && user.role !== "ADMIN" && (
        user.banned ? (
          <ActionDialog trigger="Разбанить" triggerIcon={<ShieldCheck />} title={`Разблокировать ${user.email}?`} submitLabel="Разблокировать" success="Пользователь разблокирован" action={() => setUserBan({ userId: user.id, banned: false })} />
        ) : (
          <ActionDialog trigger="Бан" triggerVariant="outline" triggerIcon={<Ban />} title={`Заблокировать ${user.email}?`} description="Пользователь потеряет доступ, его API-ключи будут отозваны." submitLabel="Заблокировать" submitVariant="destructive" success="Пользователь заблокирован" action={(v) => setUserBan({ userId: user.id, banned: true, reason: v.reason })}>
            <FieldRow label="Причина (видна только администраторам)">
              <Textarea name="reason" required maxLength={300} />
            </FieldRow>
          </ActionDialog>
        )
      )}
      {user.isSelf && <ShieldOff className="size-4 self-center text-muted-foreground" aria-label="Это вы" />}
    </div>
  );
}

function AmountField() {
  const error = useFieldError("amount");
  return (
    <FieldRow label="Сумма, ₽" error={error}>
      <Input name="amount" inputMode="decimal" required placeholder="500" pattern="\d{1,7}([.,]\d{1,2})?" aria-invalid={!!error} />
    </FieldRow>
  );
}
