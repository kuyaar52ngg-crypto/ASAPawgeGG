import Link from "next/link";
import { Gavel } from "lucide-react";
import { prisma, type Prisma } from "@asap/db";
import { DISPUTE_STATUSES, formatRub } from "@asap/shared";
import { requireRole } from "@/server/auth/session";
import { ADMIN_PAGE_SIZE, pageParam, strParam } from "@/server/admin/action";
import { ACTIVE_DISPUTE, readAdvice } from "@/server/admin/disputes";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterPills, Pager, SearchForm, href } from "@/components/admin/common";
import { DISPUTE_LABELS, DisputeStatusBadge, fmtDateTime } from "@/components/admin/labels";

export const metadata = { title: "Админка · Споры и возвраты" };
export const dynamic = "force-dynamic";

const REC_LABEL = { refund: "AI: вернуть", reject: "AI: отклонить", ask_more_info: "AI: запросить данные" } as const;

export default async function AdminDisputesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const q = strParam(sp.q);
  const raw = strParam(sp.status);
  const status = raw === "all" || raw === "resolved" || (DISPUTE_STATUSES as readonly string[]).includes(raw) ? raw : "active";
  const page = pageParam(sp.page);

  const statusWhere: Prisma.DisputeWhereInput =
    status === "active" ? { status: { in: [...ACTIVE_DISPUTE] } } : status === "resolved" ? { status: { in: ["RESOLVED_REFUND", "RESOLVED_REJECTED", "CLOSED"] } } : status === "all" ? {} : { status: status as (typeof DISPUTE_STATUSES)[number] };
  const where: Prisma.DisputeWhereInput = {
    ...statusWhere,
    ...(q ? { OR: [{ order: { number: { contains: q, mode: "insensitive" } } }, { buyer: { email: { contains: q, mode: "insensitive" } } }, { reason: { contains: q, mode: "insensitive" } }, { id: q }] } : {}),
  };
  const [total, disputes, activeCount] = await Promise.all([
    prisma.dispute.count({ where }),
    prisma.dispute.findMany({
      where,
      orderBy: status === "active" ? { createdAt: "asc" } : { updatedAt: "desc" },
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      include: {
        order: { select: { number: true, total: true } },
        orderItem: { select: { title: true, total: true } },
        buyer: { select: { email: true } },
        seller: { select: { email: true, sellerProfile: { select: { shopName: true } } } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.dispute.count({ where: { status: { in: [...ACTIVE_DISPUTE] } } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const base = { q, status };

  return (
    <>
      <PageHeader title="Споры и возвраты" description="Претензии покупателей: переписка, совет AI, возврат или отказ" />
      <SearchForm action="/admin/disputes" q={q} placeholder="Номер заказа, email покупателя или текст" hidden={{ status }} />
      <FilterPills
        active={status}
        items={[
          { key: "active", label: "Требуют решения", href: href("/admin/disputes", { q }), count: activeCount },
          ...(["OPEN", "SELLER_REPLIED", "ESCALATED"] as const).map((s) => ({ key: s, label: DISPUTE_LABELS[s]!, href: href("/admin/disputes", { q, status: s }) })),
          { key: "resolved", label: "Решённые", href: href("/admin/disputes", { q, status: "resolved" }) },
          { key: "all", label: "Все", href: href("/admin/disputes", { q, status: "all" }) },
        ]}
      />
      {disputes.length === 0 ? (
        <EmptyState icon={<Gavel />} title="Споров нет" description="Когда покупатель откроет спор по заказу, он появится здесь." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Заказ</TableHead><TableHead>Претензия</TableHead><TableHead>Стороны</TableHead><TableHead>Статус</TableHead><TableHead className="text-right">Сумма</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {disputes.map((d) => {
              const advice = readAdvice(d.aiSuggestion);
              return (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link href={`/admin/disputes/${d.id}`} className="font-mono text-xs font-semibold hover:text-primary">{d.order.number}</Link>
                    <p className="text-xs text-muted-foreground">{fmtDateTime(d.createdAt)}</p>
                  </TableCell>
                  <TableCell className="max-w-72">
                    <p className="line-clamp-1 text-sm font-medium">{d.orderItem?.title ?? "Весь заказ"}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{d.reason}</p>
                  </TableCell>
                  <TableCell className="text-xs">
                    <p>Покупатель: {d.buyer.email}</p>
                    <p className="text-muted-foreground">Продавец: {d.seller.sellerProfile?.shopName ?? d.seller.email}</p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1"><DisputeStatusBadge status={d.status} />{advice && <Badge variant="outline">{REC_LABEL[advice.recommendation]}</Badge>}<Badge variant="secondary">{d._count.messages} сообщ.</Badge></div>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatRub(d.orderItem?.total ?? d.order.total)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <Pager page={page} pageCount={pageCount} hrefFor={(n) => href("/admin/disputes", { ...base, page: n })} />
    </>
  );
}
