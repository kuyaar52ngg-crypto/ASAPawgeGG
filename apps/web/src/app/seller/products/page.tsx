import Link from "next/link";
import { Boxes, Package, Pencil, PlusCircle, Search } from "lucide-react";
import { prisma, type Prisma } from "@asap/db";
import { PRODUCT_STATUSES, PRODUCT_STATUS_LABELS, PRODUCT_TYPE_LABELS, formatRub, type ProductTypeName } from "@asap/shared";
import { requireSellerPage } from "@/server/cabinet/seller-context";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { ProductStatusBadge } from "@/components/cabinet/labels";
import { FilterPills, Pager } from "@/components/cabinet/pager";
import { ProductRowActions } from "@/components/cabinet/seller-forms";
import { Thumb } from "@/components/cabinet/thumb";

export const metadata = { title: "Мои товары" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;

export default async function SellerProductsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  const ctx = await requireSellerPage();
  const sp = await searchParams;
  const status = (PRODUCT_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof PRODUCT_STATUSES)[number]) : null;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const where: Prisma.ProductWhereInput = { sellerId: ctx.user.id, ...(status ? { status } : {}), ...(q ? { title: { contains: q, mode: "insensitive" } } : {}) };

  const [total, products, counts] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, title: true, slug: true, status: true, type: true, deliveryMode: true, price: true, coverImage: true, salesCount: true, moderationNote: true, category: { select: { name: true } }, _count: { select: { variants: { where: { isActive: true } } } } },
    }),
    prisma.product.groupBy({ by: ["status"], where: { sellerId: ctx.user.id }, _count: { _all: true } }),
  ]);
  const stockRows = products.length
    ? await prisma.stockItem.groupBy({ by: ["productId"], where: { productId: { in: products.map((p) => p.id) }, status: "AVAILABLE" }, _count: { _all: true } })
    : [];
  const stock = new Map(stockRows.map((r) => [r.productId, r._count._all]));
  const countOf = new Map(counts.map((c) => [c.status, c._count._all]));
  const allCount = counts.reduce((a, c) => a + c._count._all, 0);
  const href = (s: string | null, p = 1) => `/seller/products?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(q ? { q } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <>
      <PageHeader title="Мои товары" description="Создавайте карточки, отправляйте на модерацию и управляйте складом." actions={<Button asChild><Link href="/seller/products/new"><PlusCircle /> Добавить товар</Link></Button>} />
      <FilterPills
        active={status ?? "all"}
        items={[{ key: "all", label: "Все", href: href(null), count: allCount }, ...PRODUCT_STATUSES.filter((s) => countOf.get(s)).map((s) => ({ key: s, label: PRODUCT_STATUS_LABELS[s], href: href(s), count: countOf.get(s) }))]}
      />
      <form action="/seller/products" className="mb-5 flex max-w-md gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        <Input name="q" defaultValue={q} placeholder="Поиск по названию" aria-label="Поиск по названию" />
        <Button type="submit" variant="outline" size="icon" aria-label="Найти"><Search /></Button>
      </form>

      {products.length === 0 ? (
        <EmptyState icon={<Package />} title={allCount === 0 ? "У вас ещё нет товаров" : "Ничего не найдено"} description={allCount === 0 ? "Создайте первую карточку — после модерации она появится в каталоге." : "Измените фильтр или поисковый запрос."} action={<Button asChild><Link href="/seller/products/new">Добавить товар</Link></Button>} />
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {products.map((p) => {
            const available = stock.get(p.id) ?? 0;
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
                <Thumb src={p.coverImage} title={p.title} />
                <div className="min-w-0 flex-1 basis-56">
                  <Link href={`/seller/products/${p.id}/edit`} className="line-clamp-1 font-semibold hover:text-primary">{p.title}</Link>
                  <p className="text-xs text-muted-foreground">{p.category.name} · {PRODUCT_TYPE_LABELS[p.type as ProductTypeName]}</p>
                  {p.status === "REJECTED" && p.moderationNote && <p className="mt-0.5 line-clamp-1 text-xs text-destructive">{p.moderationNote}</p>}
                </div>
                <div className="w-28 text-sm font-semibold">{p._count.variants > 0 && <span className="mr-1 text-xs font-normal text-muted-foreground">от</span>}{formatRub(p.price)}</div>
                <div className="w-24 text-xs text-muted-foreground">
                  {p.deliveryMode === "AUTO_STOCK" ? <span className={available === 0 ? "text-warning" : ""}>На складе: {available}</span> : "Ручная выдача"}
                  <br />Продано: {p.salesCount}
                </div>
                <ProductStatusBadge status={p.status} />
                <div className="flex items-center gap-1">
                  <Button asChild size="icon-sm" variant="ghost" title="Редактировать"><Link href={`/seller/products/${p.id}/edit`} aria-label="Редактировать"><Pencil /></Link></Button>
                  {p.deliveryMode === "AUTO_STOCK" && <Button asChild size="icon-sm" variant="ghost" title="Склад ключей"><Link href={`/seller/products/${p.id}/stock`} aria-label="Склад ключей"><Boxes /></Link></Button>}
                  <ProductRowActions productId={p.id} status={p.status} canDelete={p.salesCount === 0} />
                </div>
              </div>
            );
          })}
        </Card>
      )}
      <Pager page={page} pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))} hrefFor={(n) => href(status, n)} />
    </>
  );
}
