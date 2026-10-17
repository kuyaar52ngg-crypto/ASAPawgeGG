import Link from "next/link";
import { Star } from "lucide-react";
import { prisma } from "@asap/db";
import { requireUser } from "@/server/auth/session";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Rating } from "@/components/ui/rating";
import { formatDateTime } from "@/components/cabinet/labels";
import { Pager } from "@/components/cabinet/pager";
import { Thumb } from "@/components/cabinet/thumb";

export const metadata = { title: "Мои отзывы" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 15;

export default async function MyReviewsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireUser("/account/reviews");
  const page = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);
  const [total, reviews, pending] = await Promise.all([
    prisma.review.count({ where: { buyerId: user.id } }),
    prisma.review.findMany({
      where: { buyerId: user.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, rating: true, text: true, reply: true, status: true, createdAt: true, orderItem: { select: { orderId: true, title: true } }, product: { select: { slug: true, coverImage: true } } },
    }),
    // delivered items still waiting for a review
    prisma.orderItem.findMany({
      where: { status: "DELIVERED", review: null, order: { buyerId: user.id, status: { in: ["DELIVERED", "DISPUTED"] } } },
      orderBy: { deliveredAt: "desc" },
      take: 5,
      select: { id: true, orderId: true, title: true, product: { select: { coverImage: true } } },
    }),
  ]);

  return (
    <>
      <PageHeader title="Мои отзывы" description="Отзывы помогают другим покупателям и продавцам. Оставить отзыв можно на странице заказа." />

      {pending.length > 0 && (
        <Card className="mb-6 p-5">
          <h2 className="mb-3 font-display text-base font-semibold">Ждут вашей оценки</h2>
          <ul className="space-y-2">
            {pending.map((p) => (
              <li key={p.id}>
                <Link href={`/account/orders/${p.orderId}`} className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-foreground/5">
                  <Thumb src={p.product.coverImage} title={p.title} className="size-10" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</span>
                  <span className="text-sm text-primary">Оценить</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {reviews.length === 0 ? (
        <EmptyState icon={<Star />} title="Отзывов пока нет" description="После получения товара вы сможете оценить покупку." />
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <Card key={r.id} className="p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <Thumb src={r.product.coverImage} title={r.orderItem.title} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/product/${r.product.slug}`} className="truncate text-sm font-semibold hover:text-primary">{r.orderItem.title}</Link>
                    <Rating value={r.rating} />
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)} · <Link href={`/account/orders/${r.orderItem.orderId}`} className="hover:text-primary">заказ</Link>{r.status === "HIDDEN" && <> · <Badge variant="warning">скрыт модерацией</Badge></>}</p>
                  {r.text && <p className="mt-2 text-sm whitespace-pre-wrap">{r.text}</p>}
                  {r.reply && <p className="mt-2 border-l-2 border-primary/50 pl-3 text-sm text-muted-foreground"><span className="font-medium text-foreground">Ответ продавца:</span> {r.reply}</p>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Pager page={page} pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))} hrefFor={(p) => `/account/reviews?page=${p}`} />
    </>
  );
}
