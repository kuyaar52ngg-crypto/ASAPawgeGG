import Link from "next/link";
import { BadgeCheck, ShoppingBag, Star } from "lucide-react";
import { UserAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Rating } from "@/components/ui/rating";

const sinceFmt = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });

export interface SellerCardData {
  slug: string | null;
  name: string;
  avatar: string | null;
  verified: boolean;
  rating: number;
  ratingCount: number;
  salesCount: number;
  since: string;
}

/** Seller block on the product page. */
export function SellerCard({ seller }: { seller: SellerCardData }) {
  return (
    <div className="glass rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-3.5">
        <UserAvatar name={seller.name} image={seller.avatar} className="size-14 text-base" />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-base font-bold">
            {seller.name}
            {seller.verified && <BadgeCheck className="size-4 shrink-0 text-accent" aria-label="Проверенный продавец" />}
          </p>
          <p className="text-xs text-muted-foreground">На площадке с {sinceFmt.format(new Date(seller.since))}</p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-foreground/5 p-3">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Star className="size-3.5" /> Рейтинг
          </dt>
          <dd className="mt-1">
            <Rating value={seller.rating} count={seller.ratingCount} />
          </dd>
        </div>
        <div className="rounded-xl bg-foreground/5 p-3">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShoppingBag className="size-3.5" /> Продаж
          </dt>
          <dd className="mt-1 font-semibold">{new Intl.NumberFormat("ru-RU").format(seller.salesCount)}</dd>
        </div>
      </dl>
      {seller.slug && (
        <Button asChild variant="outline" size="sm" className="mt-4 w-full">
          <Link href={`/seller-store/${seller.slug}`}>Все товары продавца</Link>
        </Button>
      )}
    </div>
  );
}
