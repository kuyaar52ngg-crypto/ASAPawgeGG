import type { Metadata } from "next";
import { BadgePercent, Flame, Repeat, Sparkles } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { getSessionUser } from "@/server/auth/session";
import { getCategoryTiles, getHeroSlides, getHomeStats, getLatestReviews, getProductShelf } from "@/server/catalog/queries";
import { getSteamFeePercent } from "@/server/catalog/steam";
import { HeroCarousel } from "@/components/shop/hero-carousel";
import { CategoryTiles } from "@/components/shop/category-tiles";
import { SectionHeader } from "@/components/shop/section-header";
import { ProductCarousel } from "@/components/shop/product-carousel";
import { ProductCard } from "@/components/shop/product-card";
import { SteamPromo } from "@/components/shop/steam-promo";
import { HowItWorks } from "@/components/shop/how-it-works";
import { StatsCounters, type StatItem } from "@/components/shop/stats-counters";
import { ReviewsStrip } from "@/components/shop/reviews-strip";
import { plural } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "ASAPawge GG — ключи игр, подписки, пополнение Steam | Мгновенная выдача" },
  description: "Купить ключи игр, подписки Spotify, Netflix, ChatGPT Plus, Game Pass, PS Plus, пополнить Steam и купить подарочные карты. Автовыдача 24/7, гарантия возврата.",
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const user = await getSessionUser();
  const uid = user?.id ?? null;
  const [slides, tiles, bestsellers, discounts, fresh, subs, stats, reviews, feePercent] = await Promise.all([
    getHeroSlides(),
    getCategoryTiles(),
    getProductShelf("bestsellers", uid),
    getProductShelf("discounts", uid),
    getProductShelf("new", uid),
    getProductShelf("subscriptions", uid),
    getHomeStats(),
    getLatestReviews(8),
    getSteamFeePercent(),
  ]);

  const statItems: StatItem[] = [
    { value: stats.deliveredOrders, label: "Выдано заказов", hint: "автоматически и вручную" },
    { value: stats.activeProducts, label: "Товаров в каталоге", hint: `от ${stats.verifiedSellers} ${plural(stats.verifiedSellers, ["продавца", "продавцов", "продавцов"])}` },
    { value: stats.verifiedSellers, label: "Проверенных продавцов" },
    { value: stats.avgRating, label: "Средняя оценка", decimals: 1, suffix: " / 5", hint: `${stats.reviewsCount} ${plural(stats.reviewsCount, ["отзыв", "отзыва", "отзывов"])}` },
    ...(stats.medianDeliverySeconds != null
      ? [{ value: Math.max(1, Math.round(stats.medianDeliverySeconds / 60)), label: "Время выдачи", suffix: " мин", hint: "медиана по заказам" } satisfies StatItem]
      : []),
  ];

  const shelf = (items: typeof bestsellers, label: string) => (
    <ProductCarousel label={label}>
      {items.map((p, i) => (
        <ProductCard key={p.id} p={p} priority={i < 4} />
      ))}
    </ProductCarousel>
  );

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", name: "ASAPawge GG", url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000" },
      {
        "@type": "WebSite",
        name: "ASAPawge GG",
        url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        potentialAction: { "@type": "SearchAction", target: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/search?q={search_term_string}`, "query-input": "required name=search_term_string" },
      },
    ],
  };

  return (
    <div className="container-page space-y-12 py-6 sm:space-y-16 sm:py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <h1 className="sr-only">ASAPawge GG — маркетплейс игр, подписок и пополнения Steam</h1>

      {slides.length > 0 && <HeroCarousel slides={slides} />}

      <section>
        <SectionHeader title="Категории" href="/catalog" hrefLabel="Весь каталог" />
        <CategoryTiles tiles={tiles} />
      </section>

      {bestsellers.length > 0 && (
        <section>
          <SectionHeader title="Хиты продаж" subtitle="Самое популярное за всё время" href="/catalog?sort=popular" icon={<Flame />} />
          {shelf(bestsellers, "Хиты продаж")}
        </section>
      )}

      {discounts.length > 0 && (
        <section>
          <SectionHeader title="Скидки" subtitle="Лучшие предложения со скидкой" href="/catalog?discount=1&sort=discount" icon={<BadgePercent />} />
          {shelf(discounts, "Скидки")}
        </section>
      )}

      <section aria-label="Пополнение Steam">
        <SteamPromo feePercent={feePercent} />
      </section>

      {fresh.length > 0 && (
        <section>
          <SectionHeader title="Новинки" subtitle="Недавно добавленные товары" href="/catalog?sort=new" icon={<Sparkles />} />
          {shelf(fresh, "Новинки")}
        </section>
      )}

      {subs.length > 0 && (
        <section>
          <SectionHeader title="Подписки" subtitle="Spotify, Netflix, ChatGPT, Game Pass и другие" href="/catalog/podpiski" icon={<Repeat />} />
          {shelf(subs, "Подписки")}
        </section>
      )}

      <section>
        <SectionHeader title="Как это работает" subtitle="Четыре шага от выбора до активации" />
        <HowItWorks />
      </section>

      <section>
        <SectionHeader title="Нам доверяют" />
        <StatsCounters items={statItems} />
      </section>

      {reviews.length > 0 && (
        <section>
          <SectionHeader title="Последние отзывы" subtitle="Реальные оценки покупателей" />
          <ReviewsStrip reviews={reviews} />
        </section>
      )}

      <Reveal as="section" className="glass rounded-3xl p-5 sm:p-8">
        <h2 className="text-xl font-bold sm:text-2xl">Маркетплейс цифровых товаров ASAPawge GG</h2>
        <div className="mt-4 grid gap-6 text-sm leading-relaxed text-muted-foreground md:grid-cols-2">
          <div className="space-y-3">
            <p>
              ASAPawge GG — площадка, где можно быстро и безопасно купить ключи игр для Steam, Xbox, PlayStation и Nintendo, оформить подписки на музыку, видео и ИИ-сервисы, пополнить кошелёк Steam и приобрести подарочные карты и внутриигровую валюту.
            </p>
            <p>
              Большинство товаров выдаётся автоматически сразу после оплаты: ключ или данные доступа появляются в личном кабинете. Если для выдачи нужны ваши данные (логин Steam, UID), продавец или поставщик выполнит заказ в кратчайшие сроки.
            </p>
          </div>
          <div className="space-y-3">
            <p>
              Продавцы проходят проверку, а деньги по сделке замораживаются до подтверждения выдачи. Если что-то пошло не так — откройте спор: поддержка и ИИ-ассистент помогут разобраться и вернут средства на баланс сайта.
            </p>
            <p>
              Оплата — банковской картой, через СБП или с баланса сайта. Мы отдельно отмечаем регион и платформу каждого товара, чтобы вы не ошиблись с активацией. Разработчикам и продавцам доступны REST API и MCP-сервер для автоматизации.
            </p>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
