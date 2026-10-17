import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { prisma, type Prisma } from "@asap/db";
import { formatRub } from "@asap/shared";
import { requireSellerPage } from "@/server/cabinet/seller-context";
import { maskName } from "@/server/catalog/queries";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ItemStatusBadge, OrderStatusBadge, formatDateTime } from "@/components/cabinet/labels";
import { FilterPills, Pager } from "@/components/cabinet/pager";
import { DeliverForm } from "@/components/cabinet/seller-forms";
import { Thumb } from "@/components/cabinet/thumb";

export const metadata = { title: "Заказы" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;

const PAID_ORDER: Prisma.OrderWhereInput = { status: { notIn: ["PENDING", "CANCELLED"] } };
const FILTERS: { key: string; label: string; where: Prisma.OrderItemWhereInput }[] = [
  { key: "manual", label: "Ждут выдачи", where: { status: { in: ["PENDING", "PROCESSING"] }, product: { deliveryMode: "MANUAL" }, order: { status: { in: ["PAID", "PROCESSING"] } } } },
  { key: "all", label: "Все", where: { order: PAID_ORDER } },
  { key: "delivered", label: "Выданные", where: { status: "DELIVERED", order: PAID_ORDER } },
  { key: "refunded", label: "Возвраты", where: { status: "REFUNDED" } },
];

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export default async function SellerOrdersPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  const ctx = await requireSellerPage();
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.key === sp.filter) ?? FILTERS[0]!;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const where: Prisma.OrderItemWhereInput = { sellerId: ctx.user.id, ...filter.where };

  const [total, items, waiting] = await Promise.all([
    prisma.orderItem.count({ where }),
    prisma.orderItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, title: true, variantTitle: true, quantity: true, total: true, sellerEarning: true, status: true, meta: true, deliveryData: true, createdAt: true, deliveredAt: true,
        product: { select: { coverImage: true, deliveryMode: true } },
        order: { select: { number: true, status: true, paidAt: true, buyer: { select: { name: true } } } },
      },
    }),
    prisma.orderItem.count({ where: { sellerId: ctx.user.id, ...FILTERS[0]!.where } }),
  ]);
  const href = (key: string, p = 1) => `/seller/orders?${new URLSearchParams({ filter: key, ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <>
      <PageHeader title="Заказы" description="Заказы на ваши товары. Товары с ручной выдачей ждут, пока вы отправите данные покупателю." />
      <FilterPills active={filter.key} items={FILTERS.map((f) => ({ key: f.key, label: f.label, href: href(f.key), count: f.key === "manual" ? waiting : undefined }))} />

      {items.length === 0 ? (
        <EmptyState icon={<ShoppingBag />} title={filter.key === "manual" ? "Нет заказов, ожидающих выдачи" : "Заказов не найдено"} description={filter.key === "manual" ? "Когда покупатель оплатит товар с ручной выдачей, он появится здесь." : "В этой категории пока пусто."} />
      ) : (
        <div className="space-y-3">
          {items.map((it) => {
            const meta = obj(it.meta);
            const dd = obj(it.deliveryData);
            const needsDelivery = it.product.deliveryMode === "MANUAL" && ["PENDING", "PROCESSING"].includes(it.status) && ["PAID", "PROCESSING"].includes(it.order.status);
            const buyerData = str(meta.buyerInput) ?? str(meta.steamLogin);
            const message = str(dd.message);
            return (
              <Card key={it.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                  <Thumb src={it.product.coverImage} title={it.title} />
                  <div className="min-w-0 flex-1 basis-60">
                    <p className="font-semibold">{it.title}{it.variantTitle ? ` · ${it.variantTitle}` : ""} <span className="font-normal text-muted-foreground">× {it.quantity}</span></p>
                    <p className="text-xs text-muted-foreground">Заказ {it.order.number} · {formatDateTime(it.order.paidAt ?? it.createdAt)} · {maskName(it.order.buyer.name)}</p>
                    {buyerData && <p className="mt-1.5 text-sm">Данные покупателя: <span className="rounded-md bg-foreground/[0.07] px-1.5 py-0.5 font-mono text-xs select-all">{buyerData}</span></p>}
                    {it.status === "DELIVERED" && message && <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">Выдано: {message}</p>}
                  </div>
                  <div className="text-right">
                    <p className="font-display font-bold">{formatRub(it.total)}</p>
                    <p className="text-xs text-muted-foreground">вам: {formatRub(it.sellerEarning)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <ItemStatusBadge status={it.status} />
                    {it.order.status === "DISPUTED" && <OrderStatusBadge status="DISPUTED" />}
                  </div>
                </div>
                {needsDelivery && ctx.canWrite && <div className="mt-3 flex flex-wrap"><DeliverForm orderItemId={it.id} /></div>}
                {it.order.status === "DISPUTED" && <Link href="/seller/disputes" className="mt-2 inline-block text-xs text-primary hover:underline">Есть спор по этому заказу</Link>}
              </Card>
            );
          })}
        </div>
      )}
      <Pager page={page} pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))} hrefFor={(p) => href(filter.key, p)} />
    </>
  );
}
