import Link from "next/link";
import { AlertTriangle, ClipboardList, ShieldCheck, Store, Wallet } from "lucide-react";
import { prisma } from "@asap/db";
import { formatRub } from "@asap/shared";
import { requireRole } from "@/server/auth/session";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CategoryChart, LegendDots, PaymentDonut, RevenueChart, TrafficChart } from "@/components/admin/charts";
import { AiSummary, RefreshButton } from "@/components/admin/dashboard-actions";
import { SalesFunnel } from "@/components/admin/funnel";
import { KpiCard } from "@/components/admin/kpi-card";
import { FilterPills, StatTile } from "@/components/admin/common";
import { RetentionTable } from "@/components/admin/retention-table";
import { fmtDate } from "@/components/admin/labels";
import { getDashboardMetrics } from "@/server/analytics/metrics";
import { parsePeriod } from "@/server/analytics/range";
import { PERIOD_OPTIONS } from "@/server/analytics/types";

export const metadata = { title: "Админка · Метрики" };
export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const pf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const TREND_KEYS = { gmv: "gmv", revenue: "revenue", orders: "orders", newUsers: "newUsers" } as const;

async function attentionCounts() {
  const [moderation, disputes, payouts, sellers] = await Promise.all([
    prisma.product.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.dispute.count({ where: { status: { in: ["OPEN", "SELLER_REPLIED", "ESCALATED"] } } }),
    prisma.payout.count({ where: { status: { in: ["REQUESTED", "APPROVED"] } } }),
    prisma.sellerProfile.count({ where: { status: "PENDING" } }),
  ]);
  return { moderation, disputes, payouts, sellers };
}

export default async function AdminHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole("ADMIN");
  const sp = await searchParams;
  const days = parsePeriod(sp.days, 30);
  const [m, attention] = await Promise.all([getDashboardMetrics(days), attentionCounts()]);

  const generated = new Date(m.generatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  const eng = m.engagement;

  return (
    <>
      <PageHeader
        title="Метрики площадки"
        description={`${fmtDate(m.from)} — ${fmtDate(m.to)} (UTC) · сравнение с ${fmtDate(m.prevFrom)} — ${fmtDate(m.prevTo)} · данные от ${generated} МСК · ${user.email}`}
        actions={<RefreshButton />}
      />

      <FilterPills active={String(days)} items={PERIOD_OPTIONS.map((d) => ({ key: String(d), label: `${d} дней`, href: `/admin?days=${d}` }))} />

      {(attention.moderation > 0 || attention.disputes > 0 || attention.payouts > 0 || attention.sellers > 0) && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Attention href="/admin/products?status=PENDING_REVIEW" icon={<ShieldCheck />} label="Товаров на модерации" value={attention.moderation} />
          <Attention href="/admin/disputes" icon={<ClipboardList />} label="Открытых споров" value={attention.disputes} />
          <Attention href="/admin/payouts" icon={<Wallet />} label="Выплат к обработке" value={attention.payouts} />
          <Attention href="/admin/sellers?status=PENDING" icon={<Store />} label="Заявок продавцов" value={attention.sellers} />
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {m.kpis.map((k) => (
          <KpiCard key={k.key} kpi={k} days={days} trend={k.key in TREND_KEYS ? m.series.map((p) => p[TREND_KEYS[k.key as keyof typeof TREND_KEYS]]) : undefined} />
        ))}
      </div>

      <div className="mb-6">
        <AiSummary days={days} />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Выручка и заказы</CardTitle>
            <CardDescription>Оборот и чистая выручка (₽, левая ось), заказы в день (правая ось)</CardDescription>
            <LegendDots items={[{ label: "GMV", color: "var(--primary)" }, { label: "Чистая выручка", color: "var(--accent)" }, { label: "Заказы", color: "var(--warning)" }]} />
          </CardHeader>
          <CardContent><RevenueChart data={m.series} /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Способы оплаты</CardTitle>
            <CardDescription>Доля оплаченных заказов</CardDescription>
          </CardHeader>
          <CardContent><PaymentDonut data={m.payments} /></CardContent>
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Заказы по категориям</CardTitle>
            <CardDescription>Оплаченные заказы за период</CardDescription>
          </CardHeader>
          <CardContent><CategoryChart data={m.byCategory} /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Воронка продаж</CardTitle>
            <CardDescription>Уникальные посетители на каждом шаге (события AnalyticsEvent)</CardDescription>
          </CardHeader>
          <CardContent><SalesFunnel steps={m.funnel} /></CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Аудитория: DAU / MAU</CardTitle>
          <CardDescription>Посетители = авторизованные пользователи и анонимные сессии с любым событием</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="DAU (среднее за 7 дн.)" value={nf.format(eng.dauAvg7)} />
            <StatTile label="DAU (последний полный день)" value={nf.format(eng.dauLastDay)} />
            <StatTile label="MAU (30 дней)" value={nf.format(eng.mau)} />
            <StatTile label="Stickiness DAU/MAU" value={`${pf.format(eng.stickiness)}%`} hint={`Сессий за период: ${nf.format(eng.sessions)}`} />
          </div>
          <LegendDots items={[{ label: "DAU", color: "var(--success)" }, { label: "Сессии", color: "var(--accent)" }]} />
          <TrafficChart data={m.series} />
        </CardContent>
      </Card>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Топ товаров</CardTitle><CardDescription>По выручке за период</CardDescription></CardHeader>
          <CardContent>
            {m.topProducts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Нет продаж за период</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Товар</TableHead><TableHead className="text-right">Шт.</TableHead><TableHead className="text-right">Выручка</TableHead></TableRow></TableHeader>
                <TableBody>
                  {m.topProducts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="max-w-64">
                        <Link href={`/admin/products/${p.id}`} className="line-clamp-1 font-medium hover:text-primary">{p.title}</Link>
                        <span className="text-xs text-muted-foreground">{p.seller}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{nf.format(p.units)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatRub(p.revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Топ продавцов</CardTitle><CardDescription>По обороту за период</CardDescription></CardHeader>
          <CardContent>
            {m.topSellers.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Нет продаж за период</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Продавец</TableHead><TableHead className="text-right">Заказов</TableHead><TableHead className="text-right">Оборот</TableHead><TableHead className="text-right">Комиссия</TableHead></TableRow></TableHeader>
                <TableBody>
                  {m.topSellers.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.slug ? <Link href={`/seller-store/${s.slug}`} className="hover:text-primary">{s.shopName}</Link> : s.shopName}</TableCell>
                      <TableCell className="text-right tabular-nums">{nf.format(s.orders)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatRub(s.revenue)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{formatRub(s.fee)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Удержание (когорты по неделям)</CardTitle>
          <CardDescription>Доля зарегистрированных в неделю N пользователей, вернувшихся через 1, 2… недель (любое событие или заказ)</CardDescription>
        </CardHeader>
        <CardContent><RetentionTable rows={m.retention} /></CardContent>
      </Card>
      <p className="mt-4 text-xs text-muted-foreground">
        Метрики считаются SQL-агрегатами по Postgres и кэшируются на 5 минут; посещаемость за закрытые сутки ({m.snapshotDays} дн. из {m.series.length}) берётся из снапшотов DailyMetric.
        Подробный трафик — в разделе «<Link className="underline" href="/admin/analytics">Аналитика</Link>».
      </p>
    </>
  );
}

function Attention({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: number }) {
  return (
    <Link href={href} className="group">
      <Card className="flex items-center gap-4 p-4 transition-colors group-hover:border-primary/50">
        <span className={`flex size-11 items-center justify-center rounded-xl [&_svg]:size-5 ${value > 0 ? "bg-warning/15 text-warning" : "bg-foreground/10 text-muted-foreground"}`}>{value > 0 ? icon : <AlertTriangle />}</span>
        <div>
          <p className="font-display text-xl font-bold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </Card>
    </Link>
  );
}
