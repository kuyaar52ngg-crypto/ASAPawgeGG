import { notFound, redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { prisma } from "@asap/db";
import { formatRub } from "@asap/shared";
import { Card, CardContent } from "@/components/ui/card";
import { SandboxPanel } from "@/components/commerce/sandbox-panel";
import { TestModeBadge } from "@/components/commerce/order-summary";
import { requireUser } from "@/server/auth/session";
import { isSandboxAllowed } from "@/server/payments/config";

export const metadata = { title: "Тестовая оплата", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Fake payment page of the SANDBOX provider. No money moves; the buttons send a signed webhook through the real pipeline. */
export default async function SandboxPaymentPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const user = await requireUser(`/checkout/sandbox/${paymentId}`);
  if (!isSandboxAllowed()) notFound();
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, userId: user.id, provider: "SANDBOX" },
    select: { id: true, status: true, amount: true, purpose: true, order: { select: { id: true, number: true } } },
  });
  if (!payment) notFound();
  const q = payment.order ? `order=${payment.order.id}` : `payment=${payment.id}`;
  if (payment.status === "PAID") redirect(`/checkout/success?${q}`);
  if (!["CREATED", "PENDING"].includes(payment.status)) redirect(`/checkout/fail?${q}`);

  return (
    <div className="container-page py-10 sm:py-16">
      <Card className="mx-auto max-w-lg border-warning/50">
        <CardContent className="space-y-6 p-6 pt-6 sm:p-8 sm:pt-8">
          <div className="flex items-center justify-between gap-3">
            <span className="flex size-12 items-center justify-center rounded-xl bg-warning/15 text-warning"><FlaskConical className="size-6" /></span>
            <TestModeBadge className="px-3 py-1 text-sm" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Тестовая оплата</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Это песочница платёжной системы: реальные деньги не списываются. Выберите исход платежа — запрос пройдёт через тот же обработчик вебхуков, что и боевые провайдеры (подпись, идемпотентность, проверка суммы).
            </p>
          </div>
          <dl className="space-y-2 rounded-xl bg-foreground/[0.04] p-4 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Назначение</dt><dd className="font-medium">{payment.order ? `Заказ ${payment.order.number}` : "Пополнение баланса"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Сумма</dt><dd className="font-display text-lg font-bold">{formatRub(payment.amount)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Платёж</dt><dd className="font-mono text-xs">{payment.id}</dd></div>
          </dl>
          <SandboxPanel paymentId={payment.id} />
        </CardContent>
      </Card>
    </div>
  );
}
