import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSellerPage } from "@/server/cabinet/seller-context";
import { getStockOverview, listUnsold, loadOwnedProduct } from "@/server/cabinet/stock";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductStatusBadge } from "@/components/cabinet/labels";
import { Pager } from "@/components/cabinet/pager";
import { StatCard } from "@/components/cabinet/stat-card";
import { StockUploader, UnsoldTable } from "@/components/cabinet/stock-manager";

export const metadata = { title: "Склад ключей" };
export const dynamic = "force-dynamic";

export default async function ProductStockPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const ctx = await requireSellerPage();
  const { id } = await params;
  const page = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);
  const product = await loadOwnedProduct(ctx.user.id, id);
  if (!product) notFound();

  if (product.deliveryMode !== "AUTO_STOCK") {
    return (
      <>
        <PageHeader title="Склад ключей" description={product.title} actions={<Button asChild variant="outline" size="sm"><Link href="/seller/products"><ArrowLeft /> К товарам</Link></Button>} />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Этот товар выдаётся вручную, склад ключей не используется. Выдавайте заказы в разделе <Link href="/seller/orders" className="text-primary hover:underline">«Заказы»</Link>.</CardContent></Card>
      </>
    );
  }

  const [overview, unsold] = await Promise.all([getStockOverview(product.id, product.variants), listUnsold(product.id, product.variants, page)]);
  const pageCount = Math.max(1, Math.ceil(unsold.total / 50));

  return (
    <>
      <PageHeader
        title="Склад ключей"
        description={product.title}
        actions={
          <div className="flex items-center gap-3">
            <ProductStatusBadge status={product.status} />
            <Button asChild variant="outline" size="sm"><Link href={`/seller/products/${product.id}/edit`}>Карточка товара</Link></Button>
          </div>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="В наличии" value={overview.total.AVAILABLE} tone={overview.total.AVAILABLE === 0 ? "warning" : "success"} hint={overview.total.AVAILABLE === 0 ? "Товар недоступен для покупки" : undefined} />
        <StatCard label="В резерве" value={overview.total.RESERVED} hint="Ждут оплаты заказа" />
        <StatCard label="Продано" value={overview.total.SOLD} />
      </div>

      {overview.byVariant.length > 1 && (
        <Card className="mb-6 overflow-hidden">
          <div className="grid divide-y divide-border text-sm">
            {overview.byVariant.map((v) => (
              <div key={v.variantId ?? "none"} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="font-medium">{v.title}</span>
                <span className="text-xs text-muted-foreground">в наличии <b className="text-foreground">{v.AVAILABLE}</b> · резерв {v.RESERVED} · продано {v.SOLD}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Загрузить ключи</CardTitle><CardDescription>Ключи шифруются (AES-256-GCM) перед сохранением. Просмотреть их целиком после загрузки нельзя.</CardDescription></CardHeader>
          <CardContent>{ctx.canWrite ? <StockUploader productId={product.id} variants={product.variants} /> : <p className="text-sm text-muted-foreground">Загрузка недоступна для вашего профиля.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Нераспроданные ключи</CardTitle><CardDescription>Показаны в маскированном виде. Удалять можно только то, что ещё не продано.</CardDescription></CardHeader>
          <CardContent>
            <UnsoldTable productId={product.id} total={unsold.total} rows={unsold.rows.map((r) => ({ id: r.id, masked: r.masked, variantTitle: r.variantTitle, createdAt: r.createdAt.toISOString() }))} />
            <Pager page={page} pageCount={pageCount} hrefFor={(p) => `/seller/products/${product.id}/stock?page=${p}`} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
