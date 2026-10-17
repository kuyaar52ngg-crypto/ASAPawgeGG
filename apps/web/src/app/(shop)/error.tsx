"use client";
import * as React from "react";
import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/** Error boundary for all storefront pages (keeps header/footer, offers retry). */
export default function ShopError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("[shop]", error);
  }, [error]);
  return (
    <div className="container-page py-16">
      <EmptyState
        icon={<TriangleAlert />}
        title="Не удалось загрузить страницу"
        description="Что-то пошло не так на нашей стороне. Попробуйте обновить страницу — обычно это помогает."
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={reset}>
              <RotateCcw /> Попробовать снова
            </Button>
            <Button asChild variant="outline">
              <Link href="/catalog">В каталог</Link>
            </Button>
          </div>
        }
      />
      {error.digest && <p className="mt-4 text-center text-xs text-muted-foreground">код ошибки: {error.digest}</p>}
    </div>
  );
}
