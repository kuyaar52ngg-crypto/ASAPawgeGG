"use client";
import type * as React from "react";
import { Input } from "@/components/ui/input";
import { FieldRow, NativeSelect } from "./fields";
import { useSettingsError } from "./settings-form";

export function TextSetting({ name, label, defaultValue, hint, placeholder, inputMode, type = "text" }: { name: string; label: string; defaultValue: string | number; hint?: string; placeholder?: string; inputMode?: "decimal" | "numeric"; type?: string }) {
  const error = useSettingsError(name);
  return (
    <FieldRow label={label} hint={hint} error={error}>
      <Input name={name} type={type} defaultValue={defaultValue} placeholder={placeholder} inputMode={inputMode} aria-invalid={!!error} />
    </FieldRow>
  );
}

export function SelectSetting({ name, label, defaultValue, options, hint }: { name: string; label: string; defaultValue: string; options: readonly { value: string; label: string }[]; hint?: string }) {
  const error = useSettingsError(name);
  return (
    <FieldRow label={label} hint={hint} error={error}>
      <NativeSelect name={name} defaultValue={defaultValue}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </NativeSelect>
    </FieldRow>
  );
}

export function ToggleSetting({ name, label, description, defaultChecked, badge }: { name: string; label: string; description?: string; defaultChecked: boolean; badge?: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 hover:bg-foreground/[0.03]">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 accent-[var(--primary)]" />
      <span className="grid gap-0.5 text-sm">
        <span className="flex flex-wrap items-center gap-2 font-medium">{label}{badge}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}
