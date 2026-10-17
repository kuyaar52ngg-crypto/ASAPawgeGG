import Link from "next/link";
import { redirect } from "next/navigation";
import { XCircle } from "lucide-react";
import { prisma } from "@asap/db";
import { formatRub } from "@asap/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/server/auth/session";

export const metadata = { title: "Оплата не прошла" };
export const dynamic = "force-dynamic";

export default async function CheckoutFailPage({ searchParams }: { searchParams: Promise<{ order?: string; payment?: string }> }) {
  const user = await requireUser("/cart");
  const sp = await searchParams;

  let retryHref = "/cart";
  let retryLabel = "Вернуться в корзину";
  let subtitle = "Платёж был отклонён или отменён. Деньги не списаны.";

  if (sp.order) {
    const order = await prisma.order.findFirst({ where: { id: sp.order, buyerId: user.id }, select: { id: true, number: true, status: true, total: true } });
    if (!order) redirect("/cart");
    // a payment that actually went through must never look like a failure
    if (!["PENDING", "CANCELLED", "FAILED"].includes(order.status)) redirect(`/checkout/success?order=${order.id}`);
    subtitle = `Заказ ${order.number} на ${formatRub(order.total)}: платёж не прошёл. Деньги не списаны.`;
    if (order.status === "PENDING") {
      retryHref = `/checkout/pay/${order.id}`;
      retryLabel = "Попробовать другой способ оплаты";
      subtitle += " Товары зарезервированы на 30 минут.";
    }
  } else if (sp.payment) {
    const payment = await prisma.payment.findFirst({ where: { id: sp.payment, userId: user.id, purpose: "BALANCE_TOPUP" }, select: { id: true, status: true, amount: true } });
    if (!payment) redirect("/account/balance");
    if (payment.status === "PAID") redirect(`/checkout/success?payment=${payment.id}`);
    subtitle = `Пополнение на ${formatRub(payment.amount)} не прошло. Деньги не списаны.`;
    retryHref = "/account/balance";
    retryLabel = "Попробовать снова";
  }

  return (
    <div className="container-page py-10 sm:py-16">
      <Card className="mx-auto max-w-xl">
        <CardContent className="flex flex-col items-center gap-5 p-6 pt-6 text-center sm:p-10 sm:pt-10">
          <span className="flex size-16 items-center justify-center rounded-2xl bg-destructive/15 text-destructive"><XCircle className="size-8" /></span>
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Оплата не прошла</h1>
            <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild><Link href={retryHref}>{retryLabel}</Link></Button>
            <Button asChild variant="outline"><Link href="/info/contacts">Написать в поддержку</Link></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
