import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot } from "lucide-react";
import { prisma } from "@asap/db";
import { formatRub } from "@asap/shared";
import { requireRole } from "@/server/auth/session";
import { ACTIVE_DISPUTE, readAdvice } from "@/server/admin/disputes";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList } from "@/components/admin/common";
import { DisputeStatusBadge, ItemStatusBadge, OrderStatusBadge, fmtDateTime } from "@/components/admin/labels";
import { AiAdviceButton, DisputeChatForm, ResolveButtons } from "@/components/admin/dispute-actions";
import { cn } from "@/lib/utils";

export const metadata = { title: "Админка · Спор" };
export const dynamic = "force-dynamic";

const ROLE_NAME: Record<string, string> = { USER: "Покупатель", SELLER: "Продавец", ADMIN: "Администратор", AI: "AI-ассистент", SYSTEM: "Система" };
const REC: Record<string, { label: string; variant: "success" | "destructive" | "warning" }> = {
  refund: { label: "Вернуть деньги покупателю", variant: "success" },
  reject: { label: "Отклонить претензию", variant: "destructive" },
  ask_more_info: { label: "Запросить дополнительные данные", variant: "warning" },
};

export default async function AdminDisputePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN");
  const { id } = await params;
  const d = await prisma.dispute.findUnique({
    where: { id },
    include: {
      order: { select: { id: true, number: true, status: true, total: true, paidAt: true, deliveredAt: true } },
      orderItem: { select: { title: true, variantTitle: true, total: true, status: true, quantity: true } },
      buyer: { select: { email: true } },
      seller: { select: { email: true, sellerProfile: { select: { shopName: true } } } },
      messages: { orderBy: { createdAt: "asc" }, include: { author: { select: { email: true, name: true } } } },
    },
  });
  if (!d) notFound();
  const active = (ACTIVE_DISPUTE as readonly string[]).includes(d.status);
  const advice = readAdvice(d.aiSuggestion);
  const amount = d.orderItem?.total ?? d.order.total;

  return (
    <>
      <PageHeader title={`Спор по заказу ${d.order.number}`} description={`Открыт ${fmtDateTime(d.createdAt)}`} actions={<DisputeStatusBadge status={d.status} />} />
      <p className="-mt-3 mb-5 text-sm"><Link href="/admin/disputes" className="text-muted-foreground hover:text-foreground">← К списку споров</Link></p>

      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        <div className="grid content-start gap-6 xl:col-span-2">
          <Card>
            <CardHeader><CardTitle>Претензия</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <p className="rounded-xl bg-foreground/[0.05] p-3 text-sm leading-relaxed whitespace-pre-wrap break-words">{d.reason}</p>
              <DetailList
                items={[
                  { label: "Заказ", value: <span className="inline-flex items-center gap-2"><Link className="hover:text-primary" href={`/admin/orders/${d.order.id}`}>{d.order.number}</Link><OrderStatusBadge status={d.order.status} /></span> },
                  { label: "Позиция", value: d.orderItem ? <span className="inline-flex flex-wrap items-center gap-2">{d.orderItem.title}{d.orderItem.variantTitle ? ` · ${d.orderItem.variantTitle}` : ""}<ItemStatusBadge status={d.orderItem.status} /></span> : "Весь заказ" },
                  { label: "Покупатель", value: d.buyer.email },
                  { label: "Продавец", value: d.seller.sellerProfile?.shopName ?? d.seller.email },
                  { label: "Сумма спора", value: formatRub(amount) },
                  { label: "Заказ выдан", value: fmtDateTime(d.order.deliveredAt) },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Переписка</CardTitle><CardDescription>Покупатель, продавец и администратор</CardDescription></CardHeader>
            <CardContent className="grid gap-4">
              <ul className="grid gap-3">
                {d.messages.length === 0 && <li className="text-sm text-muted-foreground">Сообщений пока нет</li>}
                {d.messages.map((m) => (
                  <li key={m.id} className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-sm", m.authorRole === "ADMIN" ? "ml-auto bg-primary/15" : m.authorRole === "SELLER" ? "bg-accent/12" : m.authorRole === "USER" ? "bg-foreground/[0.07]" : "bg-warning/10")}>
                    <p className="mb-0.5 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">{ROLE_NAME[m.authorRole] ?? m.authorRole}<span className="font-normal">{fmtDateTime(m.createdAt)}</span></p>
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  </li>
                ))}
              </ul>
              {active ? <DisputeChatForm disputeId={d.id} /> : <p className="text-sm text-muted-foreground">Спор закрыт — переписка недоступна.</p>}
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card className="gradient-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Bot className="size-5 text-primary" /> Совет AI</CardTitle>
              <CardDescription>Рекомендация не обязательна — решение принимает администратор</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {advice ? (
                <>
                  <Badge variant={REC[advice.recommendation]!.variant} className="w-fit">{REC[advice.recommendation]!.label}</Badge>
                  <p className="text-sm leading-relaxed">{advice.summary}</p>
                  <p className="text-xs text-muted-foreground">Уверенность: {Math.round(advice.confidence * 100)}%{advice.provider && ` · ${advice.mock ? "правила (без LLM)" : `${advice.provider} · ${advice.model}`}`}{advice.generatedAt && ` · ${fmtDateTime(advice.generatedAt)}`}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Совет ещё не запрашивался.</p>
              )}
              {active && <div><AiAdviceButton disputeId={d.id} hasAdvice={!!advice} /></div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Решение</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {active ? (
                <ResolveButtons disputeId={d.id} amountLabel={formatRub(amount)} />
              ) : (
                <div className="grid gap-1 text-sm">
                  <DisputeStatusBadge status={d.status} />
                  <p className="mt-1">{d.resolution ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{fmtDateTime(d.resolvedAt)}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
