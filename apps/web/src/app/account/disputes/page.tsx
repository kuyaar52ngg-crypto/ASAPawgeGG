import { prisma } from "@asap/db";
import { requireUser } from "@/server/auth/session";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { DisputeList } from "@/components/cabinet/dispute-views";

export const metadata = { title: "Споры" };
export const dynamic = "force-dynamic";

export default async function DisputesPage() {
  const user = await requireUser("/account/disputes");
  const rows = await prisma.dispute.findMany({
    where: { buyerId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true, reason: true, status: true, createdAt: true, updatedAt: true,
      order: { select: { number: true } },
      orderItem: { select: { title: true } },
      messages: { where: { authorRole: { in: ["SELLER", "ADMIN"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { body: true } },
    },
  });
  return (
    <>
      <PageHeader title="Споры" description="Если товар не подошёл или не пришёл — откройте спор на странице заказа. Продавец и администратор ответят в чате." />
      <DisputeList
        basePath="/account/disputes"
        emptyText="У вас нет споров. Спор можно открыть на странице выданного заказа в течение 14 дней."
        rows={rows.map((d) => ({ id: d.id, orderNumber: d.order.number, title: d.orderItem?.title ?? null, reason: d.reason, status: d.status, createdAt: d.createdAt, updatedAt: d.updatedAt, lastMessage: d.messages[0]?.body ?? null }))}
      />
    </>
  );
}
