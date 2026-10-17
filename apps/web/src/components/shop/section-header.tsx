import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Section title row with optional "see all" link. */
export function SectionHeader({ title, subtitle, href, hrefLabel = "Смотреть все", icon, className }: { title: string; subtitle?: string; href?: string; hrefLabel?: string; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-5 flex items-end justify-between gap-4", className)}>
      <div>
        <h2 className="flex items-center gap-2.5 text-xl font-bold sm:text-2xl">
          {icon && <span className="gradient-brand flex size-8 items-center justify-center rounded-lg text-white [&_svg]:size-4">{icon}</span>}
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {href && (
        <Link href={href} className="group inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary hover:text-accent">
          {hrefLabel}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}
