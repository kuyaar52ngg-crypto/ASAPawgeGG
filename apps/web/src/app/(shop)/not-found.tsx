import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ShopNotFound() {
  return (
    <div className="container-page flex min-h-[50vh] flex-col items-center justify-center gap-4 py-16 text-center">
      <p className="gradient-brand-text font-display text-7xl font-bold">404</p>
      <h1 className="text-2xl font-bold">Страница не найдена</h1>
      <p className="max-w-md text-muted-foreground">Возможно, товар снят с продажи, а ссылка устарела. Найдите нужное в каталоге или через поиск.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/catalog">Перейти в каталог</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">На главную</Link>
        </Button>
      </div>
    </div>
  );
}
