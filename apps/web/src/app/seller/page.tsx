import Link from "next/link";
import { AlertTriangle, Clock, MessageSquareWarning, Package, Percent, PlusCircle, ShoppingBag, Star, TrendingUp, Wallet } from "lucide-react";
import { formatRub } from "@asap/shared";
import { requireSellerPage } from "@/server/cabinet/seller-context";
import { getSalesReport, getSellerAttention } from "@/server/cabinet/seller-stats";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Rating } from "@/components/ui/rating";
import { formatDate } from "@/components/cabinet/labels";
import { SalesChart } from "@/components/cabinet/sales-chart";
import { StatCard } from "@/components/cabinet/stat-card";

export const metadata = { title: "Кабинет продавца" };
export const dynamic = "force-dynamic";

export default async function SellerHome() {
  const ctx = await requireSellerPage();
  const [report, attention] = await Promise.all([getSalesReport(ctx.user.id, 30), getSellerAttention(ctx.user.id)]);
  const { profile } = ctx;
  const todos = [
    attention.pendingManual > 0 && { href: "/seller/orders?filter=manual", icon: <Clock />, text: `Ждут ручной выдачи: ${attention.pendingManual}`, tone: "warning" },
    attention.openDisputes > 0 && { href: "/seller/disputes", icon: <MessageSquareWarning />, text: `Открытых споров: ${attention.openDisputes}`, tone: "warning" },
    attention.unansweredReviews > 0 && { href: "/seller/reviews?filter=unanswered", icon: <Star />, text: `Отзывов без ответа: ${attention.unansweredReviews}`, tone: "default" },
    attention.pendingReview > 0 && { href: "/seller/products?status=PENDING_REVIEW", icon: <Package />, text: `Товаров на модерации: ${attention.pendingReview}`, tone: "default" },
    attention.rejected > 0 && { href: "/seller/products?status=REJECTED", icon: <AlertTriangle />, text: `Отклонённых товаров: ${attention.rejected}`, tone: "warning" },
  ].filter(Boolean) as { href: string; icon: React.ReactNode; text: string; tone: string }[];

  return (
    <>
      <PageHeader
        title={profile.shopName}
        description="Продажи за последние 30 дней (время — московское)"
        actions={<Button asChild><Link href="/seller/products/new"><PlusCircle /> Добавить товар</Link></Button>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Выручка сегодня" value={formatRub(report.today.revenue)} icon={<TrendingUp />} hint={`К получению: ${formatRub(report.today.earning)} · заказов: ${report.today.orders}`} />
        <StatCard label="Выручка за 7 дней" value={formatRub(report.last7.revenue)} icon={<TrendingUp />} hint={`К получению: ${formatRub(report.last7.earning)} · заказов: ${report.last7.orders}`} />
        <StatCard label="Выручка за 30 дней" value={formatRub(report.totals.revenue)} icon={<TrendingUp />} hint={`К получению: ${formatRub(report.totals.earning)}`} />
        <StatCard label="Заказов за 30 дней" value={report.totals.orders} icon={<ShoppingBag />} hint={`Продано единиц: ${report.totals.units}`} />
        <StatCard label="Конверсия" value={report.conversion == null ? "—" : `${report.conversion}%`} icon={<Percent />} hint={report.views > 0 ? `${report.totals.orders} заказов / ${report.views} просмотров товаров` : "Просмотры товаров ещё не накоплены"} />
        <StatCard label="Рейтинг" value={<Rating value={profile.rating} count={profile.ratingCount} size={20} className="text-2xl" />} icon={<Star />} hint={`Продаж всего: ${profile.salesCount}`} />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card className="gradient-border p-5 sm:p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Доступно к выводу</p>
              <p className="mt-1 font-display text-3xl font-bold text-success">{formatRub(profile.availableBalance)}</p>
            </div>
            <Wallet className="size-6 text-success" />
          </div>
          <Button asChild size="sm" className="mt-4"><Link href="/seller/payouts">Запросить выплату</Link></Button>
        </Card>
        <Card className="p-5 sm:p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">На удержании (холд)</p>
              <p className="mt-1 font-display text-3xl font-bold text-warning">{formatRub(profile.holdBalance)}</p>
            </div>
            <Clock className="size-6 text-warning" />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Средства за выданные заказы становятся доступными после периода удержания.
            {attention.nextRelease && <> Ближайшая разморозка: {formatDate(attention.nextRelease)}</>}
          </p>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle>Выручка по дням</CardTitle></CardHeader>
        <CardContent><SalesChart data={report.series.map((p) => ({ date: p.date, revenue: p.revenue, orders: p.orders }))} /></CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Требует внимания</CardTitle></CardHeader>
          <CardContent>
            {todos.length === 0 && attention.lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">Всё в порядке — срочных задач нет.</p>
            ) : (
              <ul className="space-y-2">
                {todos.map((t) => (
                  <li key={t.href}><Link href={t.href} className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition-colors hover:bg-foreground/5 [&_svg]:size-4 ${t.tone === "warning" ? "border-warning/30" : "border-border"}`}>{t.icon}{t.text}</Link></li>
                ))}
                {attention.lowStock.map((p) => (
                  <li key={p.id}><Link href={`/seller/products/${p.id}/stock`} className="flex items-center gap-3 rounded-xl border border-warning/30 px-3.5 py-2.5 text-sm transition-colors hover:bg-foreground/5"><AlertTriangle className="size-4" /><span className="min-w-0 flex-1 truncate">{p.title}</span><span className="text-xs text-warning">{p.available === 0 ? "нет ключей" : `осталось ${p.available}`}</span></Link></li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Топ товаров за 30 дней</CardTitle></CardHeader>
          <CardContent>
            {report.top.length === 0 ? (
              <p className="text-sm text-muted-foreground">Продаж за период не было.</p>
            ) : (
              <ol className="space-y-2.5">
                {report.top.slice(0, 5).map((t, i) => (
                  <li key={t.productId} className="flex items-center gap-3 text-sm">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-bold text-primary">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className="text-xs text-muted-foreground">{t.units} шт.</span>
                    <span className="w-24 text-right font-semibold">{formatRub(t.revenue)}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
