import Link from "next/link";
import { Package } from "lucide-react";
import { prisma, type Prisma } from "@asap/db";
import { formatRub } from "@asap/shared";
import { requireUser } from "@/server/auth/session";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { OrderStatusBadge, formatDateTime } from "@/components/cabinet/labels";
import { FilterPills, Pager } from "@/components/cabinet/pager";
import { Thumb } from "@/components/cabinet/thumb";

export const metadata = { title: "Заказы и ключи" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 15;
const FILTERS: { key: string; label: string; statuses?: Prisma.OrderWhereInput["status"] }[] = [
  { key: "all", label: "Все" },
  { key: "active", label: "В работе", statuses: { in: ["PENDING", "PAID", "PROCESSING"] } },
  { key: "delivered", label: "Выданные", statuses: "DELIVERED" },
  { key: "disputed", label: "Споры", statuses: "DISPUTED" },
  { key: "closed", label: "Возвраты и отмены", statuses: { in: ["REFUNDED", "CANCELLED", "FAILED"] } },
];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const user = await requireUser("/account/orders");
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.key === sp.status) ?? FILTERS[0]!;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const where: Prisma.OrderWhereInput = { buyerId: user.id, ...(filter.statuses ? { status: filter.statuses } : {}) };

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, number: true, status: true, total: true, createdAt: true,
        items: { orderBy: { createdAt: "asc" }, take: 3, select: { title: true, variantTitle: true, quantity: true, product: { select: { coverImage: true } } } },
        _count: { select: { items: true } },
      },
    }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (status: string, p = 1) => `/account/orders?${new URLSearchParams({ ...(status !== "all" ? { status } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <>
      <PageHeader title="Заказы и ключи" description="История покупок. Ключи и данные для активации — внутри заказа." />
      <FilterPills active={filter.key} items={FILTERS.map((f) => ({ key: f.key, label: f.label, href: href(f.key) }))} />

      {orders.length === 0 ? (
        <EmptyState icon={<Package />} title="Заказов не найдено" description={filter.key === "all" ? "Как только вы что-нибудь купите, заказ появится здесь." : "В этой категории заказов нет."} action={<Button asChild><Link href="/catalog">Перейти в каталог</Link></Button>} />
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Card key={o.id} className="glow-hover">
              <Link href={`/account/orders/${o.id}`} className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
                <div className="flex -space-x-3">
                  {o.items.map((it, i) => <Thumb key={i} src={it.product.coverImage} title={it.title} className="ring-2 ring-card" />)}
                </div>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="truncate font-semibold">{o.items[0]?.title}{o.items[0]?.variantTitle ? ` · ${o.items[0].variantTitle}` : ""}{o._count.items > 1 && <span className="font-normal text-muted-foreground"> и ещё {o._count.items - 1}</span>}</p>
                  <p className="text-xs text-muted-foreground">Заказ {o.number} · {formatDateTime(o.createdAt)}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-display font-bold">{formatRub(o.total)}</span>
                  <OrderStatusBadge status={o.status} />
                </div>
              </Link>
              {o.status === "PENDING" && (
                <div className="flex justify-end border-t border-border px-4 py-2.5 sm:px-5">
                  <Button asChild size="sm"><Link href={`/checkout/pay/${o.id}`}>Оплатить</Link></Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <Pager page={page} pageCount={pageCount} hrefFor={(p) => href(filter.key, p)} />
    </>
  );
}
