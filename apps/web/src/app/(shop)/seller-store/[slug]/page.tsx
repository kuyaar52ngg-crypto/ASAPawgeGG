import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeCheck, CalendarDays, ShoppingBag, Star } from "lucide-react";
import { UserAvatar } from "@/components/ui/avatar";
import { Rating } from "@/components/ui/rating";
import { getSessionUser } from "@/server/auth/session";
import { getSellerBySlugOrUserId, getSellerReviews } from "@/server/catalog/queries";
import { parseCatalogParams, type RawSearchParams } from "@/server/catalog/query";
import { CatalogView, countActiveFilters } from "@/components/shop/catalog-view";
import { ReviewItem } from "@/components/shop/reviews-section";
import { SectionHeader } from "@/components/shop/section-header";

export const dynamic = "force-dynamic";

const loadSeller = cache(getSellerBySlugOrUserId);
const sinceFmt = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const s = await loadSeller(slug);
  if (!s) return { title: "Продавец не найден" };
  const q = parseCatalogParams(await searchParams);
  return {
    title: `${s.shopName} — магазин продавца`,
    description: s.description ?? `Товары продавца ${s.shopName} на ASAPawge GG: рейтинг ${s.rating.toFixed(1)}, ${s.salesCount} продаж.`,
    alternates: { canonical: `/seller-store/${s.slug}` },
    robots: countActiveFilters(q) > 0 || q.page > 1 ? { index: false, follow: true } : undefined,
  };
}

export default async function SellerStorePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const seller = await loadSeller(slug);
  if (!seller) notFound();
  const q = { ...parseCatalogParams(await searchParams), sellerId: seller.userId };
  const [user, reviews] = await Promise.all([getSessionUser(), getSellerReviews(seller.userId)]);

  const stats = [
    { icon: Star, label: "Рейтинг", value: <Rating value={seller.rating} count={seller.ratingCount} /> },
    { icon: ShoppingBag, label: "Продаж", value: <span className="font-semibold">{new Intl.NumberFormat("ru-RU").format(seller.salesCount)}</span> },
    { icon: CalendarDays, label: "На площадке с", value: <span className="font-semibold">{sinceFmt.format(seller.createdAt)}</span> },
  ];

  return (
    <>
      <CatalogView
        q={q}
        basePath={`/seller-store/${seller.slug}`}
        userId={user?.id}
        crumbs={[{ href: "/", label: "Главная" }, { href: `/seller-store/${seller.slug}`, label: seller.shopName }]}
        heading={
          <div className="glass gradient-border relative overflow-hidden rounded-3xl p-5 sm:p-8">
            <div className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-primary/25 blur-3xl" />
            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
              <UserAvatar name={seller.shopName} image={seller.avatar} className="size-20 text-2xl" />
              <div className="min-w-0 flex-1">
                <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold sm:text-3xl">
                  {seller.shopName}
                  {seller.status === "VERIFIED" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1 font-sans text-xs font-semibold text-accent">
                      <BadgeCheck className="size-3.5" /> Проверенный продавец
                    </span>
                  )}
                </h1>
                {seller.description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{seller.description}</p>}
              </div>
              <dl className="grid grid-cols-3 gap-3 sm:gap-4">
                {stats.map(({ icon: Icon, label, value }) => (
                  <div key={label} className="rounded-xl bg-foreground/5 px-3 py-2.5 text-sm">
                    <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Icon className="size-3.5" /> {label}
                    </dt>
                    <dd className="mt-1 whitespace-nowrap">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        }
      />
      {reviews.length > 0 && (
        <div className="container-page pb-6">
          <SectionHeader title="Отзывы о продавце" subtitle="Последние оценки покупателей" />
          <ul className="grid gap-3 lg:grid-cols-2">
            {reviews.map((r) => (
              <ReviewItem key={r.id} r={r} product />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
