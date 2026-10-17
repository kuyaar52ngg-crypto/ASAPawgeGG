import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Нет доступа" };

export default function ForbiddenPage() {
  return (
    <>
      <SiteHeader />
      <main className="container-page flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-destructive/15 text-destructive"><ShieldAlert className="size-8" /></span>
        <h1 className="text-2xl font-bold">Недостаточно прав</h1>
        <p className="max-w-md text-muted-foreground">У вашей учётной записи нет доступа к этому разделу.</p>
        <Button asChild><Link href="/">На главную</Link></Button>
      </main>
    </>
  );
}
