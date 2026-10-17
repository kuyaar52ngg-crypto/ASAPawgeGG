import Link from "next/link";
import { ArrowLeft, MessageSquareWarning } from "lucide-react";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { ChatMessage, DisputeView } from "@/server/cabinet/disputes";
import { DisputeChat } from "./dispute-chat";
import { DisputeStatusBadge, formatDateTime } from "./labels";

export interface DisputeListRow {
  id: string;
  orderNumber: string;
  title: string | null;
  reason: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  lastMessage: string | null;
}

/** List of disputes (buyer: basePath=/account/disputes, seller: /seller/disputes). */
export function DisputeList({ rows, basePath, emptyText }: { rows: DisputeListRow[]; basePath: string; emptyText: string }) {
  if (rows.length === 0) return <EmptyState icon={<MessageSquareWarning />} title="Споров нет" description={emptyText} />;
  return (
    <div className="space-y-3">
      {rows.map((d) => (
        <Card key={d.id} className="glow-hover">
          <Link href={`${basePath}/${d.id}`} className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
            <div className="min-w-0 flex-1 basis-64">
              <p className="truncate font-semibold">{d.title ?? `Заказ ${d.orderNumber}`}</p>
              <p className="text-xs text-muted-foreground">Заказ {d.orderNumber} · открыт {formatDateTime(d.createdAt)}</p>
              <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{d.lastMessage ?? d.reason}</p>
            </div>
            <div className="text-right">
              <DisputeStatusBadge status={d.status} />
              <p className="mt-1 text-[11px] text-muted-foreground">обновлён {formatDateTime(d.updatedAt)}</p>
            </div>
          </Link>
        </Card>
      ))}
    </div>
  );
}

/** Dispute detail: summary + live chat. */
export function DisputeDetail({ view, messages, viewerId, backHref, orderHref }: { view: DisputeView; messages: ChatMessage[]; viewerId: string; backHref: string; orderHref?: string }) {
  return (
    <>
      <PageHeader
        title={`Спор по заказу ${view.orderNumber}`}
        description={view.orderItemTitle ?? undefined}
        actions={<Button asChild variant="outline" size="sm"><Link href={backHref}><ArrowLeft /> К списку</Link></Button>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <DisputeChat disputeId={view.id} initialMessages={messages} initialStatus={view.status} viewerId={viewerId} viewerRole={view.viewerRole} />
        <aside className="space-y-4">
          <Card className="space-y-3 p-5 text-sm">
            <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Статус</span><DisputeStatusBadge status={view.status} /></div>
            <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Открыт</span><span>{formatDateTime(view.createdAt)}</span></div>
            <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Продавец</span><span className="text-right">{view.sellerName}</span></div>
            {orderHref && <Link href={orderHref} className="inline-block text-primary hover:underline">Перейти к заказу</Link>}
          </Card>
          <Card className="p-5 text-sm">
            <p className="mb-1.5 text-muted-foreground">Причина обращения</p>
            <p className="whitespace-pre-wrap">{view.reason}</p>
          </Card>
          {view.resolution && (
            <Card className="border-success/30 p-5 text-sm">
              <p className="mb-1.5 text-muted-foreground">Решение</p>
              <p className="whitespace-pre-wrap">{view.resolution}</p>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
