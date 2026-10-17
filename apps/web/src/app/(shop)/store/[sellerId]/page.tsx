import { notFound, permanentRedirect } from "next/navigation";
import { getSellerBySlugOrUserId } from "@/server/catalog/queries";

export const dynamic = "force-dynamic";

/** /store/{sellerId} — short link by seller user id (or slug); canonical page is /seller-store/{slug}. */
export default async function StoreRedirect({ params }: { params: Promise<{ sellerId: string }> }) {
  const { sellerId } = await params;
  const seller = await getSellerBySlugOrUserId(sellerId);
  if (!seller) notFound();
  permanentRedirect(`/seller-store/${seller.slug}`);
}
