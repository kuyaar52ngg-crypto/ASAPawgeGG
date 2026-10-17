"use client";
import * as React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface Option {
  value: string;
  label: string;
}

/** Thin wrapper over the Radix Select kit: value/onChange with a flat options list. */
export function SelectField({ id, value, onChange, options, placeholder, label, disabled }: { id?: string; value: string; onChange: (v: string) => void; options: Option[]; placeholder?: string; label?: string; disabled?: boolean }) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label ?? placeholder}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
