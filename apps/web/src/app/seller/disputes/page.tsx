import { prisma } from "@asap/db";
import { requireSellerPage } from "@/server/cabinet/seller-context";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { DisputeList } from "@/components/cabinet/dispute-views";

export const metadata = { title: "Споры" };
export const dynamic = "force-dynamic";

export default async function SellerDisputesPage() {
  const ctx = await requireSellerPage();
  const rows = await prisma.dispute.findMany({
    where: { sellerId: ctx.user.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true, reason: true, status: true, createdAt: true, updatedAt: true,
      order: { select: { number: true } },
      orderItem: { select: { title: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } },
    },
  });
  return (
    <>
      <PageHeader title="Споры" description="Обращения покупателей по вашим заказам. Отвечайте в чате — если договориться не получится, подключится администратор." />
      <DisputeList
        basePath="/seller/disputes"
        emptyText="Споров по вашим заказам нет — так держать!"
        rows={rows.map((d) => ({ id: d.id, orderNumber: d.order.number, title: d.orderItem?.title ?? null, reason: d.reason, status: d.status, createdAt: d.createdAt, updatedAt: d.updatedAt, lastMessage: d.messages[0]?.body ?? null }))}
      />
    </>
  );
}
