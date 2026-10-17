import Link from "next/link";
import { Heart } from "lucide-react";
import { prisma } from "@asap/db";
import { requireUser } from "@/server/auth/session";
import { cardSelect, toCards } from "@/server/catalog/queries";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { ProductCard } from "@/components/shop/product-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pager } from "@/components/cabinet/pager";

export const metadata = { title: "Избранное" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

export default async function FavoritesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireUser("/account/favorites");
  const page = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);
  const where = { userId: user.id, product: { status: "ACTIVE" as const } };
  const [total, favs] = await Promise.all([
    prisma.favorite.count({ where }),
    prisma.favorite.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, select: { product: { select: cardSelect } } }),
  ]);
  const cards = await toCards(favs.map((f) => f.product), user.id);

  return (
    <>
      <PageHeader title="Избранное" description={total ? `Сохранённых товаров: ${total}` : undefined} />
      {cards.length === 0 ? (
        <EmptyState icon={<Heart />} title="В избранном пусто" description="Нажимайте на сердечко на карточке товара, чтобы вернуться к нему позже." action={<Button asChild><Link href="/catalog">В каталог</Link></Button>} />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-4">
          {cards.map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      )}
      <Pager page={page} pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))} hrefFor={(p) => `/account/favorites?page=${p}`} />
    </>
  );
}
