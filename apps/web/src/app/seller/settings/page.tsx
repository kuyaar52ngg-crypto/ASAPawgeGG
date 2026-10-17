import Link from "next/link";
import { DEFAULT_COMMISSION_BPS } from "@asap/shared";
import { getSetting } from "@asap/db";
import { requireSellerPage } from "@/server/cabinet/seller-context";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SELLER_STATUS_LABELS } from "@/components/cabinet/labels";
import { ShopForm } from "@/components/cabinet/seller-forms";

export const metadata = { title: "Настройки магазина" };
export const dynamic = "force-dynamic";

export default async function SellerSettingsPage() {
  const ctx = await requireSellerPage();
  const { profile } = ctx;
  const defaultBps = await getSetting<number>("commission.defaultBps", DEFAULT_COMMISSION_BPS);
  const bps = profile.commissionBps ?? defaultBps;
  return (
    <>
      <PageHeader title="Настройки магазина" description="Так ваш магазин видят покупатели." />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader><CardTitle>Профиль магазина</CardTitle><CardDescription>Название, описание и аватар отображаются на странице магазина и в карточках товаров.</CardDescription></CardHeader>
          <CardContent><ShopForm shopName={profile.shopName} description={profile.description ?? ""} avatar={profile.avatar ?? ""} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Статус</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Профиль</span><Badge variant={profile.status === "VERIFIED" ? "success" : profile.status === "PENDING" ? "warning" : "destructive"}>{SELLER_STATUS_LABELS[profile.status] ?? profile.status}</Badge></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Комиссия площадки</span><span className="font-semibold">{(bps / 100).toLocaleString("ru-RU")}%</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Продаж</span><span className="font-semibold">{profile.salesCount}</span></div>
            <Link href={`/seller-store/${profile.slug}`} className="inline-block text-primary hover:underline">Открыть страницу магазина</Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
