import Link from "next/link";
import Image from "next/image";
import { Zap } from "lucide-react";
import { PLATFORMS, PRODUCT_TYPE_LABELS, REGIONS, discountPercent } from "@asap/shared";
import { Price } from "@/components/ui/price";
import { Rating } from "@/components/ui/rating";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProductCardData } from "@/server/catalog/types";
import { FavoriteButton } from "./favorite-button";
import { QuickAddButton } from "./quick-add-button";

export type { ProductCardData } from "@/server/catalog/types";

export const platformLabel = (v: string | null) => (v ? (PLATFORMS.find((p) => p.value === v)?.label ?? v) : null);
export const regionLabel = (v: string | null) => (v ? (REGIONS.find((r) => r.value === v)?.label ?? v) : null);

const chip = "rounded-md bg-background/70 px-2 py-0.5 text-[11px] font-semibold text-foreground backdrop-blur";

/** Storefront product card: cover, discount badge, platform/region chips, price, rating, seller, favourite + quick add. */
export function ProductCard({ p, priority = false, className }: { p: ProductCardData; priority?: boolean; className?: string }) {
  const pct = discountPercent(p.price, p.oldPrice);
  const quickAdd = !p.hasVariants && p.deliveryMode === "AUTO_STOCK" && p.type !== "TOPUP" && p.inStock;

  return (
    <article className={cn("glass glow-hover group/card relative flex h-full flex-col overflow-hidden rounded-2xl", !p.inStock && "opacity-90", className)}>
      <div className="relative aspect-[4/5] overflow-hidden bg-muted">
        {p.coverImage ? (
          <Image
            src={p.coverImage}
            alt=""
            fill
            priority={priority}
            sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            className={cn("object-cover transition-transform duration-500 group-hover/card:scale-[1.06]", !p.inStock && "grayscale-[60%]")}
          />
        ) : (
          <div className="gradient-brand flex size-full items-center justify-center font-display text-3xl font-bold text-white/80">{p.title.slice(0, 1)}</div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 to-transparent" />
        {pct > 0 && <span className="gradient-brand absolute top-2.5 left-2.5 rounded-lg px-2 py-1 text-xs font-bold text-white shadow-lg">-{pct}%</span>}
        <FavoriteButton productId={p.id} initial={p.isFavorite} className="absolute top-2.5 right-2.5" />
        <div className="absolute bottom-2.5 left-2.5 flex flex-wrap gap-1.5">
          {p.platform && <span className={chip}>{platformLabel(p.platform)}</span>}
          {p.region && <span className={chip}>{regionLabel(p.region)}</span>}
        </div>
        {!p.inStock && <span className="absolute right-2.5 bottom-2.5 rounded-md bg-destructive/90 px-2 py-0.5 text-[11px] font-bold text-white">Нет в наличии</span>}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{PRODUCT_TYPE_LABELS[p.type]}</span>
          {p.deliveryMode === "AUTO_STOCK" && p.inStock && (
            <span className="inline-flex items-center gap-1 text-success">
              <Zap className="size-3" /> Мгновенно
            </span>
          )}
        </div>
        <h3 className="line-clamp-2 min-h-10 text-sm leading-snug font-semibold">
          <Link href={`/product/${p.slug}`} className="outline-none after:absolute after:inset-0 after:z-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:rounded-2xl">
            {p.title}
          </Link>
        </h3>
        <div className="flex items-center justify-between gap-2">
          <Rating value={p.ratingAvg} count={p.ratingCount} />
          {p.sellerName && <span className="max-w-[48%] truncate text-xs text-muted-foreground">{p.sellerName}</span>}
        </div>
        <Price price={p.price} oldPrice={p.oldPrice} from={p.hasVariants} className="mt-auto pt-1" />
        <div className="relative z-10 mt-1">
          {quickAdd ? (
            <QuickAddButton productId={p.id} title={p.title} price={p.price} className="w-full" />
          ) : p.inStock ? (
            <Button asChild size="sm" variant="secondary" className="w-full">
              <Link href={`/product/${p.slug}`}>Выбрать</Link>
            </Button>
          ) : (
            <Button size="sm" variant="secondary" className="w-full" disabled>
              Нет в наличии
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
