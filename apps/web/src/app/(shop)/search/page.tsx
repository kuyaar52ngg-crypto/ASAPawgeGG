import type { Metadata } from "next";
import { Search } from "lucide-react";
import { getSessionUser } from "@/server/auth/session";
import { parseCatalogParams, type RawSearchParams } from "@/server/catalog/query";
import { normalizeQuery, searchProductIds } from "@/server/catalog/search";
import { trackEvent } from "@/server/analytics/track";
import { cookies } from "next/headers";
import { CatalogView } from "@/components/shop/catalog-view";
import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = parseCatalogParams(await searchParams);
  return { title: q.q ? `Поиск: ${q.q}` : "Поиск", robots: { index: false, follow: true } };
}

export default async function SearchPage({ searchParams }: Props) {
  const q = parseCatalogParams(await searchParams, { sort: "relevance" });
  const term = normalizeQuery(q.q ?? "");
  const user = await getSessionUser();

  if (!term) {
    return (
      <div className="container-page py-10">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">Поиск</h1>
        <EmptyState icon={<Search />} title="Введите запрос" description="Название игры, сервиса или товара — например, «Spotify», «GTA» или «Steam»." action={<Button asChild><Link href="/catalog">Открыть каталог</Link></Button>} />
      </div>
    );
  }

  const ids = await searchProductIds(term);
  // analytics (first page only, to avoid inflating counts on pagination)
  if (q.page === 1) {
    const sid = (await cookies()).get("asap_sid")?.value ?? null;
    void trackEvent({ name: "search", userId: user?.id ?? null, sessionId: sid, path: "/search", properties: { q: term, results: ids.length } });
  }

  return (
    <CatalogView
      q={{ ...q, q: term }}
      basePath="/search"
      searchIds={ids}
      userId={user?.id}
      crumbs={[{ href: "/", label: "Главная" }, { href: "/search", label: "Поиск" }]}
      emptyHint={`По запросу «${term}» ничего не нашлось. Проверьте написание или попробуйте более короткое название.`}
      heading={
        <h1 className="text-2xl font-bold sm:text-3xl">
          Результаты по запросу <span className="gradient-brand-text">«{term}»</span>
        </h1>
      }
    />
  );
}
