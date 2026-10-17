import { cn } from "@/lib/utils";

/** Small product cover. Plain <img> on purpose: cabinets list many rows and must never fail on an unknown image host. */
export function Thumb({ src, title, className }: { src?: string | null; title: string; className?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" className={cn("size-12 shrink-0 rounded-lg bg-muted object-cover", className)} />
  ) : (
    <span className={cn("gradient-brand flex size-12 shrink-0 items-center justify-center rounded-lg font-display text-lg font-bold text-white/85", className)} aria-hidden>
      {title.slice(0, 1).toUpperCase()}
    </span>
  );
}
