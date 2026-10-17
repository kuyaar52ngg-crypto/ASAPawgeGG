"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { applyForSellerAction, changePasswordAction, updateProfileAction } from "@/app/account/actions";

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [value, setValue] = React.useState(name);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await updateProfileAction({ name: value });
      if (res.ok) {
        toast.success("Профиль обновлён");
        router.refresh();
      } else setError(res.fieldErrors?.name?.[0] ?? res.error);
    });
  }
  return (
    <form onSubmit={submit} className="max-w-md space-y-4">
      <Field label="Email" htmlFor="profile-email" hint="Email используется для входа и не меняется">
        <Input id="profile-email" value={email} disabled readOnly />
      </Field>
      <Field label="Имя" htmlFor="profile-name">
        <Input id="profile-name" value={value} onChange={(e) => setValue(e.target.value)} required minLength={2} maxLength={60} autoComplete="name" />
      </Field>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" loading={pending} disabled={value.trim() === name}>Сохранить</Button>
    </form>
  );
}

export function PasswordForm() {
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[] | undefined>>({});
  const [pending, startTransition] = React.useTransition();
  const formRef = React.useRef<HTMLFormElement>(null);
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await changePasswordAction({ current: String(fd.get("current") ?? ""), next: String(fd.get("next") ?? ""), confirm: String(fd.get("confirm") ?? "") });
      if (res.ok) {
        toast.success("Пароль изменён");
        formRef.current?.reset();
      } else {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
      }
    });
  }
  return (
    <form ref={formRef} onSubmit={submit} className="max-w-md space-y-4">
      <Field label="Текущий пароль" htmlFor="pwd-current" error={fieldErrors.current?.[0]}>
        <Input id="pwd-current" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="Новый пароль" htmlFor="pwd-next" hint="Минимум 8 символов, буквы и цифры" error={fieldErrors.next?.[0]}>
        <Input id="pwd-next" name="next" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Повторите новый пароль" htmlFor="pwd-confirm" error={fieldErrors.confirm?.[0]}>
        <Input id="pwd-confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      {error && !Object.keys(fieldErrors).length && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" loading={pending}>Сменить пароль</Button>
    </form>
  );
}

export function BecomeSellerForm({ initialShopName, resubmit }: { initialShopName?: string; resubmit?: boolean }) {
  const router = useRouter();
  const [shopName, setShopName] = React.useState(initialShopName ?? "");
  const [description, setDescription] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[] | undefined>>({});
  const [pending, startTransition] = React.useTransition();
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await applyForSellerAction({ shopName, description });
      if (res.ok) {
        toast.success("Заявка отправлена");
        router.refresh();
      } else {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
      }
    });
  }
  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <Field label="Название магазина" htmlFor="shop-name" error={fieldErrors.shopName?.[0]}>
        <Input id="shop-name" value={shopName} onChange={(e) => setShopName(e.target.value)} required minLength={3} maxLength={60} placeholder="Например, Digital Hub" />
      </Field>
      <Field label="Чем вы торгуете" htmlFor="shop-desc" hint="Какие товары, откуда ключи, опыт продаж — это поможет быстрее пройти проверку" error={fieldErrors.description?.[0]}>
        <Textarea id="shop-desc" value={description} onChange={(e) => setDescription(e.target.value)} required minLength={20} maxLength={1000} className="min-h-32" />
      </Field>
      {error && !Object.keys(fieldErrors).length && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" loading={pending}>{resubmit ? "Отправить заявку повторно" : "Отправить заявку"}</Button>
    </form>
  );
}
