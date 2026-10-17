import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Clock, Hourglass, PackageCheck, Wallet } from "lucide-react";
import { prisma } from "@asap/db";
import { formatRub } from "@asap/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SecretList } from "@/components/commerce/secret-list";
import { StatusPoller } from "@/components/commerce/status-poller";
import { requireUser } from "@/server/auth/session";
import { getOrderDelivery } from "@/server/orders/delivery";

export const metadata = { title: "Заказ оформлен" };
export const dynamic = "force-dynamic";

export default async function CheckoutSuccessPage({ searchParams }: { searchParams: Promise<{ order?: string; payment?: string }> }) {
  const user = await requireUser("/account/orders");
  const sp = await searchParams;
  if (sp.payment) return <TopupResult paymentId={sp.payment} userId={user.id} />;
  if (!sp.order) redirect("/account/orders");
  return <OrderResult orderId={sp.order} userId={user.id} />;
}

async function OrderResult({ orderId, userId }: { orderId: string; userId: string }) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, buyerId: userId },
    select: { id: true, number: true, status: true, total: true, items: { select: { id: true, status: true, product: { select: { deliveryMode: true } } } } },
  });
  if (!order) redirect("/account/orders");
  if (order.status === "CANCELLED" || order.status === "FAILED") redirect(`/checkout/fail?order=${order.id}`);

  // The redirect from a gateway is NOT proof of payment — we only show what the DB says.
  if (order.status === "PENDING") {
    return (
      <Shell icon={<Hourglass className="size-8" />} tone="warning" title="Ожидаем подтверждение оплаты" subtitle={`Заказ ${order.number} · ${formatRub(order.total)}`}>
        <p className="text-sm text-muted-foreground">Как только платёжная система подтвердит оплату, мы сразу выдадим товар. Обычно это занимает до минуты.</p>
        <StatusPoller kind="order" id={order.id} message="Проверяем статус платежа…" />
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild variant="outline"><Link href={`/checkout/pay/${order.id}`}>Выбрать другой способ оплаты</Link></Button>
        </div>
      </Shell>
    );
  }

  const delivery = await getOrderDelivery(order.id, userId);
  const delivered = order.status === "DELIVERED" || order.status === "DISPUTED";
  const waitingAuto = (order.status === "PAID" || order.status === "PROCESSING") && order.items.some((i) => i.status !== "DELIVERED" && i.product.deliveryMode !== "MANUAL");
  const manualOnly = !delivered && order.items.every((i) => i.product.deliveryMode === "MANUAL");

  return (
    <Shell
      icon={delivered ? <PackageCheck className="size-8" /> : <CheckCircle2 className="size-8" />}
      tone="success"
      title={delivered ? "Заказ выдан!" : "Оплата прошла успешно"}
      subtitle={`Заказ ${order.number} · ${formatRub(order.total)}`}
    >
      {!delivered && (
        <p className="text-sm text-muted-foreground">
          {manualOnly ? "Продавец выполнит заказ вручную — мы пришлём уведомление, как только он будет готов." : "Выдаём товар — это займёт несколько секунд."}
        </p>
      )}
      {waitingAuto && <StatusPoller kind="order" id={order.id} message="Выдаём товар…" />}

      {delivery && delivery.some((d) => d.secrets.length > 0 || d.deliveryData) && (
        <div className="w-full space-y-4 text-left">
          {delivery.map((d) => (
            <div key={d.orderItemId} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{d.title}</h3>
                {d.variantTitle && <Badge variant="default">{d.variantTitle}</Badge>}
                <Badge variant={d.status === "DELIVERED" ? "success" : "warning"}>{d.status === "DELIVERED" ? "выдан" : "в работе"}</Badge>
              </div>
              {d.secrets.length > 0 && <SecretList secrets={d.secrets} />}
              {d.secrets.length === 0 && d.status === "DELIVERED" && typeof d.deliveryData?.message === "string" && <p className="text-sm text-muted-foreground">{d.deliveryData.message}</p>}
              {d.secrets.length === 0 && d.status === "DELIVERED" && d.deliveryData?.provider != null && (
                <p className="text-sm text-muted-foreground">
                  Пополнение выполнено{d.deliveryData.sandbox ? " (тестовый режим поставщика)" : ""}. ID операции: <code>{String(d.deliveryData.txId ?? "—")}</code>
                </p>
              )}
            </div>
          ))}
          {delivery.some((d) => d.secrets.length > 0) && <p className="text-xs text-muted-foreground">Ключи сохранены в личном кабинете: «Мои заказы».</p>}
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild><Link href={`/account/orders/${order.id}`}>Открыть заказ</Link></Button>
        <Button asChild variant="outline"><Link href="/catalog">Продолжить покупки</Link></Button>
      </div>
    </Shell>
  );
}

async function TopupResult({ paymentId, userId }: { paymentId: string; userId: string }) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, userId, purpose: "BALANCE_TOPUP" }, select: { id: true, status: true, amount: true } });
  if (!payment) redirect("/account/balance");
  if (["FAILED", "CANCELLED", "EXPIRED"].includes(payment.status)) redirect(`/checkout/fail?payment=${payment.id}`);
  const paid = payment.status === "PAID";
  return (
    <Shell
      icon={paid ? <Wallet className="size-8" /> : <Clock className="size-8" />}
      tone={paid ? "success" : "warning"}
      title={paid ? "Баланс пополнен" : "Ожидаем подтверждение платежа"}
      subtitle={formatRub(payment.amount)}
    >
      {!paid && <StatusPoller kind="topup" id={payment.id} message="Проверяем статус платежа…" />}
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild><Link href="/account/balance">К балансу</Link></Button>
        <Button asChild variant="outline"><Link href="/catalog">В каталог</Link></Button>
      </div>
    </Shell>
  );
}

function Shell({ icon, tone, title, subtitle, children }: { icon: React.ReactNode; tone: "success" | "warning"; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="container-page py-10 sm:py-16">
      <Card className="gradient-border mx-auto max-w-2xl">
        <CardContent className="flex flex-col items-center gap-5 p-6 pt-6 text-center sm:p-10 sm:pt-10">
          <span className={tone === "success" ? "flex size-16 items-center justify-center rounded-2xl bg-success/15 text-success" : "flex size-16 items-center justify-center rounded-2xl bg-warning/15 text-warning"}>{icon}</span>
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
