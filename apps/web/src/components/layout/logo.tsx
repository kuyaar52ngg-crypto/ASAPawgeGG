import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <Link href="/" className={cn("group inline-flex items-center gap-2.5", className)} aria-label="ASAPawge GG — на главную">
      <span className="gradient-brand relative flex size-9 items-center justify-center rounded-xl shadow-[0_6px_20px_-6px_var(--glow-violet)] transition-transform group-hover:rotate-6">
        <svg viewBox="0 0 24 24" className="size-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 17 12 4l7 13" />
          <path d="M8.5 12h7" />
        </svg>
      </span>
      {!compact && (
        <span className="font-display text-[17px] leading-none font-bold tracking-tight">
          ASAPawge<span className="gradient-brand-text"> GG</span>
        </span>
      )}
    </Link>
  );
}
