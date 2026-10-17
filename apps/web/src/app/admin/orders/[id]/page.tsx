import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@asap/db";
import { LEDGER_KINDS, formatRub } from "@asap/shared";
import { requireRole } from "@/server/auth/session";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DetailList, JsonBlock } from "@/components/admin/common";
import { DisputeStatusBadge, ItemStatusBadge, OrderStatusBadge, PROVIDER_LABELS, PaymentStatusBadge, fmtDateTime } from "@/components/admin/labels";
import { CancelOrderButton, ManualDeliverButton, RefundButton, RetryFulfillmentButton } from "@/components/admin/order-actions";

export const metadata = { title: "Админка · Заказ" };
export const dynamic = "force-dynamic";

const SECRET_KEYS = new Set(["message", "key", "keys", "login", "password", "code", "payload", "secret"]);
/** Delivery data minus anything that may contain credentials/keys (admins see metadata, not the secret itself). */
function safeDelivery(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data ?? null;
  return Object.fromEntries(Object.entries(data as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.has(k) ? `[скрыто${typeof v === "string" ? `, ${v.length} симв.` : ""}]` : v]));
}

const LEDGER_LABEL: Record<string, string> = Object.fromEntries(LEDGER_KINDS.map((k) => [k, k]));

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN");
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      buyer: { select: { id: true, email: true, name: true } },
      promoCode: { select: { code: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: { product: { select: { deliveryMode: true, slug: true } }, _count: { select: { stockItems: true } } },
      },
      payments: { orderBy: { createdAt: "asc" } },
      disputes: { select: { id: true, status: true, reason: true, createdAt: true } },
      ledger: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) notFound();
  const sellers = await prisma.user.findMany({ where: { id: { in: [...new Set(order.items.map((i) => i.sellerId))] } }, select: { id: true, email: true, sellerProfile: { select: { shopName: true } } } });
  const sellerName = (sid: string) => {
    const u = sellers.find((s) => s.id === sid);
    return u?.sellerProfile?.shopName ?? u?.email ?? sid;
  };
  const audits = await prisma.auditLog.findMany({
    where: { OR: [{ entityType: "Order", entityId: id }, { entityType: "OrderItem", entityId: { in: order.items.map((i) => i.id) } }] },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { actor: { select: { email: true } } },
  });

  const refundable = ["PAID", "PROCESSING", "DELIVERED", "DISPUTED", "FAILED"].includes(order.status) && !!order.paidAt;
  const retryable = ["PAID", "PROCESSING", "FAILED"].includes(order.status);
  const deliverable = ["PAID", "PROCESSING", "FAILED"].includes(order.status);

  return (
    <>
      <PageHeader
        title={`Заказ ${order.number}`}
        description={`Создан ${fmtDateTime(order.createdAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={order.status} />
            {retryable && <RetryFulfillmentButton orderId={order.id} />}
            {order.status === "PENDING" && <CancelOrderButton orderId={order.id} number={order.number} />}
            {refundable && (
              <RefundButton orderId={order.id} number={order.number} totalLabel={formatRub(order.total)} items={order.items.map((i) => ({ id: i.id, title: i.title, totalLabel: formatRub(i.total), refunded: i.status === "REFUNDED" }))} />
            )}
          </div>
        }
      />
      <p className="-mt-3 mb-5 text-sm"><Link href="/admin/orders" className="text-muted-foreground hover:text-foreground">← К списку заказов</Link></p>

      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Сводка</CardTitle></CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: "Покупатель", value: <Link href={`/admin/users?q=${encodeURIComponent(order.buyer.email)}`} className="hover:text-primary">{order.buyer.email}</Link> },
                { label: "Email доставки", value: order.email },
                { label: "Сумма / скидка", value: `${formatRub(order.total)}${order.discount ? ` (скидка ${formatRub(order.discount)}${order.promoCode ? `, ${order.promoCode.code}` : ""})` : ""}` },
                { label: "Оплачен", value: fmtDateTime(order.paidAt) },
                { label: "Выдан", value: fmtDateTime(order.deliveredAt) },
                { label: "Fraud-скор", value: order.fraudScore === null ? "—" : <Badge variant={order.fraudScore >= 60 ? "destructive" : order.fraudScore >= 30 ? "warning" : "success"}>{order.fraudScore}/100</Badge> },
                { label: "IP", value: order.ip ?? "—" },
                { label: "User-Agent", value: <span className="text-xs">{order.userAgent ?? "—"}</span> },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Споры</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {order.disputes.length === 0 && <p className="text-muted-foreground">Споров нет</p>}
            {order.disputes.map((d) => (
              <Link key={d.id} href={`/admin/disputes/${d.id}`} className="rounded-xl bg-foreground/[0.04] p-3 hover:bg-foreground/[0.07]">
                <DisputeStatusBadge status={d.status} />
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{d.reason}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle>Позиции</CardTitle><CardDescription>Комиссия фиксируется при создании заказа</CardDescription></CardHeader>
        <CardContent className="grid gap-4">
          {order.items.map((i) => {
            const meta = (i.meta ?? {}) as Record<string, unknown>;
            return (
              <div key={i.id} className="grid gap-3 rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link href={`/product/${i.product.slug}`} className="font-medium hover:text-primary">{i.title}</Link>
                    {i.variantTitle && <span className="text-muted-foreground"> · {i.variantTitle}</span>}
                    <p className="text-xs text-muted-foreground">Продавец: {sellerName(i.sellerId)} · режим выдачи: {i.product.deliveryMode}</p>
                  </div>
                  <div className="flex items-center gap-2"><ItemStatusBadge status={i.status} />{deliverable && ["PENDING", "PROCESSING", "FAILED"].includes(i.status) && <ManualDeliverButton orderItemId={i.id} title={i.title} />}</div>
                </div>
                <DetailList
                  items={[
                    { label: "Кол-во × цена", value: `${i.quantity} × ${formatRub(i.unitPrice)} = ${formatRub(i.total)}` },
                    { label: `Комиссия (${i.commissionBps / 100}%)`, value: `${formatRub(i.commissionAmount)} · продавцу ${formatRub(i.sellerEarning)}` },
                    { label: "Выдан", value: fmtDateTime(i.deliveredAt) },
                    { label: "Холд до", value: i.holdReleased ? "освобождён" : fmtDateTime(i.holdReleaseAt) },
                    ...(meta.steamLogin ? [{ label: "Steam-логин", value: String(meta.steamLogin) }] : []),
                    ...(meta.buyerInput ? [{ label: "Данные покупателя", value: String(meta.buyerInput) }] : []),
                    ...(i._count.stockItems > 0 ? [{ label: "Ключей привязано", value: String(i._count.stockItems) }] : []),
                  ]}
                />
                {i.deliveryData ? <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Данные выдачи (без секретов)</summary><JsonBlock value={safeDelivery(i.deliveryData)} className="mt-2" /></details> : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Платежи</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Провайдер</TableHead><TableHead>Статус</TableHead><TableHead className="text-right">Сумма</TableHead></TableRow></TableHeader>
              <TableBody>
                {order.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell><span className="font-medium">{PROVIDER_LABELS[p.provider]}</span>{p.method && <span className="text-muted-foreground"> · {p.method}</span>}<p className="font-mono text-[11px] text-muted-foreground">{p.externalId ?? p.id}</p></TableCell>
                    <TableCell><PaymentStatusBadge status={p.status} /><p className="text-[11px] text-muted-foreground">{fmtDateTime(p.paidAt ?? p.createdAt)}</p></TableCell>
                    <TableCell className="text-right tabular-nums">{formatRub(p.amount)}</TableCell>
                  </TableRow>
                ))}
                {order.payments.length === 0 && <TableRow><TableCell colSpan={3} className="py-6 text-center text-muted-foreground">Платежей нет</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Проводки леджера</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Тип</TableHead><TableHead>Счёт</TableHead><TableHead className="text-right">Сумма</TableHead></TableRow></TableHeader>
              <TableBody>
                {order.ledger.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs">{LEDGER_LABEL[l.kind] ?? l.kind}<p className="text-[11px] text-muted-foreground">{fmtDateTime(l.createdAt)}</p></TableCell>
                    <TableCell className="text-xs">{l.direction === "DEBIT" ? "Дт" : "Кт"} {l.account}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{formatRub(l.amount)}</TableCell>
                  </TableRow>
                ))}
                {order.ledger.length === 0 && <TableRow><TableCell colSpan={3} className="py-6 text-center text-muted-foreground">Проводок нет</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>История действий</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {audits.length === 0 && <p className="text-muted-foreground">Административных действий не было</p>}
          {audits.map((a) => (
            <p key={a.id} className="flex flex-wrap gap-x-3 rounded-lg bg-foreground/[0.04] px-3 py-2"><span className="text-muted-foreground">{fmtDateTime(a.createdAt)}</span><code className="text-xs">{a.action}</code><span>{a.actor?.email ?? "система"}</span></p>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
