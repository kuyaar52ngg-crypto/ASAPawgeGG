import * as React from "react";
import { fieldClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Native <select> styled like the kit's Input — plays well with FormData-style dialogs. */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select className={cn(fieldClassName, "h-11 cursor-pointer appearance-auto pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function FieldRow({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-1.5 text-sm", className)}>
      <span className="font-medium">{label}</span>
      {children}
      {hint && !error && <span className="text-xs text-muted-foreground">{hint}</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </label>
  );
}
