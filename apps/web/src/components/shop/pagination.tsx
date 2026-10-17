import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

function windowed(page: number, pageCount: number): (number | "…")[] {
  const set = new Set<number>([1, pageCount, page, page - 1, page + 1, page - 2, page + 2].filter((n) => n >= 1 && n <= pageCount));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1]! > 1) out.push("…");
    out.push(n);
  });
  return out;
}

/** Server-rendered pagination (plain links => crawlable). `hrefFor(page)` builds the URL. */
export function Pagination({ page, pageCount, hrefFor, className }: { page: number; pageCount: number; hrefFor: (page: number) => string; className?: string }) {
  if (pageCount <= 1) return null;
  const item = "flex h-10 min-w-10 items-center justify-center rounded-xl px-3 text-sm font-semibold transition-colors";
  return (
    <nav aria-label="Страницы" className={cn("flex flex-wrap items-center justify-center gap-1.5", className)}>
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" aria-label="Предыдущая страница" className={cn(item, "glass hover:bg-foreground/10")}>
          <ChevronLeft className="size-4" />
        </Link>
      ) : null}
      {windowed(page, pageCount).map((n, i) =>
        n === "…" ? (
          <span key={`gap${i}`} className="px-1 text-muted-foreground">
            …
          </span>
        ) : (
          <Link key={n} href={hrefFor(n)} aria-current={n === page ? "page" : undefined} className={cn(item, n === page ? "gradient-brand text-white shadow-[0_6px_20px_-6px_var(--glow-violet)]" : "glass hover:bg-foreground/10")}>
            {n}
          </Link>
        ),
      )}
      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} rel="next" aria-label="Следующая страница" className={cn(item, "glass hover:bg-foreground/10")}>
          <ChevronRight className="size-4" />
        </Link>
      ) : null}
    </nav>
  );
}
