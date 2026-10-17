import Link from "next/link";
import { PackageSearch, X } from "lucide-react";
import { PLATFORMS, PRODUCT_TYPE_LABELS, REGIONS } from "@asap/shared";
import { formatRub } from "@asap/shared/money";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/utils";
import { listProducts, getFacets, type ResolvedCategory } from "@/server/catalog/queries";
import { buildCatalogQs, type CatalogPageQuery } from "@/server/catalog/query";
import { ProductCard } from "./product-card";
import { Pagination } from "./pagination";
import { CatalogFiltersSheet, CatalogSidebar, SortSelect } from "./catalog-filters";

export function countActiveFilters(q: CatalogPageQuery): number {
  return [q.platform, q.region, q.type, q.minPrice !== undefined || q.maxPrice !== undefined, q.inStock, q.discount].filter(Boolean).length;
}

interface Props {
  q: CatalogPageQuery;
  basePath: string;
  category?: ResolvedCategory | null;
  /** ranked ids from search; the listing is restricted to them */
  searchIds?: string[];
  userId?: string | null;
  heading: React.ReactNode;
  crumbs?: { href: string; label: string }[];
  emptyHint?: string;
}

/** Shared catalog layout for /catalog, /catalog/[category] and /search: sidebar filters, sort, grid, pagination. */
export async function CatalogView({ q, basePath, category, searchIds, userId, heading, crumbs, emptyHint }: Props) {
  const isSearch = searchIds !== undefined;
  const defaultSort = isSearch ? "relevance" : "popular";
  const [result, facets] = await Promise.all([
    listProducts(q, { categoryIds: category?.ids, ids: searchIds, userId }),
    getFacets(isSearch ? undefined : category?.ids, q.sellerId),
  ]);
  const clientQuery = { ...q };
  const active = countActiveFilters(q);
  const hrefFor = (page: number) => `${basePath}${buildCatalogQs(q, { page }, { defaultSort })}`;

  // removable filter chips
  const chips: { label: string; href: string }[] = [];
  const without = (key: string) => `${basePath}${buildCatalogQs(q, { page: undefined, [key]: undefined }, { defaultSort })}`;
  if (q.type) chips.push({ label: PRODUCT_TYPE_LABELS[q.type], href: without("type") });
  if (q.platform) chips.push({ label: PLATFORMS.find((p) => p.value === q.platform)?.label ?? q.platform, href: without("platform") });
  if (q.region) chips.push({ label: REGIONS.find((r) => r.value === q.region)?.label ?? q.region, href: without("region") });
  if (q.minPrice !== undefined) chips.push({ label: `от ${formatRub(q.minPrice)}`, href: without("minPrice") });
  if (q.maxPrice !== undefined) chips.push({ label: `до ${formatRub(q.maxPrice)}`, href: without("maxPrice") });
  if (q.inStock) chips.push({ label: "В наличии", href: without("inStock") });
  if (q.discount) chips.push({ label: "Со скидкой", href: without("discount") });

  const sidebarProps = {
    basePath,
    query: clientQuery,
    facets,
    subCategories: category?.node.children.map((c) => ({ slug: c.slug, name: c.name })),
    withRelevance: isSearch,
    activeCount: active,
  };

  return (
    <div className="container-page py-6 sm:py-8">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Хлебные крошки" className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {crumbs.map((c, i) => (
            <span key={c.href} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden>/</span>}
              {i < crumbs.length - 1 ? (
                <Link href={c.href} className="hover:text-foreground">
                  {c.label}
                </Link>
              ) : (
                <span aria-current="page" className="text-foreground">
                  {c.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="mb-5">{heading}</div>

      {category && category.node.children.length > 0 && (
        <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {category.node.children.map((c) => (
            <Link key={c.slug} href={`/catalog/${c.slug}`} className="glass shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition-colors hover:border-primary/50 hover:text-primary">
              {c.name}
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[17rem_1fr] xl:grid-cols-[18rem_1fr]">
        <CatalogSidebar {...sidebarProps} />

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Найдено: <span className="font-semibold text-foreground">{result.total}</span> {plural(result.total, ["товар", "товара", "товаров"])}
            </p>
            <div className="flex items-center gap-2">
              <CatalogFiltersSheet {...sidebarProps} />
              <SortSelect basePath={basePath} query={clientQuery} withRelevance={isSearch} />
            </div>
          </div>

          {chips.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {chips.map((c) => (
                <Link key={c.label} href={c.href} className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/25">
                  {c.label} <X className="size-3" />
                </Link>
              ))}
              <Link href={`${basePath}${buildCatalogQs({ q: q.q }, {}, { defaultSort })}`} className="text-xs font-semibold text-muted-foreground hover:text-foreground">
                Сбросить всё
              </Link>
            </div>
          )}

          {result.items.length === 0 ? (
            <EmptyState
              icon={<PackageSearch />}
              title="Ничего не найдено"
              description={emptyHint ?? "Попробуйте изменить или сбросить фильтры."}
              action={
                <Button asChild variant="outline">
                  <Link href={active > 0 ? `${basePath}${buildCatalogQs({ q: q.q }, {}, { defaultSort })}` : "/catalog"}>{active > 0 ? "Сбросить фильтры" : "Перейти в каталог"}</Link>
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
              {result.items.map((p, i) => (
                <ProductCard key={p.id} p={p} priority={i < 4} />
              ))}
            </div>
          )}

          <Pagination page={result.page} pageCount={result.pageCount} hrefFor={hrefFor} className="mt-8" />
        </div>
      </div>
    </div>
  );
}
