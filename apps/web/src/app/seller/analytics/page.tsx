import { formatRub } from "@asap/shared";
import { prisma } from "@asap/db";
import { requireSellerPage } from "@/server/cabinet/seller-context";
import { getSalesReport } from "@/server/cabinet/seller-stats";
import { daysAgo } from "@/server/cabinet/time";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterPills } from "@/components/cabinet/pager";
import { SalesChart } from "@/components/cabinet/sales-chart";
import { StatCard } from "@/components/cabinet/stat-card";

export const metadata = { title: "Статистика продаж" };
export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90] as const;

export default async function SellerAnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await requireSellerPage();
  const q = Number((await searchParams).days);
  const days = (RANGES as readonly number[]).includes(q) ? q : 30;
  const [report, statusRows] = await Promise.all([
    getSalesReport(ctx.user.id, days),
    prisma.orderItem.groupBy({ by: ["status"], where: { sellerId: ctx.user.id, createdAt: { gte: daysAgo(days) }, order: { status: { notIn: ["PENDING", "CANCELLED"] } } }, _count: { _all: true } }),
  ]);
  const statusLabels: Record<string, string> = { PENDING: "Ожидают выдачи", PROCESSING: "Выдаются", DELIVERED: "Выданы", FAILED: "Ошибка выдачи", REFUNDED: "Возвраты" };
  const aov = report.totals.orders > 0 ? Math.round(report.totals.revenue / report.totals.orders) : 0;

  return (
    <>
      <PageHeader title="Статистика" description="Оплаченные заказы без возвратов; время московское." />
      <FilterPills active={String(days)} items={RANGES.map((d) => ({ key: String(d), label: `${d} дней`, href: `/seller/analytics?days=${d}` }))} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Выручка" value={formatRub(report.totals.revenue)} hint={`К получению: ${formatRub(report.totals.earning)}`} />
        <StatCard label="Заказов" value={report.totals.orders} hint={`Единиц: ${report.totals.units}`} />
        <StatCard label="Средний чек" value={formatRub(aov)} />
        <StatCard label="Конверсия" value={report.conversion == null ? "—" : `${report.conversion}%`} hint={`Просмотров товаров: ${report.views}`} />
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle>Выручка по дням</CardTitle></CardHeader>
        <CardContent><SalesChart data={report.series.map((p) => ({ date: p.date, revenue: p.revenue, orders: p.orders }))} height={320} /></CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader><CardTitle className="text-base">Лучшие товары</CardTitle></CardHeader>
          <CardContent>
            {report.top.length === 0 ? (
              <p className="text-sm text-muted-foreground">За период продаж не было.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Товар</TableHead><TableHead className="text-right">Шт.</TableHead><TableHead className="text-right">Выручка</TableHead></TableRow></TableHeader>
                <TableBody>
                  {report.top.map((t) => (
                    <TableRow key={t.productId}><TableCell className="max-w-[320px] truncate">{t.title}</TableCell><TableCell className="text-right">{t.units}</TableCell><TableCell className="text-right font-semibold">{formatRub(t.revenue)}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Позиции заказов по статусам</CardTitle></CardHeader>
          <CardContent>
            {statusRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет данных.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {statusRows.map((s) => (
                  <li key={s.status} className="flex justify-between"><span className="text-muted-foreground">{statusLabels[s.status] ?? s.status}</span><span className="font-semibold">{s._count._all}</span></li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
