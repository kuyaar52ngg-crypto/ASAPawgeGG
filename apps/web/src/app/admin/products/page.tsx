import Image from "next/image";
import Link from "next/link";
import { PackageSearch } from "lucide-react";
import { prisma, type Prisma } from "@asap/db";
import { PRODUCT_STATUSES, PRODUCT_STATUS_LABELS, formatRub } from "@asap/shared";
import { requireRole } from "@/server/auth/session";
import { ADMIN_PAGE_SIZE, pageParam, strParam } from "@/server/admin/action";
import { getAutoPublishThreshold, readAiModeration } from "@/server/admin/products";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterPills, Pager, SearchForm, href } from "@/components/admin/common";
import { AiVerdictBadge, ProductStatusBadge, fmtDate } from "@/components/admin/labels";
import { ProductModerationActions } from "@/components/admin/product-actions";

export const metadata = { title: "Админка · Модерация товаров" };
export const dynamic = "force-dynamic";

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const q = strParam(sp.q);
  const rawStatus = strParam(sp.status);
  const status = rawStatus === "all" ? "all" : (PRODUCT_STATUSES as readonly string[]).includes(rawStatus) ? rawStatus : "PENDING_REVIEW";
  const sellerId = strParam(sp.sellerId, 40);
  const page = pageParam(sp.page);

  const where: Prisma.ProductWhereInput = {
    ...(status !== "all" ? { status: status as (typeof PRODUCT_STATUSES)[number] } : {}),
    ...(sellerId ? { sellerId } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }, { id: q }] } : {}),
  };
  const [total, products, counts, threshold] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: status === "PENDING_REVIEW" ? { createdAt: "asc" } : { updatedAt: "desc" },
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: {
        id: true, title: true, slug: true, status: true, price: true, coverImage: true, createdAt: true, aiModeration: true, moderationNote: true,
        category: { select: { name: true } },
        seller: { select: { name: true, email: true, sellerProfile: { select: { shopName: true } } } },
      },
    }),
    prisma.product.groupBy({ by: ["status"], _count: true }),
    getAutoPublishThreshold(),
  ]);
  const countOf = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const base = { q, status, sellerId };

  return (
    <>
      <PageHeader title="Модерация товаров" description={`Автопубликация AI при оценке ≥ ${threshold} и вердикте «Одобрить»; остальное попадает в эту очередь`} />
      <SearchForm action="/admin/products" q={q} placeholder="Название, slug или ID" hidden={{ status, sellerId }} />
      <FilterPills
        active={status}
        items={[
          ...["PENDING_REVIEW", "ACTIVE", "REJECTED", "DRAFT", "ARCHIVED"].map((s) => ({ key: s, label: PRODUCT_STATUS_LABELS[s as keyof typeof PRODUCT_STATUS_LABELS], href: href("/admin/products", { q, sellerId, status: s }), count: countOf(s) })),
          { key: "all", label: "Все", href: href("/admin/products", { q, sellerId, status: "all" }) },
        ]}
      />
      {sellerId && <p className="mb-4 text-sm text-muted-foreground">Фильтр по продавцу. <Link className="text-primary underline" href={href("/admin/products", { q, status })}>Сбросить</Link></p>}

      {products.length === 0 ? (
        <EmptyState icon={<PackageSearch />} title={status === "PENDING_REVIEW" ? "Очередь модерации пуста" : "Товаров не найдено"} description={status === "PENDING_REVIEW" ? "Новые товары продавцов появятся здесь, если AI не опубликует их автоматически." : undefined} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Товар</TableHead><TableHead>Продавец</TableHead><TableHead className="text-right">Цена</TableHead><TableHead>Статус</TableHead><TableHead>AI-модерация</TableHead><TableHead className="text-right">Действия</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => {
              const ai = readAiModeration(p.aiModeration);
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex min-w-60 items-center gap-3">
                      {p.coverImage ? <Image src={p.coverImage} alt="" width={48} height={48} className="size-12 shrink-0 rounded-lg object-cover" unoptimized /> : <span className="size-12 shrink-0 rounded-lg bg-foreground/10" />}
                      <div className="min-w-0">
                        <Link href={`/admin/products/${p.id}`} className="line-clamp-2 font-medium hover:text-primary">{p.title}</Link>
                        <p className="text-xs text-muted-foreground">{p.category.name} · {fmtDate(p.createdAt)}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{p.seller.sellerProfile?.shopName ?? p.seller.name ?? p.seller.email}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatRub(p.price)}</TableCell>
                  <TableCell>
                    <ProductStatusBadge status={p.status} />
                    {p.status === "REJECTED" && p.moderationNote && <p className="mt-1 max-w-48 text-xs text-muted-foreground">{p.moderationNote}</p>}
                  </TableCell>
                  <TableCell className="max-w-56">
                    {ai ? (
                      <div className="grid gap-1">
                        <div className="flex items-center gap-2">
                          <AiVerdictBadge verdict={ai.verdict} />
                          <Badge variant="outline" className="tabular-nums">{ai.score}/100</Badge>
                        </div>
                        {ai.reasons.length > 0 && <p className="line-clamp-2 text-xs text-muted-foreground">{ai.reasons.join("; ")}</p>}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Не проверялся</span>
                    )}
                  </TableCell>
                  <TableCell><div className="flex justify-end"><ProductModerationActions productId={p.id} title={p.title} status={p.status} compact /></div></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <Pager page={page} pageCount={pageCount} hrefFor={(n) => href("/admin/products", { ...base, page: n })} />
    </>
  );
}
