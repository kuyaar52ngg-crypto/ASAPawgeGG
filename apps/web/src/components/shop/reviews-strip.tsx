import Link from "next/link";
import { Quote } from "lucide-react";
import { Rating } from "@/components/ui/rating";
import { UserAvatar } from "@/components/ui/avatar";
import { Reveal } from "@/components/ui/reveal";
import type { HomeReview } from "@/server/catalog/queries";

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });

/** Latest published reviews (real rows from Postgres). */
export function ReviewsStrip({ reviews }: { reviews: HomeReview[] }) {
  return (
    <Reveal stagger={0.07} className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
      {reviews.map((r) => (
        <figure key={r.id} className="glass glow-hover relative flex flex-col gap-3 rounded-2xl p-4 sm:p-5">
          <Quote className="absolute top-4 right-4 size-6 text-primary/25" />
          <Rating value={r.rating} />
          <blockquote className="line-clamp-5 text-sm leading-relaxed">{r.text}</blockquote>
          <figcaption className="mt-auto flex items-center gap-3 pt-1">
            <UserAvatar name={r.buyerName} className="size-9" />
            <div className="min-w-0 text-xs">
              <p className="truncate font-semibold">{r.buyerName}</p>
              <Link href={`/product/${r.productSlug}`} className="block truncate text-muted-foreground hover:text-primary">
                {r.productTitle}
              </Link>
              <time dateTime={r.createdAt} className="text-muted-foreground/80">
                {dateFmt.format(new Date(r.createdAt))}
              </time>
            </div>
          </figcaption>
        </figure>
      ))}
    </Reveal>
  );
}
