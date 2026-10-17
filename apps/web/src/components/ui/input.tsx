import * as React from "react";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-xl border border-input bg-foreground/[0.04] px-3.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return <input type={type} className={cn(field, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(field, "min-h-24 py-3 leading-relaxed", className)} {...props} />;
}

export const fieldClassName = field;
