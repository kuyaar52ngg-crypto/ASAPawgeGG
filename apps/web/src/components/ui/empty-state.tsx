import * as React from "react";
import { cn } from "@/lib/utils";

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("glass flex flex-col items-center gap-3 rounded-2xl px-6 py-14 text-center", className)}>
      {icon && <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary [&_svg]:size-7">{icon}</div>}
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}
