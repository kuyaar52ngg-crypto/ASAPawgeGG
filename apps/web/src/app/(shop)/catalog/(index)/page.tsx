import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { parseCatalogParams, buildCatalogQs, type RawSearchParams } from "@/server/catalog/query";
import { resolveCategory } from "@/server/catalog/queries";
import { CatalogView, countActiveFilters } from "@/components/shop/catalog-view";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = parseCatalogParams(await searchParams);
  const filtered = countActiveFilters(q) > 0 || q.page > 1 || q.sort !== "popular";
  return {
    title: "Каталог игр, подписок и пополнения Steam",
    description: "Каталог цифровых товаров: ключи игр, подписки, подарочные карты, пополнение Steam. Фильтры по платформе, региону и цене, мгновенная выдача.",
    alternates: { canonical: "/catalog" },
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

export default async function CatalogPage({ searchParams }: Props) {
  const raw = await searchParams;
  const q = parseCatalogParams(raw);

  // Legacy / menu links: /catalog?category=slug -> /catalog/slug
  if (q.category) {
    const cat = await resolveCategory(q.category);
    if (cat) redirect(`/catalog/${cat.node.slug}${buildCatalogQs(q)}`);
  }

  const user = await getSessionUser();
  return (
    <CatalogView
      q={q}
      basePath="/catalog"
      userId={user?.id}
      crumbs={[{ href: "/", label: "Главная" }, { href: "/catalog", label: "Каталог" }]}
      heading={
        <>
          <h1 className="text-2xl font-bold sm:text-3xl">Каталог</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Игры, подписки, пополнение Steam, подарочные карты и внутриигровая валюта</p>
        </>
      }
    />
  );
}
