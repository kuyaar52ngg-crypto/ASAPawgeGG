import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="container-page flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <p className="gradient-brand-text font-display text-7xl font-bold">404</p>
        <h1 className="text-2xl font-bold">Страница не найдена</h1>
        <p className="max-w-md text-muted-foreground">Возможно, товар снят с продажи или ссылка устарела. Вернитесь в каталог — там много интересного.</p>
        <Button asChild><Link href="/catalog">Перейти в каталог</Link></Button>
      </main>
    </>
  );
}
