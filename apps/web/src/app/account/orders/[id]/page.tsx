import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FlaskConical, MessageSquareWarning } from "lucide-react";
import { prisma } from "@asap/db";
import { formatRub } from "@asap/shared";
import { requireUser } from "@/server/auth/session";
import { withinDisputeWindow } from "@/server/cabinet/time";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Rating } from "@/components/ui/rating";
import { ACTIVE_DISPUTE_STATUSES, DISPUTE_WINDOW_DAYS } from "@/components/cabinet/constants";
import { DisputeDialog } from "@/components/cabinet/dispute-dialog";
import { DisputeStatusBadge, ItemStatusBadge, OrderStatusBadge, formatDateTime } from "@/components/cabinet/labels";
import { OrderTimeline, buildTimeline } from "@/components/cabinet/order-timeline";
import { RevealSecrets } from "@/components/cabinet/reveal-secrets";
import { ReviewForm } from "@/components/cabinet/review-form";
import { Thumb } from "@/components/cabinet/thumb";

export const metadata = { title: "Заказ" };
export const dynamic = "force-dynamic";

const PROVIDER_LABELS: Record<string, string> = { BALANCE: "Баланс сайта", PLATEGA: "Platega", ROLLYPAY: "RollyPay", SANDBOX: "Тестовая оплата" };

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("/account/orders");
  const { id } = await params;
  // ownership is part of the query: another user's order id simply 404s
  const order = await prisma.order.findFirst({
    where: { id, buyerId: user.id },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          product: { select: { slug: true, coverImage: true, deliveryMode: true } },
          review: { select: { rating: true, text: true, reply: true, status: true, createdAt: true } },
          stockItems: { where: { status: "SOLD" }, select: { id: true } },
          disputes: { orderBy: { createdAt: "desc" }, select: { id: true, status: true } },
        },
      },
      payments: { where: { purpose: "ORDER" }, orderBy: { createdAt: "desc" }, select: { provider: true, status: true } },
      disputes: { select: { createdAt: true, status: true, resolvedAt: true } },
      promoCode: { select: { code: true } },
    },
  });
  if (!order) notFound();

  const sellers = await prisma.sellerProfile.findMany({ where: { userId: { in: [...new Set(order.items.map((i) => i.sellerId))] } }, select: { userId: true, shopName: true, slug: true } });
  const sellerOf = new Map(sellers.map((s) => [s.userId, s]));
  const steps = buildTimeline({ ...order });
  const paidBy = order.payments.find((p) => p.status === "PAID") ?? order.payments[0];

  return (
    <>
      <PageHeader
        title={`Заказ ${order.number}`}
        description={`Создан ${formatDateTime(order.createdAt)}`}
        actions={
          <div className="flex items-center gap-3">
            <OrderStatusBadge status={order.status} />
            <Button asChild variant="outline" size="sm"><Link href="/account/orders"><ArrowLeft /> К заказам</Link></Button>
          </div>
        }
      />

      {order.status === "PENDING" && (
        <Card className="gradient-border mb-6">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm">Заказ ещё не оплачен. Товар зарезервирован на 30 минут с момента создания.</p>
            <Button asChild><Link href={`/checkout/pay/${order.id}`}>Оплатить {formatRub(order.total)}</Link></Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {order.items.map((item) => {
            const meta = obj(item.meta);
            const dd = obj(item.deliveryData);
            const seller = sellerOf.get(item.sellerId);
            const activeDispute = item.disputes.find((d) => (ACTIVE_DISPUTE_STATUSES as readonly string[]).includes(d.status));
            const deliveredAt = item.deliveredAt ?? order.deliveredAt;
            const inWindow = withinDisputeWindow(deliveredAt);
            const canDispute = order.status === "DELIVERED" && item.status === "DELIVERED" && !activeDispute && inWindow;
            const message = typeof dd.message === "string" ? dd.message : null;
            const showSecrets = item.status === "DELIVERED" && item.stockItems.length > 0;
            return (
              <Card key={item.id}>
                <CardHeader className="flex-row items-start gap-4">
                  <Thumb src={item.product.coverImage} title={item.title} className="size-16" />
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base">
                      <Link href={`/product/${item.product.slug}`} className="hover:text-primary">{item.title}</Link>
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.variantTitle ? `${item.variantTitle} · ` : ""}{item.quantity} × {formatRub(item.unitPrice)} = <span className="font-semibold text-foreground">{formatRub(item.total)}</span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Продавец: {seller ? <Link href={`/seller-store/${seller.slug}`} className="hover:text-primary">{seller.shopName}</Link> : "—"}
                    </p>
                  </div>
                  <ItemStatusBadge status={item.status} />
                </CardHeader>
                <CardContent className="space-y-4">
                  {(typeof meta.steamLogin === "string" || typeof meta.buyerInput === "string") && (
                    <p className="text-sm text-muted-foreground">
                      Ваши данные для выдачи: <span className="font-medium text-foreground">{String(meta.steamLogin ?? meta.buyerInput)}</span>
                    </p>
                  )}

                  {showSecrets && <RevealSecrets orderItemId={item.id} count={item.stockItems.length} />}

                  {message && (
                    <div className="rounded-xl border border-border bg-foreground/[0.04] p-3.5">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Сообщение продавца</p>
                      <p className="text-sm break-words whitespace-pre-wrap select-all">{message}</p>
                    </div>
                  )}

                  {item.status === "DELIVERED" && typeof dd.steamLogin === "string" && (
                    <div className="rounded-xl border border-border bg-foreground/[0.04] p-3.5 text-sm">
                      <p className="flex items-center gap-2 font-medium">
                        Пополнение Steam выполнено {dd.sandbox === true && <Badge variant="warning"><FlaskConical className="size-3" /> тестовая выдача</Badge>}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        Логин: {dd.steamLogin}{typeof dd.amountRub === "number" ? ` · зачислено ${formatRub(Math.round(dd.amountRub * 100))}` : ""}{typeof dd.txId === "string" ? ` · операция ${dd.txId}` : ""}
                      </p>
                    </div>
                  )}

                  {item.status === "PROCESSING" && <p className="rounded-xl bg-accent/10 px-3.5 py-2.5 text-sm text-accent">Продавец выполняет заказ. Мы пришлём уведомление, как только данные будут готовы.</p>}
                  {item.status === "PENDING" && order.status !== "PENDING" && order.status !== "CANCELLED" && <p className="rounded-xl bg-accent/10 px-3.5 py-2.5 text-sm text-accent">Выдача начнётся в ближайшие секунды.</p>}
                  {item.status === "FAILED" && <p className="rounded-xl bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">Не удалось выдать этот товар. Поддержка свяжется с вами или вернёт деньги на баланс.</p>}
                  {item.status === "REFUNDED" && <p className="rounded-xl bg-secondary px-3.5 py-2.5 text-sm text-muted-foreground">Деньги за эту позицию возвращены на ваш баланс.</p>}

                  {/* review */}
                  {item.review ? (
                    <div className="rounded-xl border border-border p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-muted-foreground">Ваш отзыв · {formatDateTime(item.review.createdAt)}</p>
                        <Rating value={item.review.rating} />
                      </div>
                      {item.review.text && <p className="mt-1.5 text-sm whitespace-pre-wrap">{item.review.text}</p>}
                      {item.review.reply && <p className="mt-2 border-l-2 border-primary/50 pl-3 text-sm text-muted-foreground"><span className="font-medium text-foreground">Ответ продавца:</span> {item.review.reply}</p>}
                    </div>
                  ) : item.status === "DELIVERED" && ["DELIVERED", "DISPUTED"].includes(order.status) ? (
                    <ReviewForm orderItemId={item.id} />
                  ) : null}

                  {/* disputes */}
                  <div className="flex flex-wrap items-center gap-3">
                    {canDispute && <DisputeDialog orderItemId={item.id} itemTitle={item.title} />}
                    {item.disputes.map((d) => (
                      <Link key={d.id} href={`/account/disputes/${d.id}`} className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                        <MessageSquareWarning className="size-4" /> Спор <DisputeStatusBadge status={d.status} />
                      </Link>
                    ))}
                    {order.status === "DELIVERED" && item.status === "DELIVERED" && !activeDispute && !inWindow && <span className="text-xs text-muted-foreground">Срок открытия спора ({DISPUTE_WINDOW_DAYS} дней) истёк</span>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Статус заказа</CardTitle></CardHeader>
            <CardContent><OrderTimeline steps={steps} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Оплата</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Сумма товаров" value={formatRub(order.subtotal)} />
              {order.discount > 0 && <Row label={`Скидка${order.promoCode ? ` (${order.promoCode.code})` : ""}`} value={`−${formatRub(order.discount)}`} />}
              <Row label="Итого" value={<span className="font-display text-base font-bold">{formatRub(order.total)}</span>} />
              <Row label="Способ" value={paidBy ? PROVIDER_LABELS[paidBy.provider] ?? paidBy.provider : "—"} />
              {order.paidAt && <Row label="Оплачен" value={formatDateTime(order.paidAt)} />}
              <Row label="Email для выдачи" value={<span className="break-all">{order.email}</span>} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
