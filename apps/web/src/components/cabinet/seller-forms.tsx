"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Banknote, MessageSquareReply, PackageCheck, Trash2, X } from "lucide-react";
import { MIN_PAYOUT_KOPECKS, formatRub, rubToKopecks } from "@asap/shared";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { archiveProductAction, cancelPayoutAction, deleteProductAction, deliverManualAction, replyReviewAction, requestPayoutAction, restoreProductAction, updateShopAction } from "@/app/seller/actions";
import { SelectField } from "./select-field";

// ───────────── manual delivery ─────────────

export function DeliverForm({ orderItemId }: { orderItemId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await deliverManualAction({ orderItemId, message });
      if (res.ok) {
        toast.success("Заказ выдан, покупатель уведомлён");
        router.refresh();
      } else setError(res.fieldErrors?.message?.[0] ?? res.error);
    });
  }
  if (!open) return <Button type="button" size="sm" onClick={() => setOpen(true)}><PackageCheck /> Выдать заказ</Button>;
  return (
    <form onSubmit={submit} className="mt-3 w-full space-y-3 rounded-xl border border-border bg-foreground/[0.03] p-3.5">
      <Field label="Данные для покупателя" htmlFor={`deliver-${orderItemId}`} hint="Код, логин и пароль, ссылка, инструкция — покупатель увидит это в заказе">
        <Textarea id={`deliver-${orderItemId}`} value={message} onChange={(e) => setMessage(e.target.value)} className="min-h-28 font-mono text-xs" maxLength={4000} required autoFocus />
      </Field>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>Подтвердить выдачу</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Отмена</Button>
      </div>
    </form>
  );
}

// ───────────── review reply ─────────────

export function ReplyForm({ reviewId, initialReply }: { reviewId: string; initialReply?: string | null }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reply, setReply] = React.useState(initialReply ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await replyReviewAction({ reviewId, reply });
      if (res.ok) {
        toast.success("Ответ опубликован");
        setOpen(false);
        router.refresh();
      } else setError(res.fieldErrors?.reply?.[0] ?? res.error);
    });
  }
  if (!open) return <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}><MessageSquareReply /> {initialReply ? "Изменить ответ" : "Ответить"}</Button>;
  return (
    <form onSubmit={submit} className="space-y-2">
      <Textarea value={reply} onChange={(e) => setReply(e.target.value)} maxLength={1000} required className="min-h-20" aria-label="Ответ на отзыв" placeholder="Спасибо за отзыв! …" />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>Опубликовать</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Отмена</Button>
      </div>
    </form>
  );
}

// ───────────── payouts ─────────────

type Method = "CARD" | "SBP" | "USDT" | "YOOMONEY";
const METHODS: { value: Method; label: string }[] = [
  { value: "CARD", label: "Банковская карта" },
  { value: "SBP", label: "СБП (по номеру телефона)" },
  { value: "USDT", label: "USDT" },
  { value: "YOOMONEY", label: "ЮMoney" },
];

export function PayoutForm({ available, canRequest, saved }: { available: number; canRequest: boolean; saved: { method?: string; details?: Record<string, string> } | null }) {
  const router = useRouter();
  const initialMethod = (METHODS.find((m) => m.value === saved?.method)?.value ?? "CARD") as Method;
  const [method, setMethod] = React.useState<Method>(initialMethod);
  const [amount, setAmount] = React.useState("");
  const [details, setDetails] = React.useState<Record<string, string>>(saved?.method === initialMethod ? (saved?.details ?? {}) : {});
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[] | undefined>>({});
  const [pending, startTransition] = React.useTransition();
  const set = (k: string, v: string) => setDetails((d) => ({ ...d, [k]: v }));
  const amountK = (() => {
    try {
      return amount.trim() ? rubToKopecks(amount) : NaN;
    } catch {
      return NaN;
    }
  })();

  function changeMethod(m: string) {
    setMethod(m as Method);
    setDetails(saved?.method === m ? (saved.details ?? {}) : {});
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    if (!Number.isFinite(amountK)) return setError("Укажите сумму числом");
    startTransition(async () => {
      const res = await requestPayoutAction({ amount: amountK, method, details });
      if (res.ok) {
        toast.success("Заявка на выплату создана");
        setAmount("");
        router.refresh();
      } else {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Сумма, ₽" htmlFor="payout-amount" hint={`Доступно к выводу: ${formatRub(available)} · минимум ${formatRub(MIN_PAYOUT_KOPECKS)}`} error={fieldErrors.amount?.[0]}>
        <div className="flex gap-2">
          <Input id="payout-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" required />
          <Button type="button" variant="outline" onClick={() => setAmount(String(available / 100).replace(".", ","))} disabled={available <= 0}>Всё</Button>
        </div>
      </Field>
      <Field label="Способ вывода">
        <SelectField label="Способ вывода" value={method} onChange={changeMethod} options={METHODS} />
      </Field>
      {method === "CARD" && (
        <Field label="Номер карты" htmlFor="payout-card" error={fieldErrors.card?.[0]}><Input id="payout-card" inputMode="numeric" autoComplete="off" value={details.card ?? ""} onChange={(e) => set("card", e.target.value)} placeholder="2200 0000 0000 0000" required /></Field>
      )}
      {method === "SBP" && (
        <>
          <Field label="Телефон" htmlFor="payout-phone" error={fieldErrors.phone?.[0]}><Input id="payout-phone" inputMode="tel" value={details.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="+7 999 123-45-67" required /></Field>
          <Field label="Банк получателя" htmlFor="payout-bank" error={fieldErrors.bank?.[0]}><Input id="payout-bank" value={details.bank ?? ""} onChange={(e) => set("bank", e.target.value)} placeholder="Например, Тинькофф" required /></Field>
        </>
      )}
      {method === "USDT" && (
        <>
          <Field label="Сеть" error={fieldErrors.network?.[0]}><SelectField label="Сеть" value={details.network ?? ""} onChange={(v) => set("network", v)} placeholder="Выберите сеть" options={[{ value: "TRC20", label: "TRC20 (Tron)" }, { value: "ERC20", label: "ERC20 (Ethereum)" }, { value: "BEP20", label: "BEP20 (BNB Chain)" }]} /></Field>
          <Field label="Адрес кошелька" htmlFor="payout-addr" error={fieldErrors.address?.[0]}><Input id="payout-addr" value={details.address ?? ""} onChange={(e) => set("address", e.target.value)} autoComplete="off" required /></Field>
        </>
      )}
      {method === "YOOMONEY" && (
        <Field label="Номер кошелька" htmlFor="payout-ym" error={fieldErrors.wallet?.[0]}><Input id="payout-ym" inputMode="numeric" value={details.wallet ?? ""} onChange={(e) => set("wallet", e.target.value)} placeholder="4100…" required /></Field>
      )}
      {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Button type="submit" loading={pending} disabled={!canRequest || available < MIN_PAYOUT_KOPECKS}><Banknote /> Запросить выплату</Button>
      {!canRequest && <p className="text-xs text-warning">Выплаты доступны после подтверждения профиля продавца.</p>}
      {canRequest && available < MIN_PAYOUT_KOPECKS && <p className="text-xs text-muted-foreground">Накопите минимум {formatRub(MIN_PAYOUT_KOPECKS)} на доступном балансе.</p>}
    </form>
  );
}

export function CancelPayoutButton({ payoutId }: { payoutId: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      loading={pending}
      onClick={() => {
        if (!window.confirm("Отменить заявку? Деньги вернутся на доступный баланс.")) return;
        startTransition(async () => {
          const res = await cancelPayoutAction(payoutId);
          if (res.ok) {
            toast.success("Заявка отменена");
            router.refresh();
          } else toast.error(res.error);
        });
      }}
    >
      <X /> Отменить
    </Button>
  );
}

// ───────────── shop settings ─────────────

export function ShopForm({ shopName, description, avatar }: { shopName: string; description: string; avatar: string }) {
  const router = useRouter();
  const [values, setValues] = React.useState({ shopName, description, avatar });
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[] | undefined>>({});
  const [pending, startTransition] = React.useTransition();
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await updateShopAction(values);
      if (res.ok) {
        toast.success("Настройки магазина сохранены");
        router.refresh();
      } else {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
      }
    });
  }
  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <Field label="Название магазина" htmlFor="shop-name" error={fieldErrors.shopName?.[0]}><Input id="shop-name" value={values.shopName} onChange={(e) => setValues({ ...values, shopName: e.target.value })} required minLength={3} maxLength={60} /></Field>
      <Field label="Описание" htmlFor="shop-desc" hint="Показывается на странице вашего магазина" error={fieldErrors.description?.[0]}><Textarea id="shop-desc" value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} maxLength={1500} className="min-h-32" /></Field>
      <Field label="Аватар (ссылка)" htmlFor="shop-avatar" hint="https-ссылка на изображение (picsum.photos, placehold.co, images.unsplash.com)" error={fieldErrors.avatar?.[0]}>
        <div className="flex items-center gap-3">
          {values.avatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={values.avatar} alt="" className="size-11 rounded-full border border-border object-cover" onError={(e) => ((e.currentTarget as HTMLImageElement).style.opacity = "0.25")} />
          )}
          <Input id="shop-avatar" value={values.avatar} onChange={(e) => setValues({ ...values, avatar: e.target.value })} placeholder="https://…" />
        </div>
      </Field>
      {error && !Object.keys(fieldErrors).length && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" loading={pending}>Сохранить</Button>
    </form>
  );
}

// ───────────── product row actions ─────────────

export function ProductRowActions({ productId, status, canDelete }: { productId: string; status: string; canDelete: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  function run(fn: (id: string) => Promise<{ ok: boolean } & ({ error: string } | { data: unknown })>, confirmText: string | null, success: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    startTransition(async () => {
      const res = await fn(productId);
      if (res.ok) {
        toast.success(success);
        router.refresh();
      } else toast.error("error" in res ? res.error : "Ошибка");
    });
  }
  return (
    <span className="inline-flex gap-1">
      {status === "ARCHIVED" ? (
        <Button type="button" size="icon-sm" variant="ghost" disabled={pending} onClick={() => run(restoreProductAction, null, "Товар восстановлен как черновик")} aria-label="Восстановить" title="Восстановить из архива"><ArchiveRestore /></Button>
      ) : (
        <Button type="button" size="icon-sm" variant="ghost" disabled={pending} onClick={() => run(archiveProductAction, "Отправить товар в архив? Он исчезнет из каталога.", "Товар в архиве")} aria-label="В архив" title="В архив"><Archive /></Button>
      )}
      {canDelete && <Button type="button" size="icon-sm" variant="ghost" disabled={pending} onClick={() => run(deleteProductAction, "Удалить товар навсегда вместе с ключами на складе?", "Товар удалён")} aria-label="Удалить" title="Удалить"><Trash2 /></Button>}
    </span>
  );
}
