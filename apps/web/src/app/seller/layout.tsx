import Link from "next/link";
import { BarChart3, Boxes, KeyRound, LayoutDashboard, MessageSquare, MessageSquareWarning, Package, Settings, ShieldAlert, ShoppingBag, Wallet } from "lucide-react";
import { prisma } from "@asap/db";
import { SiteHeader } from "@/components/layout/site-header";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { requireRole } from "@/server/auth/session";

// Zone C owns src/app/seller/*. Keep requireRole("SELLER","ADMIN") — server-side guard (each page also calls requireSellerPage()).
export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("SELLER", "ADMIN");
  const profile = await prisma.sellerProfile.findUnique({ where: { userId: user.id }, select: { status: true } });
  return (
    <>
      <SiteHeader />
      <DashboardShell
        title="Кабинет продавца"
        nav={[
          { href: "/seller", label: "Обзор", icon: <LayoutDashboard />, exact: true },
          { href: "/seller/products", label: "Товары", icon: <Package /> },
          { href: "/seller/stock", label: "Склад ключей", icon: <Boxes /> },
          { href: "/seller/orders", label: "Заказы", icon: <ShoppingBag /> },
          { href: "/seller/reviews", label: "Отзывы", icon: <MessageSquare /> },
          { href: "/seller/disputes", label: "Споры", icon: <MessageSquareWarning /> },
          { href: "/seller/payouts", label: "Выплаты", icon: <Wallet /> },
          { href: "/seller/analytics", label: "Статистика", icon: <BarChart3 /> },
          { href: "/seller/api-keys", label: "API-ключи", icon: <KeyRound /> },
          { href: "/seller/settings", label: "Настройки", icon: <Settings /> },
        ]}
      >
        {profile && profile.status !== "VERIFIED" && (
          <div role="status" className="mb-6 flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" />
            <p>
              {profile.status === "PENDING" && <>Профиль продавца ожидает проверки администратором. Пока можно создавать черновики товаров и загружать ключи; отправка на модерацию и выплаты откроются после подтверждения.</>}
              {profile.status === "REJECTED" && <>Профиль продавца отклонён. Изменения недоступны — свяжитесь с <Link href="/info/contacts" className="underline">поддержкой</Link>.</>}
              {profile.status === "SUSPENDED" && <>Профиль продавца приостановлен. Новые действия недоступны — свяжитесь с <Link href="/info/contacts" className="underline">поддержкой</Link>.</>}
            </p>
          </div>
        )}
        {children}
      </DashboardShell>
    </>
  );
}
