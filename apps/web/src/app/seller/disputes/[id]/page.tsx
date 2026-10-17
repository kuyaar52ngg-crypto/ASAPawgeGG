import { notFound } from "next/navigation";
import { requireSellerPage } from "@/server/cabinet/seller-context";
import { getDisputeView, listDisputeMessages } from "@/server/cabinet/disputes";
import { DisputeDetail } from "@/components/cabinet/dispute-views";

export const metadata = { title: "Спор" };
export const dynamic = "force-dynamic";

export default async function SellerDisputePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSellerPage();
  const { id } = await params;
  const view = await getDisputeView(ctx.user, id);
  // only the seller of this dispute (ADMIN has the admin zone)
  if (!view || view.viewerRole !== "SELLER") notFound();
  const data = await listDisputeMessages(ctx.user, id);
  if (!data) notFound();
  return <DisputeDetail view={view} messages={data.messages} viewerId={ctx.user.id} backHref="/seller/disputes" />;
}
