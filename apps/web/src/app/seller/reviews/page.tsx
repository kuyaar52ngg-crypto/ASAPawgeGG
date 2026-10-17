import { Star } from "lucide-react";
import { prisma, type Prisma } from "@asap/db";
import { requireSellerPage } from "@/server/cabinet/seller-context";
import { maskName } from "@/server/catalog/queries";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Rating } from "@/components/ui/rating";
import { formatDateTime } from "@/components/cabinet/labels";
import { FilterPills, Pager } from "@/components/cabinet/pager";
import { ReplyForm } from "@/components/cabinet/seller-forms";

export const metadata = { title: "Отзывы" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 15;

export default async function SellerReviewsPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  const ctx = await requireSellerPage();
  const sp = await searchParams;
  const unanswered = sp.filter === "unanswered";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const where: Prisma.ReviewWhereInput = { sellerId: ctx.user.id, status: { not: "HIDDEN" }, ...(unanswered ? { reply: null } : {}) };
  const [total, reviews, pendingCount] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, rating: true, text: true, reply: true, repliedAt: true, createdAt: true, buyer: { select: { name: true } }, product: { select: { title: true, slug: true } } },
    }),
    prisma.review.count({ where: { sellerId: ctx.user.id, status: { not: "HIDDEN" }, reply: null } }),
  ]);
  const href = (f: string, p = 1) => `/seller/reviews?${new URLSearchParams({ ...(f === "unanswered" ? { filter: f } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <>
      <PageHeader title="Отзывы" description={`Рейтинг магазина: ${ctx.profile.rating > 0 ? ctx.profile.rating.toFixed(1) : "—"} (${ctx.profile.ratingCount})`} />
      <FilterPills active={unanswered ? "unanswered" : "all"} items={[{ key: "all", label: "Все", href: href("all") }, { key: "unanswered", label: "Без ответа", href: href("unanswered"), count: pendingCount }]} />
      {reviews.length === 0 ? (
        <EmptyState icon={<Star />} title="Отзывов нет" description={unanswered ? "Вы ответили на все отзывы." : "Отзывы появятся после того, как покупатели оценят ваши товары."} />
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <Card key={r.id} className="space-y-3 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{r.product.title}</p>
                  <p className="text-xs text-muted-foreground">{maskName(r.buyer.name)} · {formatDateTime(r.createdAt)}</p>
                </div>
                <Rating value={r.rating} />
              </div>
              {r.text ? <p className="text-sm whitespace-pre-wrap">{r.text}</p> : <p className="text-sm text-muted-foreground">Без комментария</p>}
              {r.reply && (
                <div className="border-l-2 border-primary/50 pl-3 text-sm">
                  <p className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground"><Badge variant="default">Ваш ответ</Badge>{r.repliedAt && formatDateTime(r.repliedAt)}</p>
                  <p className="whitespace-pre-wrap">{r.reply}</p>
                </div>
              )}
              {ctx.canWrite && <ReplyForm reviewId={r.id} initialReply={r.reply} />}
            </Card>
          ))}
        </div>
      )}
      <Pager page={page} pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))} hrefFor={(p) => href(unanswered ? "unanswered" : "all", p)} />
    </>
  );
}
