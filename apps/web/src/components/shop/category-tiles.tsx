import Link from "next/link";
import { CategoryIcon } from "@/components/ui/category-icon";
import { Reveal } from "@/components/ui/reveal";
import { plural } from "@/lib/utils";
import type { CategoryTile } from "@/server/catalog/queries";

/** Home grid of root categories with icons, product counts and subcategory chips. */
export function CategoryTiles({ tiles }: { tiles: CategoryTile[] }) {
  return (
    <Reveal stagger={0.06} className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <Link
          key={t.id}
          href={`/catalog/${t.slug}`}
          className="glass glow-hover group relative flex min-h-36 flex-col justify-between gap-4 overflow-hidden rounded-2xl p-4 sm:p-5"
        >
          <div className="pointer-events-none absolute -top-10 -right-10 size-28 rounded-full bg-primary/20 blur-2xl transition-opacity duration-300 group-hover:opacity-100 sm:opacity-60" />
          <span className="gradient-brand relative flex size-12 items-center justify-center rounded-2xl text-white shadow-[0_8px_24px_-8px_var(--glow-violet)] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
            <CategoryIcon name={t.icon} className="size-6" />
          </span>
          <span className="relative">
            <span className="block font-display text-sm leading-tight font-semibold sm:text-[15px]">{t.name}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {t.count} {plural(t.count, ["товар", "товара", "товаров"])}
            </span>
          </span>
        </Link>
      ))}
    </Reveal>
  );
}
