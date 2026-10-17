import { notFound } from "next/navigation";
import { prisma } from "@asap/db";
import { requireSellerPage } from "@/server/cabinet/seller-context";
import { getCategoryOptions } from "@/server/cabinet/categories";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { ProductForm, type ProductFormInitial } from "@/components/cabinet/product-form";

export const metadata = { title: "Редактирование товара" };
export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSellerPage();
  const { id } = await params;
  // ownership is part of the query
  const p = await prisma.product.findFirst({ where: { id, sellerId: ctx.user.id }, include: { variants: { orderBy: { sortOrder: "asc" } } } });
  if (!p) notFound();
  const categories = await getCategoryOptions();
  const attrs = (p.attributes && typeof p.attributes === "object" && !Array.isArray(p.attributes) ? p.attributes : {}) as { activation?: unknown };
  const ai = p.aiModeration && typeof p.aiModeration === "object" && !Array.isArray(p.aiModeration) ? (p.aiModeration as ProductFormInitial["aiModeration"]) : null;
  const initial: ProductFormInitial = {
    id: p.id,
    status: p.status,
    title: p.title,
    categoryId: p.categoryId,
    type: p.type,
    deliveryMode: p.deliveryMode,
    platform: p.platform,
    region: p.region,
    shortDescription: p.shortDescription ?? "",
    description: p.description,
    instructions: Array.isArray(attrs.activation) ? (attrs.activation as unknown[]).filter((x): x is string => typeof x === "string").join("\n") : "",
    images: p.images,
    tags: p.tags,
    price: p.price,
    oldPrice: p.oldPrice,
    variants: p.variants.map((v) => ({ id: v.id, title: v.title, price: v.price, oldPrice: v.oldPrice, isActive: v.isActive })),
    moderationNote: p.moderationNote,
    aiModeration: ai,
  };
  return (
    <>
      <PageHeader title="Редактирование товара" description={p.title} />
      <ProductForm key={p.updatedAt.toISOString()} categories={categories} initial={initial} verified={ctx.verified} />
    </>
  );
}
