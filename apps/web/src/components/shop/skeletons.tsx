import { Skeleton } from "@/components/ui/skeleton";

export function ProductCardSkeleton() {
  return (
    <div className="glass overflow-hidden rounded-2xl" aria-hidden>
      <Skeleton className="aspect-[4/5] w-full rounded-none" />
      <div className="space-y-2.5 p-3.5">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}

/** Catalog/search skeleton: header, sidebar and a grid of cards. */
export function CatalogSkeleton({ cards = 12 }: { cards?: number }) {
  return (
    <div className="container-page py-6 sm:py-8" aria-busy aria-label="Загрузка каталога">
      <Skeleton className="mb-3 h-3 w-48" />
      <Skeleton className="mb-2 h-9 w-72" />
      <Skeleton className="mb-6 h-4 w-96 max-w-full" />
      <div className="grid gap-6 lg:grid-cols-[17rem_1fr] xl:grid-cols-[18rem_1fr]">
        <Skeleton className="hidden h-[34rem] rounded-2xl lg:block" />
        <div>
          <div className="mb-4 flex items-center justify-between">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-9 w-44" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: cards }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
