import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getDisputeView, listDisputeMessages } from "@/server/cabinet/disputes";
import { DisputeDetail } from "@/components/cabinet/dispute-views";

export const metadata = { title: "Спор" };
export const dynamic = "force-dynamic";

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("/account/disputes");
  const { id } = await params;
  const view = await getDisputeView(user, id);
  // this cabinet is for the buyer; sellers/admins use their own screens (admins may still open it read/write)
  if (!view || (view.viewerRole === "SELLER")) notFound();
  const data = await listDisputeMessages(user, id);
  if (!data) notFound();
  return <DisputeDetail view={view} messages={data.messages} viewerId={user.id} backHref="/account/disputes" orderHref={`/account/orders/${view.orderId}`} />;
}
