import { prisma } from "@asap/db";
import { MIN_PAYOUT_KOPECKS, formatRub } from "@asap/shared";
import { MAX_OPEN_PAYOUTS, maskPayoutDetails } from "@/server/cabinet/payouts";
import { requireSellerPage } from "@/server/cabinet/seller-context";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PAYOUT_METHOD_LABELS, PayoutStatusBadge, formatDateTime } from "@/components/cabinet/labels";
import { StatCard } from "@/components/cabinet/stat-card";
import { CancelPayoutButton, PayoutForm } from "@/components/cabinet/seller-forms";

export const metadata = { title: "Выплаты" };
export const dynamic = "force-dynamic";

export default async function SellerPayoutsPage() {
  const ctx = await requireSellerPage();
  const [payouts, open] = await Promise.all([
    prisma.payout.findMany({ where: { sellerId: ctx.user.id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, amount: true, status: true, method: true, details: true, note: true, createdAt: true, processedAt: true } }),
    prisma.payout.count({ where: { sellerId: ctx.user.id, status: { in: ["REQUESTED", "APPROVED"] } } }),
  ]);
  const { profile } = ctx;
  const saved = profile.payoutDetails && typeof profile.payoutDetails === "object" && !Array.isArray(profile.payoutDetails) ? (profile.payoutDetails as { method?: string; details?: Record<string, string> }) : null;
  const paidTotal = payouts.filter((p) => p.status === "PAID").reduce((a, p) => a + p.amount, 0);

  return (
    <>
      <PageHeader title="Выплаты" description="Выводите заработанные средства. Заявки обрабатывает администратор." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Доступно к выводу" value={formatRub(profile.availableBalance)} tone="success" />
        <StatCard label="На удержании" value={formatRub(profile.holdBalance)} tone="warning" hint="Станет доступно после периода холда" />
        <StatCard label="Выплачено всего" value={formatRub(paidTotal)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[400px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Запросить выплату</CardTitle>
            <CardDescription>Минимум {formatRub(MIN_PAYOUT_KOPECKS)}. Активных заявок: {open} из {MAX_OPEN_PAYOUTS}.</CardDescription>
          </CardHeader>
          <CardContent><PayoutForm available={profile.availableBalance} canRequest={ctx.verified && open < MAX_OPEN_PAYOUTS} saved={saved} /></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>История выплат</CardTitle></CardHeader>
          <CardContent>
            {payouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Заявок на выплату ещё не было.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Дата</TableHead><TableHead>Способ</TableHead><TableHead className="text-right">Сумма</TableHead><TableHead>Статус</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {payouts.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-nowrap text-xs">{formatDateTime(p.createdAt)}</TableCell>
                        <TableCell className="text-sm">{PAYOUT_METHOD_LABELS[p.method] ?? p.method}<span className="block text-xs text-muted-foreground">{maskPayoutDetails(p.method, p.details)}</span></TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap">{formatRub(p.amount)}</TableCell>
                        <TableCell><PayoutStatusBadge status={p.status} />{p.note && <span className="mt-1 block max-w-48 text-xs text-muted-foreground">{p.note}</span>}</TableCell>
                        <TableCell className="text-right">{p.status === "REQUESTED" && <CancelPayoutButton payoutId={p.id} />}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
