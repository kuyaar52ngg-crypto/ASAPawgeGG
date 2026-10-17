import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** KPI tile used on the cabinet dashboards. */
export function StatCard({ label, value, hint, icon, className, tone = "default" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; className?: string; tone?: "default" | "success" | "warning" }) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        {icon && <span className={cn("flex size-9 items-center justify-center rounded-xl bg-primary/12 text-primary [&_svg]:size-[18px]", tone === "success" && "bg-success/15 text-success", tone === "warning" && "bg-warning/15 text-warning")}>{icon}</span>}
      </div>
      <p className="mt-2 font-display text-2xl font-bold sm:text-3xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
