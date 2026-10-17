import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Headphones, ShieldCheck, Zap } from "lucide-react";
import { DELIVERY_MODE_LABELS, PRODUCT_TYPE_LABELS, type DeliveryModeName, type ProductTypeName } from "@asap/shared";
import { Rating } from "@/components/ui/rating";
import { getSessionUser } from "@/server/auth/session";
import { trackEvent } from "@/server/analytics/track";
import { bumpViewCount, getProductBySlug, getProductReviews, getSimilarProducts, getStockByVariant, isFavorite } from "@/server/catalog/queries";
import { getActivationGuide } from "@/server/catalog/activation";
import { BuyBox } from "@/components/shop/buy-box";
import { ProductGallery } from "@/components/shop/product-gallery";
import { ProductViewTracker } from "@/components/shop/product-view-tracker";
import { SafeMarkdown } from "@/components/shop/safe-markdown";
import { SellerCard } from "@/components/shop/seller-card";
import { ReviewsSection } from "@/components/shop/reviews-section";
import { SectionHeader } from "@/components/shop/section-header";
import { ProductCarousel } from "@/components/shop/product-carousel";
import { ProductCard, platformLabel, regionLabel } from "@/components/shop/product-card";
import { plural } from "@/lib/utils";

export const dynamic = "force-dynamic";

const loadProduct = cache(getProductBySlug);
const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ rpage?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const p = await loadProduct(slug);
  if (!p) return { title: "Товар не найден" };
  const verb = p.type === "SUBSCRIPTION" ? "Купить подписку" : p.type === "TOPUP" ? "Пополнение:" : "Купить";
  const description = (p.shortDescription ?? p.description).replace(/[#*`>\[\]]/g, "").replace(/\s+/g, " ").slice(0, 160);
  return {
    title: `${verb} ${p.title}`,
    description,
    alternates: { canonical: `/product/${p.slug}` },
    openGraph: { type: "website", title: p.title, description, images: p.coverImage ? [{ url: p.coverImage }] : undefined },
    twitter: { card: "summary_large_image", title: p.title, description, images: p.coverImage ? [p.coverImage] : undefined },
  };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const p = await loadProduct(slug);
  if (!p) notFound();

  const rpage = Math.max(1, Number.parseInt(sp.rpage ?? "1", 10) || 1);
  const user = await getSessionUser();
  const [stockMap, reviews, similar, fav] = await Promise.all([
    getStockByVariant(p.id),
    getProductReviews(p.id, rpage),
    getSimilarProducts({ id: p.id, categoryId: p.category.id, type: p.type, platform: p.platform }, user?.id),
    isFavorite(user?.id, p.id),
  ]);

  // analytics: server-side view_item + counter (never blocks rendering)
  const sid = (await cookies()).get("asap_sid")?.value ?? null;
  if (rpage === 1) {
    void trackEvent({ name: "view_item", userId: user?.id ?? null, sessionId: sid, path: `/product/${p.slug}`, properties: { productId: p.id } });
    bumpViewCount(p.id);
  }

  const mode = p.deliveryMode as DeliveryModeName;
  const stocked = mode === "AUTO_STOCK";
  const variants = p.variants.map((v) => ({ id: v.id, title: v.title, price: v.price, oldPrice: v.oldPrice && v.oldPrice > v.price ? v.oldPrice : null, stock: stocked ? (stockMap.get(v.id) ?? 0) : null }));
  const productStock = p.variants.length === 0 && stocked ? (stockMap.get("") ?? 0) : null;
  const totalStock = stocked ? (p.variants.length > 0 ? variants.reduce((s, v) => s + (v.stock ?? 0), 0) : (productStock ?? 0)) : null;
  const inStock = totalStock === null || totalStock > 0;

  const gallery = [p.coverImage, ...p.images].filter((x, i, arr): x is string => !!x && arr.indexOf(x) === i);
  const guide = getActivationGuide({ type: p.type, deliveryMode: p.deliveryMode, platform: p.platform, region: p.region, attributes: p.attributes });
  const sp_ = p.seller.sellerProfile;
  const sellerName = sp_?.shopName ?? p.seller.name ?? "Продавец";
  const oldPrice = p.oldPrice && p.oldPrice > p.price ? p.oldPrice : null;

  const crumbs = [
    { href: "/", label: "Главная" },
    { href: "/catalog", label: "Каталог" },
    { href: `/catalog/${p.category.slug}`, label: p.category.name },
    { href: `/product/${p.slug}`, label: p.title },
  ];

  const specs: [string, string][] = [
    ["Категория", p.category.name],
    ["Тип", PRODUCT_TYPE_LABELS[p.type as ProductTypeName]],
    ...(p.platform ? ([["Платформа", platformLabel(p.platform) ?? p.platform]] as [string, string][]) : []),
    ...(p.region ? ([["Регион", regionLabel(p.region) ?? p.region]] as [string, string][]) : []),
    ["Выдача", DELIVERY_MODE_LABELS[mode]],
    ["Продавец", sellerName],
  ];

  const url = `${appUrl()}/product/${p.slug}`;
  const prices = variants.length ? variants.map((v) => v.price) : [p.price];
  const availability = inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        name: p.title,
        description: (p.shortDescription ?? p.description).replace(/\s+/g, " ").slice(0, 500),
        sku: p.id,
        image: gallery.length ? gallery : undefined,
        category: p.category.name,
        brand: { "@type": "Brand", name: sellerName },
        url,
        offers:
          variants.length > 1
            ? { "@type": "AggregateOffer", priceCurrency: "RUB", lowPrice: Math.min(...prices) / 100, highPrice: Math.max(...prices) / 100, offerCount: variants.length, availability, url }
            : { "@type": "Offer", priceCurrency: "RUB", price: prices[0]! / 100, availability, url, itemCondition: "https://schema.org/NewCondition", seller: { "@type": "Organization", name: sellerName } },
        ...(p.ratingCount > 0 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: Number(p.ratingAvg.toFixed(1)), reviewCount: p.ratingCount, bestRating: 5, worstRating: 1 } } : {}),
        ...(reviews.items.length > 0
          ? { review: reviews.items.slice(0, 3).map((r) => ({ "@type": "Review", reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5 }, author: { "@type": "Person", name: r.buyerName }, datePublished: r.createdAt.slice(0, 10), reviewBody: r.text ?? undefined })) }
          : {}),
      },
      { "@type": "BreadcrumbList", itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.label, item: `${appUrl()}${c.href}` })) },
    ],
  };

  return (
    <div className="container-page py-6 sm:py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <ProductViewTracker id={p.id} name={p.title} price={p.price} category={p.category.name} />

      <nav aria-label="Хлебные крошки" className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {crumbs.map((c, i) => (
          <span key={c.href} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>/</span>}
            {i < crumbs.length - 1 ? (
              <Link href={c.href} className="hover:text-foreground">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="max-w-[40ch] truncate text-foreground">
                {c.label}
              </span>
            )}
          </span>
        ))}
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-10">
        <div className="mx-auto w-full max-w-sm lg:max-w-none">
          <ProductGallery images={gallery} title={p.title} />
        </div>

        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/catalog/${p.category.slug}`} className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/25">
              {p.category.name}
            </Link>
            {p.platform && <span className="rounded-full bg-foreground/10 px-3 py-1 text-xs font-semibold">{platformLabel(p.platform)}</span>}
            {p.region && <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold">Регион: {regionLabel(p.region)}</span>}
          </div>
          <h1 className="text-2xl leading-tight font-bold sm:text-3xl lg:text-4xl">{p.title}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <a href="#reviews" className="inline-flex items-center gap-1.5 hover:text-foreground">
              <Rating value={p.ratingAvg} count={p.ratingCount} />
            </a>
            <span>
              Продано: <span className="font-semibold text-foreground">{new Intl.NumberFormat("ru-RU").format(p.salesCount)}</span>
            </span>
            <span className="inline-flex items-center gap-1 text-success">
              <Zap className="size-3.5" /> {mode === "AUTO_STOCK" ? "Мгновенная доставка" : mode === "AUTO_PROVIDER" ? "Автоматическое пополнение" : "Выдача продавцом"}
            </span>
          </div>
          {p.shortDescription && <p className="text-[15px] leading-relaxed text-muted-foreground">{p.shortDescription}</p>}

          <BuyBox
            product={{ id: p.id, title: p.title, type: p.type, deliveryMode: mode, price: p.price, oldPrice, categoryName: p.category.name, isFavorite: fav }}
            variants={variants}
            stock={productStock}
          />
        </div>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-10">
          <section aria-labelledby="descr">
            <h2 id="descr" className="mb-4 text-xl font-bold">
              Описание
            </h2>
            <div className="glass rounded-2xl p-5 sm:p-6">
              <SafeMarkdown source={p.description} />
              {p.tags.length > 0 && (
                <ul className="mt-5 flex flex-wrap gap-2">
                  {p.tags.map((t) => (
                    <li key={t}>
                      <Link href={`/search?q=${encodeURIComponent(t)}`} className="rounded-full bg-foreground/5 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary">
                        #{t}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section aria-labelledby="activation">
            <h2 id="activation" className="mb-4 text-xl font-bold">
              {guide.title}
            </h2>
            <ol className="glass space-y-3 rounded-2xl p-5 sm:p-6">
              {guide.steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed">
                  <span className="gradient-brand flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">{i + 1}</span>
                  <span className="pt-0.5">{s}</span>
                </li>
              ))}
              {guide.note && <li className="rounded-xl bg-warning/10 p-3 text-sm text-warning">{guide.note}</li>}
            </ol>
          </section>
        </div>

        <aside className="space-y-4">
          <SellerCard
            seller={{
              slug: sp_?.slug ?? null,
              name: sellerName,
              avatar: sp_?.avatar ?? null,
              verified: sp_?.status === "VERIFIED",
              rating: sp_?.rating ?? 0,
              ratingCount: sp_?.ratingCount ?? 0,
              salesCount: sp_?.salesCount ?? 0,
              since: (sp_?.createdAt ?? p.seller.createdAt).toISOString(),
            }}
          />
          <dl className="glass divide-y divide-border rounded-2xl text-sm">
            {specs.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="glass space-y-3 rounded-2xl p-4 text-sm">
            <p className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" /> Гарантия возврата — спор и возврат на баланс при проблеме с товаром.
            </p>
            <p className="flex items-start gap-2.5">
              <Headphones className="mt-0.5 size-4 shrink-0 text-accent" /> Поддержка 24/7: чат на сайте и <Link href="/info/contacts" className="text-primary hover:underline">контакты</Link>.
            </p>
          </div>
        </aside>
      </div>

      <section id="reviews" className="mt-12 scroll-mt-24" aria-labelledby="reviews-title">
        <h2 id="reviews-title" className="mb-4 text-xl font-bold">
          Отзывы{reviews.total > 0 && <span className="ml-2 text-base font-medium text-muted-foreground">{reviews.total} {plural(reviews.total, ["отзыв", "отзыва", "отзывов"])}</span>}
        </h2>
        <ReviewsSection
          avg={p.ratingAvg}
          total={reviews.total}
          distribution={reviews.distribution}
          items={reviews.items}
          page={rpage}
          pageCount={reviews.pageCount}
          hrefFor={(n) => `/product/${p.slug}${n > 1 ? `?rpage=${n}` : ""}#reviews`}
        />
      </section>

      {similar.length > 0 && (
        <section className="mt-14">
          <SectionHeader title="Похожие товары" href={`/catalog/${p.category.slug}`} hrefLabel="Вся категория" />
          <ProductCarousel label="Похожие товары">
            {similar.map((s) => (
              <ProductCard key={s.id} p={s} />
            ))}
          </ProductCarousel>
        </section>
      )}
    </div>
  );
}
