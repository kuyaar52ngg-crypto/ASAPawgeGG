import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { prisma, type Prisma } from "@asap/db";
import { ORDER_STATUSES, ORDER_STATUS_LABELS, PAYMENT_PROVIDERS, formatRub } from "@asap/shared";
import { requireRole } from "@/server/auth/session";
import { ADMIN_PAGE_SIZE, pageParam, strParam } from "@/server/admin/action";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterPills, Pager, SearchForm, href } from "@/components/admin/common";
import { NativeSelect } from "@/components/admin/fields";
import { OrderStatusBadge, PROVIDER_LABELS, fmtDateTime } from "@/components/admin/labels";

export const metadata = { title: "Админка · Заказы" };
export const dynamic = "force-dynamic";

const dateOnly = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const q = strParam(sp.q);
  const status = (ORDER_STATUSES as readonly string[]).includes(strParam(sp.status)) ? strParam(sp.status) : "";
  const provider = (PAYMENT_PROVIDERS as readonly string[]).includes(strParam(sp.provider)) ? strParam(sp.provider) : "";
  const from = dateOnly(strParam(sp.from, 10));
  const to = dateOnly(strParam(sp.to, 10));
  const page = pageParam(sp.page);

  const where: Prisma.OrderWhereInput = {
    ...(status ? { status: status as (typeof ORDER_STATUSES)[number] } : {}),
    ...(provider ? { payments: { some: { provider: provider as (typeof PAYMENT_PROVIDERS)[number], status: "PAID" } } } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000) } : {}) } } : {}),
    ...(q
      ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { buyer: { email: { contains: q, mode: "insensitive" } } }, { id: q }] }
      : {}),
  };
  const [total, orders, counts] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: {
        id: true, number: true, status: true, total: true, createdAt: true, email: true, fraudScore: true,
        buyer: { select: { email: true } },
        items: { select: { title: true, quantity: true, status: true } },
        payments: { where: { status: "PAID" }, select: { provider: true }, take: 1 },
        _count: { select: { disputes: true } },
      },
    }),
    prisma.order.groupBy({ by: ["status"], _count: true }),
  ]);
  const countOf = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const base = { q, status, provider, from, to };

  return (
    <>
      <PageHeader title="Заказы" description={`Найдено: ${total}`} />
      <SearchForm action="/admin/orders" q={q} placeholder="Номер заказа, email или ID" hidden={{ status }}>
        <NativeSelect name="provider" defaultValue={provider} className="w-48" aria-label="Способ оплаты">
          <option value="">Любая оплата</option>
          {PAYMENT_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
        </NativeSelect>
        <Input type="date" name="from" defaultValue={from} className="w-40" aria-label="С даты" />
        <Input type="date" name="to" defaultValue={to} className="w-40" aria-label="По дату" />
      </SearchForm>
      <FilterPills
        active={status}
        items={[
          { key: "", label: "Все", href: href("/admin/orders", { q, provider, from, to }) },
          ...ORDER_STATUSES.map((s) => ({ key: s, label: ORDER_STATUS_LABELS[s], href: href("/admin/orders", { ...base, status: s, page: undefined }), count: countOf(s) })),
        ]}
      />
      {(from || to || provider) && <p className="mb-4 text-sm"><Link href={href("/admin/orders", { q, status })} className="text-primary underline">Сбросить фильтры даты и оплаты</Link></p>}

      {orders.length === 0 ? (
        <EmptyState icon={<ShoppingBag />} title="Заказов не найдено" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Заказ</TableHead><TableHead>Покупатель</TableHead><TableHead>Состав</TableHead><TableHead>Статус</TableHead><TableHead>Оплата</TableHead><TableHead className="text-right">Сумма</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <TableRow key={o.id}>
                <TableCell>
                  <Link href={`/admin/orders/${o.id}`} className="font-mono text-xs font-semibold hover:text-primary">{o.number}</Link>
                  <p className="text-xs text-muted-foreground">{fmtDateTime(o.createdAt)}</p>
                </TableCell>
                <TableCell className="text-sm">{o.buyer.email}</TableCell>
                <TableCell className="max-w-64 text-sm"><span className="line-clamp-2">{o.items.map((i) => `${i.title}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join(", ")}</span></TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <OrderStatusBadge status={o.status} />
                    {o._count.disputes > 0 && <Badge variant="warning">Спор</Badge>}
                    {(o.fraudScore ?? 0) >= 60 && <Badge variant="destructive">Риск {o.fraudScore}</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{o.payments[0] ? PROVIDER_LABELS[o.payments[0].provider] : "—"}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatRub(o.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Pager page={page} pageCount={pageCount} hrefFor={(n) => href("/admin/orders", { ...base, page: n })} />
    </>
  );
}
