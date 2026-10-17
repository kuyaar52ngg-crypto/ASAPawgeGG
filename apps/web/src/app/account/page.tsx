import Link from "next/link";
import { ArrowRight, MessageSquareWarning, Package, ShoppingBag, Store, Wallet } from "lucide-react";
import { prisma } from "@asap/db";
import { formatRub } from "@asap/shared";
import { requireUser } from "@/server/auth/session";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { OrderStatusBadge, formatDateTime } from "@/components/cabinet/labels";
import { StatCard } from "@/components/cabinet/stat-card";
import { Thumb } from "@/components/cabinet/thumb";

export const metadata = { title: "Личный кабинет" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser("/account");
  const [orderCount, activeCount, spent, openDisputes, recent, notifications, seller] = await Promise.all([
    prisma.order.count({ where: { buyerId: user.id } }),
    prisma.order.count({ where: { buyerId: user.id, status: { in: ["PENDING", "PAID", "PROCESSING"] } } }),
    prisma.order.aggregate({ where: { buyerId: user.id, status: { in: ["PAID", "PROCESSING", "DELIVERED", "DISPUTED"] } }, _sum: { total: true } }),
    prisma.dispute.count({ where: { buyerId: user.id, status: { in: ["OPEN", "SELLER_REPLIED", "ESCALATED"] } } }),
    prisma.order.findMany({
      where: { buyerId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, number: true, status: true, total: true, createdAt: true, items: { take: 3, orderBy: { createdAt: "asc" }, select: { title: true, product: { select: { coverImage: true } } } }, _count: { select: { items: true } } },
    }),
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, title: true, body: true, link: true, readAt: true, createdAt: true } }),
    user.role === "USER" ? prisma.sellerProfile.findUnique({ where: { userId: user.id }, select: { status: true } }) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        title={`Привет, ${user.name ?? "друг"}!`}
        description={user.email}
        actions={<Button asChild><Link href="/catalog"><ShoppingBag /> В каталог</Link></Button>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Баланс" value={formatRub(user.balance)} icon={<Wallet />} hint={<Link href="/account/topup" className="text-primary hover:underline">Пополнить</Link>} />
        <StatCard label="Заказов" value={orderCount} icon={<Package />} hint={activeCount ? `${activeCount} в работе` : "Все выполнены"} />
        <StatCard label="Потрачено" value={formatRub(spent._sum.total ?? 0)} icon={<ShoppingBag />} hint="Оплаченные заказы" />
        <StatCard label="Открытых споров" value={openDisputes} icon={<MessageSquareWarning />} tone={openDisputes ? "warning" : "default"} hint={<Link href="/account/disputes" className="text-primary hover:underline">Перейти к спорам</Link>} />
      </div>

      {user.role === "USER" && seller?.status !== "VERIFIED" && (
        <Card className="gradient-border mb-6">
          <CardContent className="flex flex-wrap items-center gap-4 p-5 sm:p-6">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/12 text-primary"><Store className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="font-display font-semibold">{seller?.status === "PENDING" ? "Заявка продавца на рассмотрении" : "Хотите продавать на ASAPawge GG?"}</p>
              <p className="text-sm text-muted-foreground">{seller?.status === "PENDING" ? "Мы проверим заявку и сообщим о решении уведомлением." : "Загружайте ключи и подписки, получайте выплаты на карту или кошелёк."}</p>
            </div>
            <Button asChild variant="outline"><Link href="/account/become-seller">{seller?.status === "PENDING" ? "Статус заявки" : "Стать продавцом"} <ArrowRight /></Link></Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Последние заказы</CardTitle>
            <Button asChild variant="link" size="sm"><Link href="/account/orders">Все заказы</Link></Button>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <EmptyState icon={<Package />} title="Заказов пока нет" description="Выберите игру или подписку в каталоге — ключ придёт сюда сразу после оплаты." action={<Button asChild><Link href="/catalog">Открыть каталог</Link></Button>} className="border-0 py-8" />
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((o) => (
                  <li key={o.id}>
                    <Link href={`/account/orders/${o.id}`} className="flex items-center gap-3 py-3 transition-colors hover:text-primary">
                      <Thumb src={o.items[0]?.product.coverImage} title={o.items[0]?.title ?? "?"} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{o.items[0]?.title}{o._count.items > 1 && <span className="font-normal text-muted-foreground"> и ещё {o._count.items - 1}</span>}</p>
                        <p className="text-xs text-muted-foreground">{o.number} · {formatDateTime(o.createdAt)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{formatRub(o.total)}</p>
                        <OrderStatusBadge status={o.status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Уведомления</CardTitle></CardHeader>
          <CardContent>
            {notifications.length === 0 ? (
              <p className="text-sm text-muted-foreground">Пока тихо.</p>
            ) : (
              <ul className="space-y-3">
                {notifications.map((n) => {
                  const inner = (
                    <>
                      <p className="flex items-center gap-2 text-sm font-medium">{!n.readAt && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Новое" />}{n.title}</p>
                      {n.body && <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{formatDateTime(n.createdAt)}</p>
                    </>
                  );
                  return <li key={n.id}>{n.link ? <Link href={n.link} className="block hover:text-primary">{inner}</Link> : inner}</li>;
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
