"use client";
import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

export function Progress({ className, value, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root className={cn("relative h-2 w-full overflow-hidden rounded-full bg-foreground/10", className)} value={value} {...props}>
      <ProgressPrimitive.Indicator className="gradient-brand h-full transition-all" style={{ width: `${value ?? 0}%` }} />
    </ProgressPrimitive.Root>
  );
}
