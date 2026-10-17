import { redirect } from "next/navigation";
import { requireSellerPage } from "@/server/cabinet/seller-context";
import { getCategoryOptions } from "@/server/cabinet/categories";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { ProductForm } from "@/components/cabinet/product-form";

export const metadata = { title: "Новый товар" };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const ctx = await requireSellerPage();
  if (!ctx.canWrite) redirect("/seller/products");
  const categories = await getCategoryOptions();
  return (
    <>
      <PageHeader title="Новый товар" description="Заполните карточку и отправьте на модерацию — или сохраните черновик." />
      <ProductForm categories={categories} verified={ctx.verified} />
    </>
  );
}
