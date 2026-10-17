import Link from "next/link";
import { Boxes } from "lucide-react";
import { Prisma, prisma } from "@asap/db";
import { requireSellerPage } from "@/server/cabinet/seller-context";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProductStatusBadge } from "@/components/cabinet/labels";
import { Thumb } from "@/components/cabinet/thumb";

export const metadata = { title: "Склад ключей" };
export const dynamic = "force-dynamic";

export default async function SellerStockIndex() {
  const ctx = await requireSellerPage();
  const products = await prisma.product.findMany({
    where: { sellerId: ctx.user.id, deliveryMode: "AUTO_STOCK", status: { not: "ARCHIVED" } },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, title: true, status: true, coverImage: true },
  });
  const rows = products.length
    ? await prisma.$queryRaw<{ productId: string; status: string; n: number }[]>(Prisma.sql`SELECT "productId", status::text AS status, COUNT(*)::float8 AS n FROM "StockItem" WHERE "productId" IN (${Prisma.join(products.map((p) => p.id))}) GROUP BY 1, 2`)
    : [];
  const counts = new Map<string, Record<string, number>>();
  for (const r of rows) counts.set(r.productId, { ...(counts.get(r.productId) ?? {}), [r.status]: Number(r.n) });

  return (
    <>
      <PageHeader title="Склад ключей" description="Остатки по товарам с мгновенной выдачей. Выберите товар, чтобы загрузить или удалить ключи." />
      {products.length === 0 ? (
        <EmptyState icon={<Boxes />} title="Нет товаров с автовыдачей" description="Создайте товар со способом выдачи «Мгновенная выдача», затем загрузите ключи." action={<Button asChild><Link href="/seller/products/new">Добавить товар</Link></Button>} />
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {products.map((p) => {
            const c = counts.get(p.id) ?? {};
            const available = c.AVAILABLE ?? 0;
            return (
              <Link key={p.id} href={`/seller/products/${p.id}/stock`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-foreground/5 sm:px-5">
                <Thumb src={p.coverImage} title={p.title} />
                <span className="min-w-0 flex-1 basis-56 truncate font-semibold">{p.title}</span>
                <ProductStatusBadge status={p.status} />
                <span className={`w-28 text-sm ${available === 0 ? "text-warning" : ""}`}>В наличии: <b>{available}</b></span>
                <span className="w-40 text-xs text-muted-foreground">резерв {c.RESERVED ?? 0} · продано {c.SOLD ?? 0}</span>
              </Link>
            );
          })}
        </Card>
      )}
    </>
  );
}
