import { MessageSquareReply } from "lucide-react";
import { Rating } from "@/components/ui/rating";
import { UserAvatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { plural } from "@/lib/utils";
import type { ReviewView } from "@/server/catalog/queries";
import { Pagination } from "./pagination";

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });

export function ReviewItem({ r, product }: { r: ReviewView & { productTitle?: string }; product?: boolean }) {
  return (
    <li className="glass rounded-2xl p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <UserAvatar name={r.buyerName} className="size-10" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-semibold">{r.buyerName}</span>
            <Rating value={r.rating} />
            <time dateTime={r.createdAt} className="text-xs text-muted-foreground">
              {dateFmt.format(new Date(r.createdAt))}
            </time>
          </div>
          {(r.variantTitle || (product && r.productTitle)) && <p className="mt-0.5 text-xs text-muted-foreground">{[product ? r.productTitle : null, r.variantTitle].filter(Boolean).join(" · ")}</p>}
          {r.text && <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">{r.text}</p>}
          {r.reply && (
            <div className="mt-3 flex gap-2.5 rounded-xl bg-primary/10 p-3 text-sm">
              <MessageSquareReply className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="text-xs font-semibold text-primary">Ответ продавца</p>
                <p className="mt-0.5 whitespace-pre-line text-muted-foreground">{r.reply}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** Product reviews: summary with distribution bars + paginated list. */
export function ReviewsSection({
  avg,
  total,
  distribution,
  items,
  page,
  pageCount,
  hrefFor,
}: {
  avg: number;
  total: number;
  distribution: { stars: number; count: number }[];
  items: ReviewView[];
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (total === 0) return <EmptyState title="Отзывов пока нет" description="Станьте первым — отзыв можно оставить после получения товара." />;
  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_1fr]">
      <div className="glass h-fit rounded-2xl p-5">
        <p className="font-display text-4xl font-bold">{avg.toFixed(1)}</p>
        <Rating value={avg} className="mt-1" />
        <p className="mt-1 text-sm text-muted-foreground">
          {total} {plural(total, ["отзыв", "отзыва", "отзывов"])}
        </p>
        <ul className="mt-4 space-y-1.5">
          {distribution.map((d) => (
            <li key={d.stars} className="flex items-center gap-2 text-xs">
              <span className="w-3 text-muted-foreground">{d.stars}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
                <span className="block h-full rounded-full bg-warning" style={{ width: `${total ? (d.count / total) * 100 : 0}%` }} />
              </span>
              <span className="w-6 text-right text-muted-foreground">{d.count}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <ul className="space-y-3">
          {items.map((r) => (
            <ReviewItem key={r.id} r={r} />
          ))}
        </ul>
        <Pagination page={page} pageCount={pageCount} hrefFor={hrefFor} className="mt-6" />
      </div>
    </div>
  );
}
