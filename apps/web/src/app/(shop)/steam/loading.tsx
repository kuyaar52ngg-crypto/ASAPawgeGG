import { Skeleton } from "@/components/ui/skeleton";

export default function SteamLoading() {
  return (
    <div className="container-page py-8" aria-busy aria-label="Загрузка">
      <Skeleton className="mb-3 h-6 w-40" />
      <Skeleton className="mb-3 h-10 w-96 max-w-full" />
      <Skeleton className="mb-8 h-4 w-[30rem] max-w-full" />
      <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <Skeleton className="h-[34rem] rounded-3xl" />
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
