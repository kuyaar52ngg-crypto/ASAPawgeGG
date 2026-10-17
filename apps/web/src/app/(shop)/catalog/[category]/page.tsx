import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { parseCatalogParams, type RawSearchParams } from "@/server/catalog/query";
import { resolveCategory } from "@/server/catalog/queries";
import { CatalogView, countActiveFilters } from "@/components/shop/catalog-view";
import { CategoryIcon } from "@/components/ui/category-icon";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ category: string }>; searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { category } = await params;
  const cat = await resolveCategory(category);
  if (!cat) return { title: "Категория не найдена" };
  const q = parseCatalogParams(await searchParams);
  const filtered = countActiveFilters(q) > 0 || q.page > 1 || q.sort !== "popular";
  return {
    title: `${cat.node.name} — купить в каталоге`,
    description: cat.node.description ?? `${cat.node.name}: товары с мгновенной выдачей, гарантия возврата, цены от продавцов ASAPawge GG.`,
    alternates: { canonical: `/catalog/${cat.node.slug}` },
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { category: slug } = await params;
  const cat = await resolveCategory(slug);
  if (!cat) notFound();
  const q = parseCatalogParams(await searchParams, { category: cat.node.slug });
  const user = await getSessionUser();

  const crumbs = [
    { href: "/", label: "Главная" },
    { href: "/catalog", label: "Каталог" },
    ...(cat.parent ? [{ href: `/catalog/${cat.parent.slug}`, label: cat.parent.name }] : []),
    { href: `/catalog/${cat.node.slug}`, label: cat.node.name },
  ];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.label, item: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}${c.href}` })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <CatalogView
        q={q}
        basePath={`/catalog/${cat.node.slug}`}
        category={cat}
        userId={user?.id}
        crumbs={crumbs}
        heading={
          <div className="flex items-start gap-4">
            <span className="gradient-brand hidden size-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_8px_24px_-8px_var(--glow-violet)] sm:flex">
              <CategoryIcon name={cat.node.icon} className="size-7" />
            </span>
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">{cat.node.name}</h1>
              {cat.node.description && <p className="mt-1.5 text-sm text-muted-foreground">{cat.node.description}</p>}
            </div>
          </div>
        }
      />
    </>
  );
}
