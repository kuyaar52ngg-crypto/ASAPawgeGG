import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { prisma, type Prisma } from "@asap/db";
import { formatRub } from "@asap/shared";
import { requireUser } from "@/server/auth/session";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LEDGER_KIND_LABELS, formatDateTime } from "@/components/cabinet/labels";
import { FilterPills, Pager } from "@/components/cabinet/pager";
import { cn } from "@/lib/utils";

export const metadata = { title: "Транзакции" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const FILTERS = [
  { key: "all", label: "Все", kinds: undefined },
  { key: "topup", label: "Пополнения", kinds: ["TOPUP"] },
  { key: "purchase", label: "Покупки", kinds: ["PURCHASE"] },
  { key: "refund", label: "Возвраты", kinds: ["REFUND", "ADJUSTMENT"] },
] as const;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ kind?: string; page?: string }> }) {
  const user = await requireUser("/account/transactions");
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.key === sp.kind) ?? FILTERS[0];
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const where: Prisma.LedgerEntryWhereInput = { account: "USER_BALANCE", ownerId: user.id, ...(filter.kinds ? { kind: { in: [...filter.kinds] } } : {}) };

  const [total, rows] = await Promise.all([
    prisma.ledgerEntry.count({ where }),
    prisma.ledgerEntry.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, kind: true, direction: true, amount: true, memo: true, createdAt: true, order: { select: { id: true, number: true } } },
    }),
  ]);
  const href = (kind: string, p = 1) => `/account/transactions?${new URLSearchParams({ ...(kind !== "all" ? { kind } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <>
      <PageHeader title="Транзакции" description={`Движение средств на балансе. Сейчас на балансе ${formatRub(user.balance)}.`} />
      <FilterPills active={filter.key} items={FILTERS.map((f) => ({ key: f.key, label: f.label, href: href(f.key) }))} />
      {rows.length === 0 ? (
        <EmptyState icon={<ReceiptText />} title="Операций пока нет" description="Пополнения, покупки и возвраты будут отображаться здесь." />
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {rows.map((r) => {
            const credit = r.direction === "CREDIT";
            return (
              <div key={r.id} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{LEDGER_KIND_LABELS[r.kind] ?? r.kind}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDateTime(r.createdAt)}
                    {r.order && <> · <Link href={`/account/orders/${r.order.id}`} className="hover:text-primary">заказ {r.order.number}</Link></>}
                    {r.memo && ` · ${r.memo}`}
                  </p>
                </div>
                <span className={cn("font-display text-base font-bold whitespace-nowrap", credit ? "text-success" : "text-foreground")}>
                  {credit ? "+" : "−"}{formatRub(r.amount)}
                </span>
              </div>
            );
          })}
        </Card>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Оплата заказа картой или СБП отображается как пополнение и сразу следующее за ним списание — деньги всегда проходят через баланс.</p>
      <Pager page={page} pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))} hrefFor={(p) => href(filter.key, p)} />
    </>
  );
}
