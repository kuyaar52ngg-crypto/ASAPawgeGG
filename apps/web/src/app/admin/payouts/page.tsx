import { Wallet } from "lucide-react";
import { prisma, type Prisma } from "@asap/db";
import { PAYOUT_STATUSES, formatRub } from "@asap/shared";
import { requireRole } from "@/server/auth/session";
import { ADMIN_PAGE_SIZE, pageParam, strParam } from "@/server/admin/action";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterPills, Pager, StatTile, href } from "@/components/admin/common";
import { PAYOUT_LABELS, PAYOUT_METHOD_LABELS, PayoutStatusBadge, fmtDateTime } from "@/components/admin/labels";
import { PayoutActions } from "@/components/admin/payout-actions";

export const metadata = { title: "Админка · Выплаты" };
export const dynamic = "force-dynamic";

const DETAIL_LABELS: Record<string, string> = { card: "Карта", phone: "Телефон", bank: "Банк", address: "Адрес", network: "Сеть", wallet: "Кошелёк" };

export default async function AdminPayoutsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const raw = strParam(sp.status);
  const status = raw === "all" || (PAYOUT_STATUSES as readonly string[]).includes(raw) ? raw : "open";
  const page = pageParam(sp.page);
  const where: Prisma.PayoutWhereInput = status === "open" ? { status: { in: ["REQUESTED", "APPROVED"] } } : status === "all" ? {} : { status: status as (typeof PAYOUT_STATUSES)[number] };

  const [total, payouts, sums] = await Promise.all([
    prisma.payout.count({ where }),
    prisma.payout.findMany({
      where,
      orderBy: status === "open" ? { createdAt: "asc" } : { createdAt: "desc" },
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      include: { seller: { select: { email: true, sellerProfile: { select: { shopName: true, availableBalance: true } } } } },
    }),
    prisma.payout.groupBy({ by: ["status"], _sum: { amount: true }, _count: true }),
  ]);
  const sum = (s: string) => sums.find((x) => x.status === s)?._sum.amount ?? 0;
  const cnt = (s: string) => sums.find((x) => x.status === s)?._count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));

  return (
    <>
      <PageHeader title="Выплаты продавцам" description="Одобрите заявку, переведите деньги по реквизитам и отметьте выплату выплаченной" />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Ждут решения" value={formatRub(sum("REQUESTED"))} hint={`${cnt("REQUESTED")} заявок`} icon={<Wallet />} tone="warning" />
        <StatTile label="Одобрено, ждёт перевода" value={formatRub(sum("APPROVED"))} hint={`${cnt("APPROVED")} заявок`} icon={<Wallet />} />
        <StatTile label="Выплачено всего" value={formatRub(sum("PAID"))} hint={`${cnt("PAID")} выплат`} icon={<Wallet />} tone="success" />
      </div>
      <FilterPills
        active={status}
        items={[
          { key: "open", label: "К обработке", href: "/admin/payouts", count: cnt("REQUESTED") + cnt("APPROVED") },
          ...(["PAID", "REJECTED", "CANCELLED"] as const).map((s) => ({ key: s, label: PAYOUT_LABELS[s]!, href: href("/admin/payouts", { status: s }) })),
          { key: "all", label: "Все", href: href("/admin/payouts", { status: "all" }) },
        ]}
      />
      {payouts.length === 0 ? (
        <EmptyState icon={<Wallet />} title="Заявок нет" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Продавец</TableHead><TableHead>Способ и реквизиты</TableHead><TableHead className="text-right">Сумма</TableHead><TableHead>Статус</TableHead><TableHead className="text-right">Действия</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {payouts.map((p) => {
              const shop = p.seller.sellerProfile?.shopName ?? p.seller.email;
              const details = (p.details && typeof p.details === "object" ? p.details : {}) as Record<string, string>;
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <p className="font-medium">{shop}</p>
                    <p className="text-xs text-muted-foreground">{fmtDateTime(p.createdAt)}</p>
                  </TableCell>
                  <TableCell className="text-sm">
                    <p className="font-medium">{PAYOUT_METHOD_LABELS[p.method] ?? p.method}</p>
                    <p className="font-mono text-xs break-all text-muted-foreground">{Object.entries(details).map(([k, v]) => `${DETAIL_LABELS[k] ?? k}: ${v}`).join(" · ") || "—"}</p>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatRub(p.amount)}</TableCell>
                  <TableCell>
                    <PayoutStatusBadge status={p.status} />
                    {p.note && <p className="mt-1 max-w-48 text-xs text-muted-foreground">{p.note}</p>}
                    {p.processedAt && <p className="text-[11px] text-muted-foreground">{fmtDateTime(p.processedAt)}</p>}
                  </TableCell>
                  <TableCell><PayoutActions payoutId={p.id} status={p.status} amountLabel={formatRub(p.amount)} shop={shop} /></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <Pager page={page} pageCount={pageCount} hrefFor={(n) => href("/admin/payouts", { status, page: n })} />
    </>
  );
}
