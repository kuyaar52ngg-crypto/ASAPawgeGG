import Link from "next/link";
import { prisma } from "@asap/db";
import { formatRub } from "@asap/shared";
import { requireUser } from "@/server/auth/session";
import { listPaymentMethods } from "@/server/payments/config";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/components/cabinet/labels";
import { TopupForm, type TopupMethod } from "@/components/cabinet/topup-form";

export const metadata = { title: "Пополнение баланса" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
  PAID: { label: "Зачислено", variant: "success" },
  CREATED: { label: "Не оплачено", variant: "warning" },
  PENDING: { label: "Ожидает оплаты", variant: "warning" },
  FAILED: { label: "Ошибка", variant: "destructive" },
  CANCELLED: { label: "Отменено", variant: "secondary" },
  EXPIRED: { label: "Истекло", variant: "secondary" },
  REFUNDED: { label: "Возврат", variant: "secondary" },
};

export default async function TopupPage() {
  const user = await requireUser("/account/topup");
  const [methods, recent] = await Promise.all([
    listPaymentMethods({ forTopup: true }),
    prisma.payment.findMany({ where: { userId: user.id, purpose: "BALANCE_TOPUP" }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, amount: true, status: true, provider: true, createdAt: true } }),
  ]);
  const options = methods.map((m) => ({ id: m.id, label: m.label, description: m.description, available: m.available, reason: m.reason, sandbox: m.sandbox })) as TopupMethod[];

  return (
    <>
      <PageHeader title="Пополнение баланса" description="Баланс списывается при оплате заказов — мгновенно и без комиссии." />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Пополнить</CardTitle>
            <CardDescription>Деньги поступят на баланс сразу после подтверждения платежа.</CardDescription>
          </CardHeader>
          <CardContent><TopupForm methods={options} /></CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="gradient-border">
            <CardContent className="p-5 sm:p-6">
              <p className="text-sm text-muted-foreground">Текущий баланс</p>
              <p className="mt-1 font-display text-3xl font-bold">{formatRub(user.balance)}</p>
              <Link href="/account/transactions" className="mt-2 inline-block text-sm text-primary hover:underline">История операций</Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Последние пополнения</CardTitle></CardHeader>
            <CardContent>
              {recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">Пополнений ещё не было.</p>
              ) : (
                <ul className="space-y-3">
                  {recent.map((p) => {
                    const st = STATUS[p.status] ?? { label: p.status, variant: "secondary" as const };
                    return (
                      <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
                        <div>
                          <p className="font-semibold">{formatRub(p.amount)}</p>
                          <p className="text-xs text-muted-foreground">{formatDateTime(p.createdAt)}</p>
                        </div>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
