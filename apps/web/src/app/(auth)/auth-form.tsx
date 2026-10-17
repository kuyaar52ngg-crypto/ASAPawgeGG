"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { signInAction, signUpAction, type AuthFormState } from "./actions";

const initial: AuthFormState = {};

export function SignInForm() {
  const params = useSearchParams();
  const [state, action, pending] = useActionState(signInAction, initial);
  return (
    <Card className="gradient-border w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">Вход</CardTitle>
        <CardDescription>Войдите, чтобы покупать, следить за заказами и получать ключи.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="callbackUrl" value={params.get("callbackUrl") ?? ""} />
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
          </Field>
          <Field label="Пароль" htmlFor="password">
            <Input id="password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" />
          </Field>
          {state.error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}
          <Button type="submit" className="w-full" loading={pending}>Войти</Button>
          <p className="text-center text-sm text-muted-foreground">
            Нет аккаунта? <Link href="/sign-up" className="font-semibold text-primary hover:underline">Зарегистрироваться</Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export function SignUpForm() {
  const params = useSearchParams();
  const [state, action, pending] = useActionState(signUpAction, initial);
  const [seller, setSeller] = React.useState(params.get("seller") === "1");
  return (
    <Card className="gradient-border w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">Регистрация</CardTitle>
        <CardDescription>Создайте аккаунт за минуту. Покупатели и продавцы — в одном месте.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="callbackUrl" value={params.get("callbackUrl") ?? ""} />
          <Field label="Имя" htmlFor="name" error={state.fieldErrors?.name?.[0]}>
            <Input id="name" name="name" autoComplete="name" required placeholder="Как к вам обращаться" />
          </Field>
          <Field label="Email" htmlFor="email" error={state.fieldErrors?.email?.[0]}>
            <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
          </Field>
          <Field label="Пароль" htmlFor="password" hint="Минимум 8 символов, буквы и цифры" error={state.fieldErrors?.password?.[0]}>
            <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} placeholder="••••••••" />
          </Field>
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <Checkbox checked={seller} onCheckedChange={(v) => setSeller(v === true)} className="mt-0.5" />
            <input type="hidden" name="asSeller" value={seller ? "1" : "0"} />
            <span>Я хочу продавать товары <span className="block text-xs text-muted-foreground">Создадим профиль продавца, модератор проверит его в ближайшее время</span></span>
          </label>
          {state.error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}
          <Button type="submit" className="w-full" loading={pending}>Создать аккаунт</Button>
          <p className="text-center text-xs text-muted-foreground">Регистрируясь, вы принимаете <Link href="/info/offer" className="underline">оферту</Link> и <Link href="/info/privacy" className="underline">политику конфиденциальности</Link>.</p>
          <p className="text-center text-sm text-muted-foreground">
            Уже есть аккаунт? <Link href="/sign-in" className="font-semibold text-primary hover:underline">Войти</Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
