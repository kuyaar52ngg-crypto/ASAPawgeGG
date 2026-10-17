"use client";
import * as React from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRunAction } from "./use-run-action";
import { saveSettingsAction } from "@/app/admin/settings/actions";

type Section = "commission" | "ai" | "analytics" | "payments";

/**
 * One card-section of /admin/settings: gathers named inputs (checkboxes → boolean when `booleans` lists them)
 * and sends them to the server action, which validates with zod and writes the Setting rows + audit.
 */
export function SettingsForm({ section, booleans = [], children }: { section: Section; booleans?: string[]; children: React.ReactNode }) {
  const { run, pending } = useRunAction();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[] | undefined>>({});

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const values: Record<string, string | boolean> = {};
    for (const [k, v] of fd.entries()) if (typeof v === "string") values[k] = v;
    for (const b of booleans) values[b] = fd.get(b) === "on";
    setError(null);
    setFieldErrors({});
    run(() => saveSettingsAction({ section, values }), { success: "Настройки сохранены", onError: (r) => { setError(r.error); setFieldErrors(r.fieldErrors ?? {}); } });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormErrors.Provider value={fieldErrors}>{children}</FormErrors.Provider>
      {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div><Button type="submit" loading={pending}>{!pending && <Save />} Сохранить</Button></div>
    </form>
  );
}

const FormErrors = React.createContext<Record<string, string[] | undefined>>({});
export function useSettingsError(name: string) {
  return React.useContext(FormErrors)[name]?.[0];
}
