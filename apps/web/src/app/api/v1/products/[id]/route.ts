import { prisma } from "@asap/db";
import { jsonOk } from "@/lib/api";
import { ApiHttpError, apiRoute } from "@/server/api-keys";
import { CURRENCY } from "@/server/api-v1/dto";
import { baseUrl } from "@/server/api-v1/http";
import { getStockByVariant } from "@/server/catalog/queries";

export const dynamic = "force-dynamic";

/** GET /api/v1/products/{id|slug} — full product card with variants (buy via POST /orders). */
export const GET = apiRoute<{ id: string }>({ scope: "catalog:read" }, async ({ params }) => {
  const key = params.id.slice(0, 160);
  const p = await prisma.product.findFirst({
    where: { status: "ACTIVE", OR: [{ id: key }, { slug: key }] },
    include: {
      variants: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
      category: { select: { id: true, name: true, slug: true } },
      seller: { select: { name: true, sellerProfile: { select: { shopName: true, slug: true, rating: true } } } },
    },
  });
  if (!p) throw new ApiHttpError(404, "not_found", "Товар не найден");
  const stock = p.deliveryMode === "AUTO_STOCK" ? await getStockByVariant(p.id) : null;
  const inStock = (variantId: string | null) => (stock ? (stock.get(variantId ?? "") ?? 0) > 0 : true);
  const attrs = p.attributes && typeof p.attributes === "object" && !Array.isArray(p.attributes) ? (p.attributes as Record<string, unknown>) : {};
  return jsonOk({
    id: p.id,
    slug: p.slug,
    title: p.title,
    shortDescription: p.shortDescription,
    description: p.description,
    type: p.type,
    deliveryMode: p.deliveryMode,
    platform: p.platform,
    region: p.region,
    price: p.price,
    oldPrice: p.oldPrice,
    currency: CURRENCY,
    rating: p.ratingAvg,
    ratingCount: p.ratingCount,
    salesCount: p.salesCount,
    images: p.images,
    tags: p.tags,
    activation: Array.isArray(attrs.activation) ? attrs.activation : [],
    category: p.category,
    seller: { name: p.seller.sellerProfile?.shopName ?? p.seller.name, slug: p.seller.sellerProfile?.slug ?? null, rating: p.seller.sellerProfile?.rating ?? null },
    variants: p.variants.map((v) => ({ id: v.id, title: v.title, price: v.price, oldPrice: v.oldPrice, inStock: inStock(v.id) })),
    inStock: p.variants.length ? p.variants.some((v) => inStock(v.id)) : inStock(null),
    requiresInput: p.type === "TOPUP" ? (p.platform === "STEAM" ? "steamLogin" : "buyerInput") : p.deliveryMode === "MANUAL" ? "buyerInput" : null,
    url: `${baseUrl()}/product/${p.slug}`,
  });
});
