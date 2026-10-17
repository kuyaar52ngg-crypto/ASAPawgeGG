import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Clock, ShieldAlert, Store } from "lucide-react";
import { prisma } from "@asap/db";
import { requireUser } from "@/server/auth/session";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BecomeSellerForm } from "@/components/cabinet/account-forms";

export const metadata = { title: "Стать продавцом" };
export const dynamic = "force-dynamic";

export default async function BecomeSellerPage() {
  const user = await requireUser("/account/become-seller");
  if (user.role === "SELLER") redirect("/seller");
  if (user.role === "ADMIN") redirect("/admin");
  const profile = await prisma.sellerProfile.findUnique({ where: { userId: user.id }, select: { status: true, shopName: true, createdAt: true } });

  return (
    <>
      <PageHeader title="Стать продавцом" description="Продавайте ключи, подписки и пополнения тысячам покупателей. Выплаты — на карту, СБП, USDT или ЮMoney." />
      {profile?.status === "PENDING" ? (
        <Card className="gradient-border max-w-2xl">
          <CardContent className="flex items-start gap-4 p-6">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning"><Clock className="size-5" /></span>
            <div>
              <p className="font-display text-lg font-semibold">Заявка «{profile.shopName}» на рассмотрении</p>
              <p className="mt-1 text-sm text-muted-foreground">Администратор проверит её в ближайшее время. Как только заявка будет одобрена, в меню появится «Кабинет продавца», а вы получите уведомление.</p>
            </div>
          </CardContent>
        </Card>
      ) : profile?.status === "VERIFIED" ? (
        <Card className="max-w-2xl">
          <CardContent className="flex items-start gap-4 p-6">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-success/15 text-success"><CheckCircle2 className="size-5" /></span>
            <div>
              <p className="font-display text-lg font-semibold">Заявка одобрена</p>
              <p className="mt-1 text-sm text-muted-foreground">Профиль подтверждён. Обновите страницу, чтобы получить доступ к кабинету продавца.</p>
              <Button asChild className="mt-4"><Link href="/seller">Открыть кабинет</Link></Button>
            </div>
          </CardContent>
        </Card>
      ) : profile?.status === "SUSPENDED" ? (
        <Card className="max-w-2xl">
          <CardContent className="flex items-start gap-4 p-6">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-destructive/15 text-destructive"><ShieldAlert className="size-5" /></span>
            <p className="text-sm text-muted-foreground">Профиль продавца приостановлен. Обратитесь в <Link href="/info/contacts" className="text-primary hover:underline">поддержку</Link>.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle>{profile?.status === "REJECTED" ? "Заявка была отклонена" : "Заявка на продажу"}</CardTitle>
              <CardDescription>{profile?.status === "REJECTED" ? "Вы можете уточнить информацию и отправить заявку повторно." : "Расскажите о магазине — администратор рассмотрит заявку и откроет доступ."}</CardDescription>
            </CardHeader>
            <CardContent><BecomeSellerForm initialShopName={profile?.shopName} resubmit={profile?.status === "REJECTED"} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Store className="size-5 text-primary" /> Как это работает</CardTitle></CardHeader>
            <CardContent>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                <li>Отправляете заявку с названием магазина.</li>
                <li>Администратор подтверждает профиль.</li>
                <li>Создаёте товары — AI-модерация проверит их за секунды.</li>
                <li>Загружаете ключи на склад: выдача покупателю автоматическая.</li>
                <li>Выручка поступает на баланс продавца после периода удержания и выводится по заявке.</li>
              </ol>
              <p className="mt-4 text-xs text-muted-foreground">Подробнее — в <Link href="/info/seller-rules" className="text-primary hover:underline">правилах для продавцов</Link>.</p>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
